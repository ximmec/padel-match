/**
 * Pruebas de integración contra PostgreSQL real (se ejecutan en GitHub Actions).
 * Requieren DATABASE_URL apuntando a una base vacía con las migraciones aplicadas.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "../../src/server/db";
import * as ops from "../../src/server/ops";
import { NeedsConfirmation } from "../../src/server/errors";
import { loadCategory } from "../../src/server/category";
import { generateTournamentSchedule, moveMatchSchedule, loadTournamentSchedule, scheduleConflicts } from "../../src/server/schedule";
import { getRanking, manualAdjustment } from "../../src/server/ranking";
import { effectivePermissions } from "../../src/server/permissions";
import type { CurrentUser } from "../../src/server/auth";
import { DEFAULT_RULES, type CategoryRules } from "../../src/core/engine";
import type { SetScore } from "../../src/core/scoring";

let user: CurrentUser;
let orgId: string;
let venueId: string;

async function tx<T>(fn: (t: Parameters<Parameters<typeof sql.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sql.begin(fn) as Promise<T>;
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
  const winner = (first.a.kind === "ENTRY" && first.a.entryId)!;
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
