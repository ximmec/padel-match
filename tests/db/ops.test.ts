/**
 * Pruebas de integración contra PostgreSQL real (se ejecutan en GitHub Actions).
 * Requieren DATABASE_URL apuntando a una base vacía con las migraciones aplicadas.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, type Tx } from "../../src/server/db";
import * as ops from "../../src/server/ops";
import { NeedsConfirmation } from "../../src/server/errors";
import { loadCategory } from "../../src/server/category";
import { generateTournamentSchedule, moveMatchSchedule, loadTournamentSchedule, scheduleConflicts, setCourtsInUse } from "../../src/server/schedule";
import { getRanking, manualAdjustment } from "../../src/server/ranking";
import { effectivePermissions } from "../../src/server/permissions";
import type { CurrentUser } from "../../src/server/auth";
import { DEFAULT_RULES, type CategoryRules } from "../../src/core/engine";
import type { SetScore } from "../../src/core/scoring";

let user: CurrentUser;
let orgId: string;
let venueId: string;

async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  return sql.begin((t) => fn(t)) as Promise<T>;
}

before(async () => {
  const [o] = await sql<{ id: string }[]>`INSERT INTO organizations (name, slug) VALUES ('Test', ${"test-" + Date.now()}) RETURNING id`;
  orgId = o.id;
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email, name, password_hash) VALUES (${`t${Date.now()}@x.com`}, 'Tester', 'x') RETURNING id`;
  await sql`INSERT INTO memberships (user_id, org_id, role) VALUES (${u.id}, ${orgId}, 'ADMIN')`;
  user = { id: u.id, name: "Tester", email: "t@x.com", isSuperadmin: false, orgId, orgName: "Test", orgSlug: "test", role: "ADMIN", permissions: effectivePermissions("ADMIN", null), orgs: [] };
  const [v] = await sql<{ id: string }[]>`INSERT INTO venues (org_id, name) VALUES (${orgId}, 'Club') RETURNING id`;
  venueId = v.id;
  for (let i = 1; i <= 3; i++) await sql`INSERT INTO courts (venue_id, name, sort) VALUES (${venueId}, ${"Cancha " + i}, ${i})`;
});

after(async () => { await sql.end(); });

async function makePlayers(n: number, gender = "M") {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [p] = await sql<{ id: string }[]>`INSERT INTO players (org_id, code, first_name, last_name, gender) VALUES (${orgId}, ${`T-${Date.now()}-${i}-${Math.random()}`}, ${"J" + i}, ${"Apellido" + i}, ${gender}) RETURNING id`;
    ids.push(p.id);
  }
  return ids;
}

async function makeTournament(rules: CategoryRules = DEFAULT_RULES) {
  const [cat] = await sql<{ id: string }[]>`INSERT INTO categories (org_id, name, gender_rule) VALUES (${orgId}, ${"Cat " + Math.random()}, 'MALE') RETURNING id`;
  const [t] = await sql<{ id: string }[]>`INSERT INTO tournaments (org_id, name, slug, venue_id, start_date, end_date, status) VALUES (${orgId}, 'Torneo', ${"t-" + Math.random()}, ${venueId}, '2026-10-10', '2026-10-11', 'IN_PROGRESS') RETURNING id`;
  const tcId = await tx((x) => ops.addCategory(x, user, t.id, cat.id, rules));
  return { tournamentId: t.id, tcId };
}

async function register(tcId: string, players: string[]) {
  const entries: string[] = [];
  for (let i = 0; i < players.length; i += 2) {
    entries.push(await tx((x) => ops.registerEntry(x, user, tcId, players[i], players[i + 1], i < 8 ? i / 2 + 1 : null)));
  }
  return entries;
}

async function result(matchId: string, sets: SetScore[], confirm = false) {
  const [m] = await sql<{ version: number }[]>`SELECT version FROM matches WHERE id = ${matchId}`;
  return tx((x) => ops.recordResult(x, user, matchId, { kind: "PLAYED", sets }, m.version, null, confirm));
}

/** A gana a B si a < b en el orden de inscripción (resultados deterministas). */
async function playZones(tcId: string, entries: string[]) {
  const lc = await loadCategory(sql, tcId, orgId);
  for (const m of lc.matches.filter((x) => x.phase === "ZONE" && x.status === "PENDING")) {
    const aWins = entries.indexOf(m.entry_a!) < entries.indexOf(m.entry_b!);
    await result(m.id, aWins ? [[6, 2], [6, 3]] : [[2, 6], [3, 6]]);
  }
}

async function playBracket(tcId: string) {
  for (let i = 0; i < 10; i++) {
    const lc = await loadCategory(sql, tcId, orgId);
    const ready = lc.view.bracket.filter((b) => !b.winner && b.a.kind === "ENTRY" && b.b.kind === "ENTRY");
    if (!ready.length) return lc;
    for (const b of ready) {
      const row = lc.matches.find((m) => m.bracket_code === b.code)!;
      await result(row.id, [[6, 4], [6, 4]]);
    }
  }
  throw new Error("cuadro sin terminar");
}

test("flujo completo: inscripción, zonas, resultados, cuadro, corrección y ranking sin duplicados", async () => {
  const { tcId } = await makeTournament({ ...DEFAULT_RULES, qualification: { perZone: 2, bestNext: 0 } });
  const players = await makePlayers(20);
  const entries = await register(tcId, players); // 10 parejas
  await assert.rejects(tx((x) => ops.registerEntry(x, user, tcId, players[0], players[2], null)), /ya está inscripto|unique|duplicate/i);

  await tx((x) => ops.generateZones(x, user, tcId, null, 123));
  let lc = await loadCategory(sql, tcId, orgId);
  assert.deepEqual(lc.zones.map((z) => z.entry_ids.length).sort(), [3, 3, 4]);
  assert.equal(lc.matches.filter((m) => m.phase === "ZONE").length, 3 + 3 + 6);

  await tx((x) => ops.generateBracket(x, user, tcId));
  await playZones(tcId, entries);
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok([...lc.view.standings.values()].every((s) => s.final));

  lc = await playBracket(tcId);
  const final = lc.view.bracket.find((b) => b.round === Math.max(...lc.view.bracket.map((x) => x.round)))!;
  assert.ok(final.winner);
  const [{ n: autoRows }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE tc_id = ${tcId} AND kind = 'AUTO' AND superseded_at IS NULL`;
  assert.equal(autoRows, 20); // 10 parejas x 2 jugadores
  const before = await getRanking(sql, orgId, {});
  const champion = before[0];
  assert.equal(champion.points, DEFAULT_RULES.points.CHAMPION);

  // Corregir la final (gana el otro): requiere confirmación porque cambia el ranking
  const finalRow = lc.matches.find((m) => m.bracket_code === final.code)!;
  await assert.rejects(result(finalRow.id, [[4, 6], [4, 6]]), (e) => e instanceof NeedsConfirmation);
  await result(finalRow.id, [[4, 6], [4, 6]], true);
  const after = await getRanking(sql, orgId, {});
  const total = (r: typeof after) => r.reduce((a, b) => a + b.points, 0);
  assert.equal(total(after), total(before), "la suma total de puntos no cambia: no se duplican");
  assert.equal(after.find((r) => r.player_id === champion.player_id)!.points, DEFAULT_RULES.points.FINALIST);
  const [{ n: superseded }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE tc_id = ${tcId} AND superseded_at IS NOT NULL`;
  assert.equal(superseded, 20, "las asignaciones anteriores quedan como historial");

  // Historial de resultados conservado
  const [{ n: versions }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM match_result_versions WHERE match_id = ${finalRow.id}`;
  assert.equal(versions, 2);
});

test("corrección de zona después del cuadro invalida resultados de cruces que cambian", async () => {
  const { tcId } = await makeTournament({ ...DEFAULT_RULES, qualification: { perZone: 2, bestNext: 0 } });
  const entries = await register(tcId, await makePlayers(16)); // 8 parejas → 2 zonas de 4
  await tx((x) => ops.generateZones(x, user, tcId, null, 7));
  await tx((x) => ops.generateBracket(x, user, tcId));
  await playZones(tcId, entries);
  let lc = await loadCategory(sql, tcId, orgId);
  const r1 = lc.view.bracket.filter((b) => b.round === 1);
  const first = r1[0];
  const row = lc.matches.find((m) => m.bracket_code === first.code)!;
  await result(row.id, [[6, 1], [6, 1]]);

  // Invertir un resultado de zona que cambia quién es 1° de la zona de la pareja ganadora
  if (first.a.kind !== "ENTRY") throw new Error("se esperaba pareja definida");
  const winner = first.a.entryId;
  const zone = lc.zones.find((z) => z.entry_ids.includes(winner))!;
  const zm = lc.matches.filter((m) => m.zone_id === zone.id && (m.entry_a === winner || m.entry_b === winner));
  // La pareja pierde todos sus partidos de zona → deja de ser 1°
  for (const m of zm) {
    const winnerIsA = m.entry_a === winner;
    const sets: SetScore[] = winnerIsA ? [[0, 6], [0, 6]] : [[6, 0], [6, 0]];
    try { await result(m.id, sets); } catch (e) { if (e instanceof NeedsConfirmation) await result(m.id, sets, true); else throw e; }
  }
  lc = await loadCategory(sql, tcId, orgId);
  const updated = lc.matches.find((m) => m.id === row.id)!;
  assert.equal(updated.status, "PENDING", "el resultado del cruce quedó invalidado");
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM match_result_versions WHERE match_id = ${row.id}`;
  assert.equal(n, 2, "el resultado anterior sigue en el historial");
});

test("retiro, reemplazo y cambio de zona conservan el historial", async () => {
  const { tcId } = await makeTournament();
  const players = await makePlayers(20);
  const entries = await register(tcId, players.slice(0, 18)); // 9 parejas → 3 zonas de 3
  await tx((x) => ops.generateZones(x, user, tcId, null, 1));
  let lc = await loadCategory(sql, tcId, orgId);
  const z0 = lc.zones[0];
  const [e1, e2] = z0.entry_ids;
  const m12 = lc.matches.find((m) => m.zone_id === z0.id && [m.entry_a, m.entry_b].includes(e1) && [m.entry_a, m.entry_b].includes(e2))!;
  await result(m12.id, [[6, 0], [6, 0]]);

  // Reemplazo de jugador: el resultado se mantiene
  await tx((x) => ops.replacePlayer(x, user, e1, 1, players[18]));
  lc = await loadCategory(sql, tcId, orgId);
  assert.equal(lc.matches.find((m) => m.id === m12.id)!.status, "PLAYED");
  assert.equal(lc.entryMap.get(e1)!.former.length, 1);

  // Mover e1 a otra zona: pide confirmación y anula (no borra) lo jugado
  const target = lc.zones[1];
  await assert.rejects(tx((x) => ops.moveEntry(x, user, e1, target.id, false)), (e) => e instanceof NeedsConfirmation);
  await tx((x) => ops.moveEntry(x, user, e1, target.id, true));
  lc = await loadCategory(sql, tcId, orgId);
  assert.equal(lc.matches.find((m) => m.id === m12.id)!.status, "ANNULLED");
  assert.equal(lc.zones[1].entry_ids.length, 4);
  assert.equal(lc.matches.filter((m) => m.zone_id === target.id && m.status !== "ANNULLED").length, 6);

  // Retiro con W.O. en pendientes
  const e3 = lc.zones[2].entry_ids[0];
  await tx((x) => ops.withdrawEntry(x, user, e3, "WO_PENDING", true));
  lc = await loadCategory(sql, tcId, orgId);
  const mine = lc.matches.filter((m) => m.entry_a === e3 || m.entry_b === e3);
  assert.ok(mine.every((m) => m.status === "PLAYED" && m.outcome?.kind === "WALKOVER"));
  const s = lc.view.standings.get(lc.zones[2].id)!;
  assert.equal(s.rows[s.rows.length - 1].entryId, e3, "la pareja retirada queda última");
  void entries;
});

test("cronograma sin conflictos y cambio manual con aviso", async () => {
  const { tournamentId, tcId } = await makeTournament();
  const entries = await register(tcId, await makePlayers(24)); // 12 parejas
  await tx((x) => ops.generateZones(x, user, tcId, null, 3));
  const courts = await sql<{ id: string }[]>`SELECT id FROM courts WHERE venue_id = ${venueId}`;
  for (const c of courts) await sql`INSERT INTO court_availability (tournament_id, court_id, starts_at, ends_at) VALUES (${tournamentId}, ${c.id}, '2026-10-10T12:00:00Z', '2026-10-11T02:00:00Z')`;
  const r = await tx((x) => generateTournamentSchedule(x, user, tournamentId, "ALL"));
  assert.equal(r.unscheduled, 0);
  let s = await loadTournamentSchedule(sql, tournamentId, orgId);
  assert.deepEqual(scheduleConflicts(s), []);
  // Mover un partido al mismo horario que otro de la misma pareja → pide confirmación
  const a = s.items[0];
  const b = s.items.find((i) => i.matchId !== a.matchId && i.players.some((p) => a.players.includes(p)))!;
  await assert.rejects(tx((x) => moveMatchSchedule(x, user, b.matchId, a.courtId === courts[0].id ? courts[1].id : courts[0].id, a.start, true, false)), (e) => e instanceof NeedsConfirmation);
  s = await loadTournamentSchedule(sql, tournamentId, orgId);
  assert.deepEqual(scheduleConflicts(s), [], "sin confirmar no se aplicó");
  void entries;
});

test("ajuste manual exige motivo y la auditoría es inalterable", async () => {
  const [p] = await makePlayers(1);
  await assert.rejects(tx((x) => manualAdjustment(x, user, { playerId: p, points: 50, reason: "" })), /motivo/);
  await tx((x) => manualAdjustment(x, user, { playerId: p, points: 50, reason: "Bonificación por organización" }));
  const r = await getRanking(sql, orgId, {});
  assert.ok(r.some((x) => x.player_id === p && x.points === 50));
  await assert.rejects(sql`DELETE FROM audit_log WHERE org_id = ${orgId}`, /no se puede modificar/);
});

test("categoría mixta acepta dos hombres, dos mujeres o un hombre y una mujer", async () => {
  const [cat] = await sql<{ id: string }[]>`INSERT INTO categories (org_id, name, gender_rule) VALUES (${orgId}, ${"Mixta " + Math.random()}, 'MIXED') RETURNING id`;
  const [t] = await sql<{ id: string }[]>`INSERT INTO tournaments (org_id, name, slug, start_date, end_date) VALUES (${orgId}, 'Mixto', ${"m-" + Math.random()}, '2026-10-10', '2026-10-10') RETURNING id`;
  const tcId = await tx((x) => ops.addCategory(x, user, t.id, cat.id, DEFAULT_RULES));
  const men = await makePlayers(2, "M");
  const women = await makePlayers(4, "F");
  await tx((x) => ops.registerEntry(x, user, tcId, men[0], men[1], null));
  await tx((x) => ops.registerEntry(x, user, tcId, women[0], women[1], null));
  const [man3] = await makePlayers(1, "M");
  await tx((x) => ops.registerEntry(x, user, tcId, women[2], man3, null));
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM entries WHERE tc_id = ${tcId}`;
  assert.equal(n, 3);
});

test("reiniciar categoría y torneo conserva las inscripciones", async () => {
  const { tournamentId, tcId } = await makeTournament({ ...DEFAULT_RULES, qualification: { perZone: 2, bestNext: 0 } });
  const players = await makePlayers(16);
  const entries = await register(tcId, players); // 8 parejas
  await tx((x) => ops.generateZones(x, user, tcId, null, 7));
  await tx((x) => ops.generateBracket(x, user, tcId));
  await playZones(tcId, entries);
  await playBracket(tcId);
  const [{ n: pts }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE tc_id = ${tcId} AND kind = 'AUTO' AND superseded_at IS NULL`;
  assert.equal(pts, 16);

  // Solo resultados: pide confirmación, luego todo vuelve a pendiente y se quitan los puntos
  await assert.rejects(tx((x) => ops.resetCategory(x, user, tcId, "RESULTS", false)), (e) => e instanceof NeedsConfirmation);
  await tx((x) => ops.resetCategory(x, user, tcId, "RESULTS", true));
  let lc = await loadCategory(sql, tcId, orgId);
  assert.equal(lc.entries.filter((e) => e.status === "ACTIVE").length, 8);
  assert.ok(lc.zones.length > 0 && lc.tc.bracket.length > 0);
  assert.equal(lc.matches.filter((m) => m.status === "PLAYED").length, 0);
  const [{ n: pts2 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE tc_id = ${tcId} AND kind = 'AUTO' AND superseded_at IS NULL`;
  assert.equal(pts2, 0);
  const [t1] = await sql<{ status: string }[]>`SELECT status FROM tournaments WHERE id = ${tournamentId}`;
  assert.equal(t1.status, "OPEN");

  // Se puede volver a jugar
  await playZones(tcId, entries);
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok([...lc.view.standings.values()].every((s) => s.final));

  // Torneo completo desde cero
  await assert.rejects(tx((x) => ops.resetTournament(x, user, tournamentId, "ALL", false)), (e) => e instanceof NeedsConfirmation);
  await tx((x) => ops.resetTournament(x, user, tournamentId, "ALL", true));
  lc = await loadCategory(sql, tcId, orgId);
  assert.equal(lc.entries.filter((e) => e.status === "ACTIVE").length, 8);
  assert.equal(lc.zones.length, 0);
  assert.equal(lc.matches.length, 0);
  assert.equal(lc.tc.bracket.length, 0);
  assert.equal(lc.tc.status, "REGISTRATION");
  // y se puede volver a sortear
  await tx((x) => ops.generateZones(x, user, tcId, null, 99));
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok(lc.zones.length > 0);
});

test("eliminación directa: sin zonas, cuadro con todas las parejas, byes a los sembrados y ranking", async () => {
  const { tcId } = await makeTournament({ ...DEFAULT_RULES, mode: "KNOCKOUT" });
  const players = await makePlayers(18);
  const entries = await register(tcId, players); // 9 parejas, las 4 primeras sembradas
  await assert.rejects(tx((x) => ops.generateZones(x, user, tcId, null, 1)), /eliminación directa/);
  await tx((x) => ops.generateBracket(x, user, tcId, 5));
  let lc = await loadCategory(sql, tcId, orgId);
  assert.equal(lc.zones.length, 0);
  const r1 = lc.tc.bracket.filter((d) => d.round === 1);
  assert.equal(r1.length, 8, "9 parejas → cuadro de 16");
  const byes = r1.filter((d) => d.a.t === "BYE" || d.b.t === "BYE");
  assert.equal(byes.length, 7);
  const seed1 = entries[0];
  assert.ok(byes.some((d) => (d.a.t === "ENTRY" && d.a.entryId === seed1) || (d.b.t === "ENTRY" && d.b.entryId === seed1)), "el sembrado 1 tiene pase libre");
  lc = await playBracket(tcId);
  const final = lc.view.bracket.find((b) => b.round === Math.max(...lc.view.bracket.map((x) => x.round)))!;
  assert.ok(final.winner);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE tc_id = ${tcId} AND kind = 'AUTO' AND superseded_at IS NULL`;
  assert.equal(n, 18, "todos los jugadores reciben puntos");
  // No se puede cambiar a zonas con el cuadro armado
  await assert.rejects(tx((x) => ops.updateRules(x, user, tcId, { ...DEFAULT_RULES, mode: "ZONES" }, true)), /eliminá las zonas y el cuadro/);
});

test("eliminar torneo: pide confirmación, borra todo y quita los puntos", async () => {
  const { tournamentId, tcId } = await makeTournament({ ...DEFAULT_RULES, mode: "KNOCKOUT" });
  const players = await makePlayers(8);
  await register(tcId, players);
  await tx((x) => ops.generateBracket(x, user, tcId, 3));
  await playBracket(tcId);
  const [{ n: before }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE tc_id = ${tcId} AND kind = 'AUTO'`;
  assert.ok(before > 0);
  await assert.rejects(tx((x) => ops.deleteTournament(x, user, tournamentId, false)), (e) => e instanceof NeedsConfirmation);
  await tx((x) => ops.deleteTournament(x, user, tournamentId, true));
  const [{ n: t }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tournaments WHERE id = ${tournamentId}`;
  assert.equal(t, 0);
  const [{ n: pts }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ranking_ledger WHERE player_id = ANY(${players}::uuid[]) AND kind = 'AUTO'`;
  assert.equal(pts, 0, "no quedan puntos huérfanos");
  const [{ n: pl }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM players WHERE id = ANY(${players}::uuid[])`;
  assert.equal(pl, 8, "los jugadores se conservan");
  const [{ n: aud }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE tournament_id = ${tournamentId} AND action = 'delete'`;
  assert.equal(aud, 1);
});

test("zonas de 4 GvG/PvP: 2ª ronda automática, posiciones y pasan 3", async () => {
  const { tcId } = await makeTournament({ ...DEFAULT_RULES, preferredZoneSize: 4, fourZone: "GVG", qualification: { perZone: 2, bestNext: 0, perZoneOf4: 3 } });
  const players = await makePlayers(16);
  const entries = await register(tcId, players); // 8 parejas → 2 zonas de 4
  await tx((x) => ops.generateZones(x, user, tcId, null, 11));
  let lc = await loadCategory(sql, tcId, orgId);
  assert.deepEqual(lc.zones.map((z) => z.format), ["GVG", "GVG"]);
  const z = lc.zones[0];
  const zm = () => lc.matches.filter((m) => m.zone_id === z.id);
  assert.equal(zm().length, 4);
  assert.equal(zm().filter((m) => m.slot && !m.entry_a).length, 2, "2ª ronda a definir");
  await assert.rejects(result(zm().find((m) => m.slot === "GVG")!.id, [[6, 1], [6, 1]]), /1ª ronda/);
  // 1ª ronda: gana siempre el lado A
  for (const m of zm().filter((m) => m.round === 1)) await result(m.id, [[6, 2], [6, 2]]);
  lc = await loadCategory(sql, tcId, orgId);
  const g = zm().find((m) => m.slot === "GVG")!;
  const p = zm().find((m) => m.slot === "PVP")!;
  const r1 = zm().filter((m) => m.round === 1);
  assert.deepEqual(new Set([g.entry_a, g.entry_b]), new Set(r1.map((m) => m.entry_a)), "ganadores juegan entre sí");
  assert.deepEqual(new Set([p.entry_a, p.entry_b]), new Set(r1.map((m) => m.entry_b)), "perdedores juegan entre sí");
  await result(g.id, [[2, 6], [2, 6]]); // gana B
  await result(p.id, [[6, 3], [6, 3]]); // gana A
  lc = await loadCategory(sql, tcId, orgId);
  const st = lc.view.standings.get(z.id)!;
  assert.ok(st.final);
  assert.deepEqual(st.rows.map((r) => r.entryId), [g.entry_b, g.entry_a, p.entry_a, p.entry_b]);
  // Pasan 3 por zona de 4 → cuadro con 6 clasificados (de 8 lugares)
  await tx((x) => ops.generateBracket(x, user, tcId));
  lc = await loadCategory(sql, tcId, orgId);
  const refs = lc.tc.bracket.flatMap((d) => [d.a, d.b]).filter((r) => r.t === "ZONE");
  assert.equal(refs.length, 6);
  // Corregir la 1ª ronda cambia quién juega la 2ª → su resultado queda invalidado
  const first = r1[0];
  const [{ version }] = await sql<{ version: number }[]>`SELECT version FROM matches WHERE id = ${first.id}`;
  await tx((x) => ops.recordResult(x, user, first.id, { kind: "PLAYED", sets: [[2, 6], [2, 6]] }, version, "Error de carga", true));
  lc = await loadCategory(sql, tcId, orgId);
  const g2 = zm().find((m) => m.slot === "GVG")!;
  assert.equal(g2.status, "PENDING", "el partido de ganadores vuelve a pendiente");
  assert.ok([g2.entry_a, g2.entry_b].includes(first.entry_b), "ahora juega el nuevo ganador");
  void entries;
});

test("restricción horaria de una pareja respetada por el cronograma", async () => {
  const { tournamentId, tcId } = await makeTournament();
  const players = await makePlayers(12);
  const entries = await register(tcId, players); // 6 parejas → 2 zonas de 3
  await tx((x) => ops.setEntryRestriction(x, user, entries[0], "20:00", null, "trabaja"));
  await tx((x) => ops.generateZones(x, user, tcId, null, 3));
  const courtIds = await sql<{ id: string }[]>`SELECT id FROM courts WHERE venue_id = ${venueId} ORDER BY sort`;
  for (const c of courtIds) {
    await sql`INSERT INTO court_availability (tournament_id, court_id, starts_at, ends_at) VALUES (${tournamentId}, ${c.id}, '2026-10-10T09:00:00-03:00', '2026-10-10T23:59:00-03:00')`;
  }
  await tx((x) => generateTournamentSchedule(x, user, tournamentId, "ALL"));
  const rows = await sql<{ scheduled_at: Date }[]>`SELECT scheduled_at FROM matches WHERE tc_id = ${tcId} AND (entry_a = ${entries[0]} OR entry_b = ${entries[0]})`;
  assert.ok(rows.length > 0 && rows.every((r) => r.scheduled_at && r.scheduled_at.getTime() >= new Date("2026-10-10T20:00:00-03:00").getTime()), "todos sus partidos desde las 20:00");
  // Con «No tener en cuenta restricciones» puede ir antes
  await sql`UPDATE tournaments SET ignore_restrictions = true WHERE id = ${tournamentId}`;
  await tx((x) => generateTournamentSchedule(x, user, tournamentId, "ALL"));
  const rows2 = await sql<{ scheduled_at: Date }[]>`SELECT scheduled_at FROM matches WHERE tc_id = ${tcId} AND (entry_a = ${entries[0]} OR entry_b = ${entries[0]})`;
  assert.ok(rows2.some((r) => r.scheduled_at.getTime() < new Date("2026-10-10T20:00:00-03:00").getTime()));
});

test("cupo por categoría: no deja inscribir más parejas que el cupo", async () => {
  const { tournamentId, tcId } = await makeTournament({ ...DEFAULT_RULES, maxEntries: 2 });
  await sql`UPDATE tournaments SET max_entries = 24 WHERE id = ${tournamentId}`;
  const players = await makePlayers(6);
  await register(tcId, players.slice(0, 4)); // 2 parejas = cupo propio de la categoría
  await assert.rejects(tx((x) => ops.registerEntry(x, user, tcId, players[4], players[5], null)), /cupo de 2 parejas/);
});

test("con el torneo empezado, bajar de 3 a 2 canchas reprograma lo pendiente sin tocar resultados", async () => {
  const { tournamentId, tcId } = await makeTournament();
  const players = await makePlayers(12);
  await register(tcId, players);
  await tx((x) => ops.generateZones(x, user, tcId, null, 5));
  const courtIds = (await sql<{ id: string }[]>`SELECT id FROM courts WHERE venue_id = ${venueId} AND active ORDER BY sort`).map((c) => c.id);
  const start = new Date(Date.now() - 60 * 60_000), end = new Date(Date.now() + 10 * 3_600_000);
  for (const c of courtIds) await sql`INSERT INTO court_availability (tournament_id, court_id, starts_at, ends_at) VALUES (${tournamentId}, ${c}, ${start}, ${end})`;
  await tx((x) => generateTournamentSchedule(x, user, tournamentId, "ALL"));
  let lc = await loadCategory(sql, tcId, orgId);
  const playedOne = lc.matches[0];
  await result(playedOne.id, [[6, 1], [6, 1]]);
  const keep = courtIds.slice(0, 2);
  await assert.rejects(tx((x) => setCourtsInUse(x, user, tournamentId, keep, false)), (e) => e instanceof NeedsConfirmation);
  await tx((x) => setCourtsInUse(x, user, tournamentId, keep, true));
  lc = await loadCategory(sql, tcId, orgId);
  const pending = lc.matches.filter((m) => m.status === "PENDING");
  assert.ok(pending.every((m) => m.court_id && keep.includes(m.court_id) && m.scheduled_at && m.scheduled_at.getTime() >= Date.now() - 60_000), "pendientes en las 2 canchas que quedan, desde ahora");
  assert.equal(lc.matches.find((m) => m.id === playedOne.id)!.status, "PLAYED", "el resultado se conserva");
});

test("cambio de pareja: intercambiar jugadores entre parejas conserva zonas y resultados", async () => {
  const { tcId } = await makeTournament();
  const players = await makePlayers(12);
  const entries = await register(tcId, players);
  await tx((x) => ops.generateZones(x, user, tcId, null, 9));
  let lc = await loadCategory(sql, tcId, orgId);
  const m = lc.matches.find((x) => x.phase === "ZONE")!;
  await result(m.id, [[6, 3], [6, 3]]);
  const [a, b] = [entries[0], entries[5]];
  const zoneOf = (e: string) => lc.zones.find((z) => z.entry_ids.includes(e))!.id;
  const za = zoneOf(a), zb = zoneOf(b);
  const pa = lc.entryMap.get(a)!.players.find((p) => p.slot === 1)!.id;
  const pb = lc.entryMap.get(b)!.players.find((p) => p.slot === 2)!.id;
  await tx((x) => ops.swapPlayers(x, user, a, 1, b, 2));
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok(lc.entryMap.get(a)!.players.some((p) => p.id === pb), "el jugador de B pasó a A");
  assert.ok(lc.entryMap.get(b)!.players.some((p) => p.id === pa), "el jugador de A pasó a B");
  assert.equal(zoneOf(a), za); assert.equal(zoneOf(b), zb);
  assert.equal(lc.matches.find((x) => x.id === m.id)!.status, "PLAYED", "el resultado se conserva");
  assert.equal(lc.entryMap.get(a)!.former.length, 1, "queda el historial del cambio");
});

test("sumar una pareja con el torneo empezado: zona con menos parejas o pase libre, sin tocar resultados", async () => {
  // Zonas
  const { tcId } = await makeTournament();
  const players = await makePlayers(16);
  await register(tcId, players.slice(0, 14)); // 7 parejas → zonas 4 y 3
  await tx((x) => ops.generateZones(x, user, tcId, null, 4));
  let lc = await loadCategory(sql, tcId, orgId);
  const played = lc.matches.find((m) => m.phase === "ZONE")!;
  await result(played.id, [[6, 2], [6, 2]]);
  const small = [...lc.zones].sort((a, b) => a.entry_ids.length - b.entry_ids.length)[0];
  const id = await tx(async (x) => { const e = await ops.registerEntry(x, user, tcId, players[14], players[15], null); await ops.placeLateEntry(x, user, tcId, e, null); return e; });
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok(lc.zones.find((z) => z.id === small.id)!.entry_ids.includes(id), "entró en la zona más chica");
  assert.equal(lc.matches.filter((m) => m.entry_a === id || m.entry_b === id).length, small.entry_ids.length, "solo sus partidos nuevos");
  assert.equal(lc.matches.find((m) => m.id === played.id)!.status, "PLAYED", "el resultado se conserva");

  // Eliminación directa: ocupa un pase libre
  const ko = await makeTournament({ ...DEFAULT_RULES, mode: "KNOCKOUT" });
  const kp = await makePlayers(14);
  await register(ko.tcId, kp.slice(0, 12)); // 6 parejas → cuadro de 8 con 2 pases libres
  await tx((x) => ops.generateBracket(x, user, ko.tcId, 2));
  const e7 = await tx(async (x) => { const e = await ops.registerEntry(x, user, ko.tcId, kp[12], kp[13], null); await ops.placeLateEntry(x, user, ko.tcId, e, null); return e; });
  const lk = await loadCategory(sql, ko.tcId, orgId);
  const r1 = lk.tc.bracket.filter((d) => d.round === 1);
  assert.ok(r1.some((d) => (d.a.t === "ENTRY" && d.a.entryId === e7) || (d.b.t === "ENTRY" && d.b.entryId === e7)));
  assert.equal(r1.filter((d) => d.a.t === "BYE" || d.b.t === "BYE").length, 1, "queda un solo pase libre");
});

test("pago del arancel: marcar y desmarcar por jugador; el pago acompaña al jugador si cambia de pareja", async () => {
  const { tcId } = await makeTournament();
  const players = await makePlayers(4);
  const [a, b] = await register(tcId, players);
  assert.equal(await tx((x) => ops.togglePaid(x, user, a, 1)), true);
  let lc = await loadCategory(sql, tcId, orgId);
  const pa = lc.entryMap.get(a)!.players.find((p) => p.slot === 1)!;
  assert.ok(pa.paid_at, "quedó marcado");
  assert.equal(lc.entryMap.get(a)!.players.find((p) => p.slot === 2)!.paid_at, null, "el compañero no");
  await tx((x) => ops.swapPlayers(x, user, a, 1, b, 1));
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok(lc.entryMap.get(b)!.players.find((p) => p.id === pa.id)!.paid_at, "el pago viaja con el jugador");
  assert.equal(await tx((x) => ops.togglePaid(x, user, b, 1)), false);
  lc = await loadCategory(sql, tcId, orgId);
  assert.equal(lc.entryMap.get(b)!.players.find((p) => p.slot === 1)!.paid_at, null, "se desmarcó");
});

test("corregir clasificados: poner una pareja no clasificada e intercambiar lugares", async () => {
  const { tcId } = await makeTournament({ ...DEFAULT_RULES, qualification: { perZone: 2, bestNext: 0 } });
  const players = await makePlayers(18);
  const entries = await register(tcId, players); // 9 parejas → 3 zonas de 3
  await tx((x) => ops.generateZones(x, user, tcId, null, 7));
  await tx((x) => ops.generateBracket(x, user, tcId));
  await playZones(tcId, entries);
  let lc = await loadCategory(sql, tcId, orgId);
  const r1 = lc.view.bracket.filter((m) => m.round === 1);
  const inside = new Set(r1.flatMap((m) => [m.a, m.b]).filter((r) => r.kind === "ENTRY").map((r) => (r as { entryId: string }).entryId));
  const outside = entries.find((e) => !inside.has(e))!;
  const spot = r1.find((m) => m.a.kind === "ENTRY")!;
  // Pide confirmación primero
  await assert.rejects(tx((x) => ops.setBracketSlot(x, user, tcId, spot.code, "a", { t: "ENTRY", entryId: outside }, false)), NeedsConfirmation);
  await tx((x) => ops.setBracketSlot(x, user, tcId, spot.code, "a", { t: "ENTRY", entryId: outside }, true));
  lc = await loadCategory(sql, tcId, orgId);
  const now = lc.view.bracket.find((m) => m.code === spot.code)!;
  assert.equal(now.a.kind === "ENTRY" && now.a.entryId, outside, "entra la pareja elegida");
  // No se puede poner dos veces la misma pareja
  const other = r1.find((m) => m.code !== spot.code && m.a.kind === "ENTRY")!;
  await assert.rejects(tx((x) => ops.setBracketSlot(x, user, tcId, other.code, "a", { t: "ENTRY", entryId: outside }, true)), /ya está en el cuadro/);
  // Intercambio de lugares
  const otherWho = (lc.view.bracket.find((m) => m.code === other.code)!.a as { entryId: string }).entryId;
  await tx((x) => ops.swapBracketSlots(x, user, tcId, { code: spot.code, side: "a" }, { code: other.code, side: "a" }, true));
  lc = await loadCategory(sql, tcId, orgId);
  assert.equal((lc.view.bracket.find((m) => m.code === other.code)!.a as { entryId: string }).entryId, outside);
  assert.equal((lc.view.bracket.find((m) => m.code === spot.code)!.a as { entryId: string }).entryId, otherWho);
});

test("armar zonas a mano: respeta la elección y controla que estén todas", async () => {
  const { tcId } = await makeTournament();
  const players = await makePlayers(14);
  const e = await register(tcId, players); // 7 parejas
  const manual = [[e[6], e[0], e[3], e[5]], [e[1], e[2], e[4]]];
  await assert.rejects(tx((x) => ops.generateZones(x, user, tcId, null, 0, [manual[0], [e[1], e[2]]])), /Faltan ubicar/);
  await assert.rejects(tx((x) => ops.generateZones(x, user, tcId, null, 0, [manual[0], [e[1], e[2], e[0]]])), /dos zonas/);
  await tx((x) => ops.generateZones(x, user, tcId, null, 0, manual));
  const lc = await loadCategory(sql, tcId, orgId);
  assert.deepEqual(lc.zones.map((z) => [...z.entry_ids].sort()), manual.map((g) => [...g].sort()));
  assert.equal(lc.matches.filter((m) => m.phase === "ZONE").length, 6 + 3);
});

test("reemplazo escribiendo el nombre: crea el jugador una sola vez y conserva resultados", async () => {
  const { tcId } = await makeTournament();
  const players = await makePlayers(8);
  const entries = await register(tcId, players);
  await tx((x) => ops.generateZones(x, user, tcId, null, 1));
  let lc = await loadCategory(sql, tcId, orgId);
  const m = lc.matches.find((x) => x.phase === "ZONE" && x.entry_a === entries[0] || x.entry_b === entries[0])!;
  await result(m.id, [[6, 3], [6, 3]]);
  const id1 = await tx((x) => ops.quickPlayer(x, user, "  Juan ", "Reemplazo", "MALE"));
  const id2 = await tx((x) => ops.quickPlayer(x, user, "juan", "reemplazo", "MALE"));
  assert.equal(id1, id2, "no duplica si ya existe");
  await tx((x) => ops.replacePlayer(x, user, entries[0], 1, id1));
  lc = await loadCategory(sql, tcId, orgId);
  assert.ok(lc.entryMap.get(entries[0])!.players.some((p) => p.id === id1));
  assert.equal(lc.matches.find((x) => x.id === m.id)!.status, "PLAYED");
  await assert.rejects(tx((x) => ops.quickPlayer(x, user, "J", "", "MALE")), /nombre y apellido/);
});

test("zona de 4 ya empezada: pasar a GvG/PvP respetando lo jugado, y volver", async () => {
  const { tcId } = await makeTournament();
  const players = await makePlayers(26);
  const entries = await register(tcId, players); // 13 parejas
  await tx((x) => ops.generateZones(x, user, tcId, [4, 3, 3, 3], 5));
  let lc = await loadCategory(sql, tcId, orgId);
  const z4 = lc.zones.find((z) => z.entry_ids.length === 4)!;
  const [a, b, c, d] = z4.entry_ids;
  // se jugó 2° vs 1° (no es el cruce por defecto 1°-4°)
  const m1 = lc.matches.find((m) => m.zone_id === z4.id && [m.entry_a, m.entry_b].includes(a) && [m.entry_a, m.entry_b].includes(b))!;
  await result(m1.id, [[6, 2], [6, 2]]);
  await assert.rejects(tx((x) => ops.setFourZoneFormat(x, user, tcId, "GVG", false)), NeedsConfirmation);
  await tx((x) => ops.setFourZoneFormat(x, user, tcId, "GVG", true));
  lc = await loadCategory(sql, tcId, orgId);
  const zm = () => lc.matches.filter((m) => m.zone_id === z4.id && m.status !== "ANNULLED");
  assert.equal(lc.zones.find((z) => z.id === z4.id)!.format, "GVG");
  assert.equal(zm().length, 4, "2 de 1ª ronda + ganadores + perdedores");
  assert.equal(lc.matches.find((m) => m.id === m1.id)!.status, "PLAYED", "el jugado se conserva como 1ª ronda");
  const other = zm().find((m) => m.round === 1 && m.id !== m1.id)!;
  assert.deepEqual([other.entry_a, other.entry_b].sort(), [c, d].sort());
  await result(other.id, [[6, 1], [6, 1]]);
  lc = await loadCategory(sql, tcId, orgId);
  const gvg = zm().find((m) => m.slot === "GVG")!;
  assert.ok(gvg.entry_a && gvg.entry_b, "ganador vs ganador definido");
  // Volver a todos contra todos: 6 partidos, los 2 jugados intactos
  await tx((x) => ops.setFourZoneFormat(x, user, tcId, "RR", true));
  lc = await loadCategory(sql, tcId, orgId);
  assert.equal(zm().length, 6);
  assert.equal(zm().filter((m) => m.status === "PLAYED").length, 2);
  void entries;
});
