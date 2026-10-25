/**
 * Operaciones de negocio transaccionales. Cada función recibe una transacción (`tx`)
 * y deja registro en la auditoría. Las Server Actions (src/server/actions) las invocan.
 */
import type { Tx } from "./db";
import { UserError } from "./db";
import type { CurrentUser } from "./auth";
import { audit } from "./audit";
import { NeedsConfirmation } from "./errors";
import { loadCategory, categoryCap, entryLabel, type LoadedCategory, type MatchRow, zoneSideLabel } from "./category";
import { recalcRanking } from "./ranking";
import {
  planZoneSizes, validateZoneSizes, distributeEntries, roundRobin, zoneName,
} from "@/core/zones";
import {
  generateBracket as coreGenerateBracket, qualifierRefs, knockoutQualifiers, diffBracket, refLabel, type SlotRef, type BracketMatchDef,
} from "@/core/bracket";
import { evaluateCategory, normalizeRules, withdrawalChanges, fourZoneFormat, type CategoryRules, type WithdrawalPolicy } from "@/core/engine";
import { summarize, ScoreError, scoreText, type MatchOutcome } from "@/core/scoring";

const j = (v: unknown) => JSON.stringify(v);

/* ------------------------------------------------------------------ */
/* Torneos                                                             */
/* ------------------------------------------------------------------ */

export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "torneo";
}

export async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const s = slugify(base);
  for (let i = 0; i < 100; i++) {
    const cand = i === 0 ? s : `${s}-${i + 1}`;
    const [r] = await tx`SELECT 1 FROM tournaments WHERE slug = ${cand}`;
    if (!r) return cand;
  }
  return `${s}-${Date.now()}`;
}

export async function assertTournament(tx: Tx, user: CurrentUser, tournamentId: string) {
  const [t] = await tx<{ id: string; name: string; venue_id: string | null }[]>`SELECT id, name, venue_id FROM tournaments WHERE id = ${tournamentId} AND org_id = ${user.orgId}`;
  if (!t) throw new UserError("Torneo no encontrado.");
  return t;
}

export async function addCategory(tx: Tx, user: CurrentUser, tournamentId: string, categoryId: string, rules: CategoryRules) {
  const t = await assertTournament(tx, user, tournamentId);
  const [c] = await tx<{ name: string }[]>`SELECT name FROM categories WHERE id = ${categoryId} AND org_id = ${user.orgId}`;
  if (!c) throw new UserError("Categoría no encontrada.");
  const [tc] = await tx<{ id: string }[]>`
    INSERT INTO tournament_categories (tournament_id, category_id, rules) VALUES (${tournamentId}, ${categoryId}, ${j(rules)}::text::jsonb) RETURNING id`;
  await audit(tx, user, { entity: "tournament_category", entityId: tc.id, action: "create", tournamentId, summary: `Categoría ${c.name} agregada a ${t.name}`, after: rules });
  return tc.id;
}

export async function updateRules(tx: Tx, user: CurrentUser, tcId: string, rules: CategoryRules, confirmed: boolean) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (rules.mode !== lc.rules.mode && (lc.zones.length || lc.tc.bracket.length)) {
    throw new UserError("Para cambiar entre «Zonas + playoffs» y «Eliminación directa», primero eliminá las zonas y el cuadro (o usá «Reiniciar categoría → Empezar de cero»).");
  }
  const playedCount = lc.matches.filter((m) => m.status === "PLAYED").length;
  // Validar que los resultados existentes sigan siendo válidos con el nuevo formato
  const probe = evaluateCategory(rules, lc.state);
  if (probe.errors.length) {
    throw new UserError(`Con el nuevo formato, ${probe.errors.length} resultado(s) cargado(s) quedarían inválidos. Corregilos primero o mantené el formato.`);
  }
  const impact = diffBracket(lc.view.bracket, probe.bracket, new Set(lc.matches.filter((m) => m.phase === "BRACKET" && m.status === "PLAYED").map((m) => m.bracket_code!)));
  if (!confirmed && (playedCount > 0 || impact.length)) {
    const items = [`Hay ${playedCount} partido(s) con resultado: las posiciones se recalcularán con las nuevas reglas.`];
    if (impact.length) items.push(`${impact.length} cruce(s) del cuadro cambiarían.`);
    if (impact.some((i) => i.hadResult)) items.push("Algunos resultados del cuadro quedarán invalidados.");
    throw new NeedsConfirmation("Cambiar reglas de una categoría en juego", items);
  }
  if (fourZoneFormat(rules) !== fourZoneFormat(lc.rules)) await convertFourZones(tx, user, lc, fourZoneFormat(rules), confirmed);
  await tx`UPDATE tournament_categories SET rules = ${j(rules)}::text::jsonb, version = version + 1 WHERE id = ${tcId}`;
  await audit(tx, user, { entity: "tournament_category", entityId: tcId, action: "update", tournamentId: lc.tc.tournament_id, summary: `Reglas de ${lc.tc.category_name} modificadas`, before: lc.rules, after: rules });
  await afterChange(tx, user, tcId);
}

/** Atajo desde Zonas: cambia solo el formato de las zonas de 4 (GvG/PvP o todos contra todos). */
export async function setFourZoneFormat(tx: Tx, user: CurrentUser, tcId: string, to: "GVG" | "RR", confirmed: boolean) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (to === "RR" && lc.rules.qualification.perZone === "ALL") throw new UserError("Cuando clasifican todas, las zonas de 4 se juegan ganador vs ganador / perdedor vs perdedor (así todas juegan 2 partidos).");
  await convertFourZones(tx, user, lc, to, confirmed);
  if (lc.rules.fourZone !== to) await updateRules(tx, user, tcId, { ...lc.rules, fourZone: to }, true);
  else await afterChange(tx, user, tcId);
}

/* ------------------------------------------------------------------ */
/* Inscripciones                                                       */
/* ------------------------------------------------------------------ */

async function checkGender(tx: Tx, rule: string, playerIds: string[], orgId: string) {
  const ps = await tx<{ id: string; gender: string; first_name: string; last_name: string; deleted_at: Date | null }[]>`
    SELECT id, gender, first_name, last_name, deleted_at FROM players WHERE id = ANY(${playerIds}::uuid[]) AND org_id = ${orgId}`;
  if (ps.length !== playerIds.length) throw new UserError("Algún jugador no existe.");
  if (ps.some((p) => p.deleted_at)) throw new UserError("No se puede inscribir a un jugador dado de baja.");
  // Los jugadores con sexo/género «sin definir» (X) pueden inscribirse en cualquier categoría.
  if (rule === "MALE" && ps.some((p) => p.gender === "F")) throw new UserError("Esta categoría es masculina: no se puede inscribir a una jugadora registrada como femenina.");
  if (rule === "FEMALE" && ps.some((p) => p.gender === "M")) throw new UserError("Esta categoría es femenina: no se puede inscribir a un jugador registrado como masculino.");
  // Mixta: se permite cualquier combinación (dos hombres, dos mujeres o un hombre y una mujer).
  return ps;
}

export async function registerEntry(tx: Tx, user: CurrentUser, tcId: string, p1: string, p2: string, seed: number | null) {
  if (p1 === p2) throw new UserError("Elegí dos jugadores distintos.");
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const ps = await checkGender(tx, lc.tc.gender_rule, [p1, p2], user.orgId);
  const cap = categoryCap(lc);
  const activeCount = lc.entries.filter((x) => x.status === "ACTIVE").length;
  if (cap && activeCount >= cap) throw new UserError(`Se completó el cupo de ${cap} parejas de ${lc.tc.category_name}. Si querés sumar más, subí el cupo en «Editar torneo» o en las Reglas de la categoría.`);
  // Incompatibilidad: el mismo jugador en otra categoría del mismo torneo con horarios superpuestos se permite,
  // pero no dos veces en la misma categoría (lo garantiza un índice único).
  const [e] = await tx<{ id: string }[]>`INSERT INTO entries (tc_id, seed) VALUES (${tcId}, ${seed}) RETURNING id`;
  await tx`INSERT INTO entry_players (entry_id, tc_id, player_id, slot) VALUES (${e.id}, ${tcId}, ${p1}, 1), (${e.id}, ${tcId}, ${p2}, 2)`;
  const label = ps.map((p) => `${p.first_name} ${p.last_name}`).join(" / ");
  await audit(tx, user, { entity: "entry", entityId: e.id, action: "create", tournamentId: lc.tc.tournament_id, summary: `Inscripción de ${label} en ${lc.tc.category_name}`, after: { p1, p2, seed } });
  return e.id;
}

/**
 * Cambio de pareja: intercambia un jugador de una pareja con un jugador de otra pareja de la misma categoría.
 * Cada pareja conserva su lugar en la zona, sus resultados y sus puntos; queda registrado en el historial.
 */
export async function swapPlayers(tx: Tx, user: CurrentUser, entryA: string, slotA: 1 | 2, entryB: string, slotB: 1 | 2) {
  if (entryA === entryB) throw new UserError("Elegí un jugador de otra pareja.");
  const { lc, entry: a } = await entryContext(tx, user, entryA);
  const b = lc.entryMap.get(entryB);
  if (!b) throw new UserError("La otra pareja no es de esta categoría.");
  if (a.status !== "ACTIVE" || b.status !== "ACTIVE") throw new UserError("Las dos parejas tienen que estar activas.");
  const pa = a.players.find((p) => p.slot === slotA), pb = b.players.find((p) => p.slot === slotB);
  if (!pa || !pb) throw new UserError("Jugador inválido.");
  const restA = a.players.find((p) => p.slot !== slotA), restB = b.players.find((p) => p.slot !== slotB);
  await checkGender(tx, lc.tc.gender_rule, restA ? [restA.id, pb.id] : [pb.id], user.orgId);
  await checkGender(tx, lc.tc.gender_rule, restB ? [restB.id, pa.id] : [pa.id], user.orgId);
  await tx`UPDATE entry_players SET active = false, replaced_at = now() WHERE (entry_id = ${entryA} AND slot = ${slotA} OR entry_id = ${entryB} AND slot = ${slotB}) AND replaced_at IS NULL`;
  await tx`INSERT INTO entry_players (entry_id, tc_id, player_id, slot, active, paid_at) VALUES (${entryA}, ${lc.tc.id}, ${pb.id}, ${slotA}, true, ${pb.paid_at ? new Date(pb.paid_at) : null}), (${entryB}, ${lc.tc.id}, ${pa.id}, ${slotB}, true, ${pa.paid_at ? new Date(pa.paid_at) : null})`;
  const nm = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;
  await audit(tx, user, {
    entity: "entry", entityId: entryA, action: "replace_player", tournamentId: lc.tc.tournament_id,
    summary: `Cambio de pareja: ${nm(pa)} pasa a ${entryLabel(b)} y ${nm(pb)} pasa a ${entryLabel(a)}. Cada pareja conserva su zona y sus resultados.`,
    before: { [entryA]: pa.id, [entryB]: pb.id }, after: { [entryA]: pb.id, [entryB]: pa.id },
  });
  await afterChange(tx, user, lc.tc.id);
}

/**
 * Sumar una pareja con el torneo ya armado, sin reorganizar nada ni tocar resultados:
 * - Zonas + playoffs: entra en la zona elegida (o en la que tenga menos parejas) y se le crean sus partidos.
 * - Eliminación directa con cuadro: ocupa un pase libre de la primera ronda.
 * Devuelve dónde quedó.
 */
export async function placeLateEntry(tx: Tx, user: CurrentUser, tcId: string, entryId: string, zoneId: string | null): Promise<string | null> {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (lc.rules.mode === "KNOCKOUT") {
    if (!lc.tc.bracket.length) return null;
    const r1 = lc.tc.bracket.filter((d) => d.round === 1);
    const playedCodes = new Set(lc.matches.filter((m) => m.phase === "BRACKET" && m.status !== "PENDING").map((m) => m.bracket_code));
    const nextOf = (code: string) => lc.tc.bracket.find((d) => [d.a, d.b].some((r) => r.t === "WINNER" && r.match === code));
    const spot = [...r1].reverse().find((d) => {
      const bye = d.a.t === "BYE" ? "a" : d.b.t === "BYE" ? "b" : null;
      const nx = nextOf(d.code);
      return bye && !playedCodes.has(d.code) && !(nx && playedCodes.has(nx.code));
    });
    if (!spot) throw new UserError("No quedan pases libres disponibles en el cuadro para ubicar a la pareja. Si el cuadro no tiene resultados, podés regenerarlo.");
    const side = spot.a.t === "BYE" ? "a" : "b";
    await setBracketSlot(tx, user, tcId, spot.code, side, { t: "ENTRY", entryId }, true);
    return `ubicada en el cuadro (partido ${spot.code}, en lugar de un pase libre)`;
  }
  if (!lc.zones.length) return null;
  const candidates = lc.zones.filter((z) => z.format !== "GVG");
  if (!candidates.length) throw new UserError("Todas las zonas son GvG/PvP (de 4 fijas): no se puede sumar una pareja a una zona. Inscribila y regenerá las zonas si todavía no hay resultados.");
  const target = zoneId ? candidates.find((z) => z.id === zoneId) : [...candidates].sort((a, b) => a.entry_ids.length - b.entry_ids.length || a.sort - b.sort)[0];
  if (!target) throw new UserError("Esa zona no admite parejas nuevas.");
  await moveEntry(tx, user, entryId, target.id, true);
  return `agregada a la Zona ${target.name} con sus partidos nuevos`;
}

/** Marcar / desmarcar que un jugador de la pareja pagó el arancel. */
export async function togglePaid(tx: Tx, user: CurrentUser, entryId: string, slot: 1 | 2) {
  const { lc, entry } = await entryContext(tx, user, entryId);
  const p = entry.players.find((x) => x.slot === slot);
  if (!p) throw new UserError("Jugador no encontrado.");
  const paid = !p.paid_at;
  await tx`UPDATE entry_players SET paid_at = ${paid ? new Date() : null}, paid_by = ${paid ? user.id : null} WHERE entry_id = ${entryId} AND slot = ${slot} AND replaced_at IS NULL`;
  await audit(tx, user, { entity: "entry", entityId: entryId, action: "update", tournamentId: lc.tc.tournament_id, summary: `${p.first_name} ${p.last_name} (${lc.tc.category_name}): ${paid ? "pagó el arancel" : "se quitó la marca de pago"}` });
  return paid;
}

export async function setEntryRestriction(tx: Tx, user: CurrentUser, entryId: string, from: string | null, to: string | null, note: string | null) {
  const { lc, entry } = await entryContext(tx, user, entryId);
  await tx`UPDATE entries SET not_before = ${from}, not_after = ${to}, restriction_note = ${note} WHERE id = ${entryId}`;
  await audit(tx, user, { entity: "entry", entityId: entryId, action: "update", tournamentId: lc.tc.tournament_id, summary: `Restricción horaria de ${entryLabel(entry)}: ${[from && `desde ${from}`, to && `hasta ${to}`, note].filter(Boolean).join(" · ") || "sin restricción"}` });
}

export async function setSeed(tx: Tx, user: CurrentUser, entryId: string, seed: number | null) {
  const [e] = await tx<{ tc_id: string; seed: number | null; tournament_id: string }[]>`
    SELECT e.tc_id, e.seed, tc.tournament_id FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    WHERE e.id = ${entryId} AND t.org_id = ${user.orgId}`;
  if (!e) throw new UserError("Inscripción no encontrada.");
  await tx`UPDATE entries SET seed = ${seed} WHERE id = ${entryId}`;
  await audit(tx, user, { entity: "entry", entityId: entryId, action: "update", tournamentId: e.tournament_id, summary: `Cabeza de serie: ${seed ?? "ninguna"}`, before: { seed: e.seed }, after: { seed } });
}

async function entryContext(tx: Tx, user: CurrentUser, entryId: string) {
  const [e] = await tx<{ tc_id: string }[]>`
    SELECT e.tc_id FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    WHERE e.id = ${entryId} AND t.org_id = ${user.orgId}`;
  if (!e) throw new UserError("Inscripción no encontrada.");
  const lc = await loadCategory(tx, e.tc_id, user.orgId, { lock: true });
  const entry = lc.entryMap.get(entryId)!;
  return { lc, entry };
}

export async function deleteEntry(tx: Tx, user: CurrentUser, entryId: string) {
  const { lc, entry } = await entryContext(tx, user, entryId);
  if (lc.matches.some((m) => m.entry_a === entryId || m.entry_b === entryId) || lc.zones.some((z) => z.entry_ids.includes(entryId))) {
    throw new UserError("La pareja ya está en una zona o tiene partidos. Usá «Retirar» para conservar el historial.");
  }
  await tx`DELETE FROM entries WHERE id = ${entryId}`;
  await audit(tx, user, { entity: "entry", entityId: entryId, action: "delete", tournamentId: lc.tc.tournament_id, summary: `Inscripción eliminada: ${entryLabel(entry)}`, before: entry });
}

export async function withdrawEntry(tx: Tx, user: CurrentUser, entryId: string, policy: WithdrawalPolicy, confirmed: boolean) {
  const { lc, entry } = await entryContext(tx, user, entryId);
  if (entry.status === "WITHDRAWN") throw new UserError("La pareja ya está retirada.");
  const zoneChanges = withdrawalChanges(entryId, lc.state.zoneMatches, policy);
  // Partidos de cuadro pendientes donde la pareja ya está definida → W.O. para el rival
  const bracketWo = lc.view.bracket.filter((m) => !m.winner && m.a.kind === "ENTRY" && m.b.kind === "ENTRY" && (m.a.entryId === entryId || m.b.entryId === entryId));
  if (!confirmed) {
    const items: string[] = [];
    if (policy === "WO_PENDING") items.push(`${zoneChanges.length} partido(s) de zona pendiente(s) se darán por W.O. a favor del rival. Los ya jugados se mantienen.`);
    else items.push(`Se anularán ${zoneChanges.length} partido(s) de zona (jugados y pendientes). La pareja saldrá de la tabla.`);
    if (bracketWo.length) items.push(`${bracketWo.length} partido(s) del cuadro se darán por W.O.`);
    items.push("Las posiciones y el cuadro se recalcularán.");
    throw new NeedsConfirmation(`Retirar a ${entryLabel(entry)}`, items);
  }
  await tx`UPDATE entries SET status = 'WITHDRAWN', withdrawn_at = now(), withdrawal_policy = ${policy} WHERE id = ${entryId}`;
  await tx`UPDATE entry_players SET active = false WHERE entry_id = ${entryId}`;
  for (const ch of zoneChanges) {
    const m = lc.matches.find((x) => x.id === ch.matchId)!;
    await saveMatchResult(tx, user, m, ch.status, ch.outcome, `Retiro de ${entryLabel(entry)}`);
  }
  for (const bm of bracketWo) {
    const row = lc.matches.find((x) => x.phase === "BRACKET" && x.bracket_code === bm.code);
    if (!row || bm.a.kind !== "ENTRY" || bm.b.kind !== "ENTRY") continue;
    const winner = bm.a.entryId === entryId ? "B" : "A";
    await saveMatchResult(tx, user, row, "PLAYED", { kind: "WALKOVER", winner }, `Retiro de ${entryLabel(entry)}`, bm.a.entryId, bm.b.entryId);
  }
  await audit(tx, user, { entity: "entry", entityId: entryId, action: "withdraw", tournamentId: lc.tc.tournament_id, summary: `Retiro de ${entryLabel(entry)} (${policy === "WO_PENDING" ? "W.O. en pendientes" : "anulación total"})`, after: { policy } });
  await afterChange(tx, user, lc.tc.id);
}

/**
 * Jugador cargado al vuelo (por ejemplo, un reemplazo con el torneo en juego): si ya existe uno
 * con el mismo nombre se reutiliza; si no, se crea con lo mínimo y se completa después en Jugadores.
 */
export async function quickPlayer(tx: Tx, user: CurrentUser, firstName: string, lastName: string, genderRule: string): Promise<string> {
  const first = firstName.trim().replace(/\s+/g, " "), last = lastName.trim().replace(/\s+/g, " ");
  if (first.length < 2 || last.length < 2) throw new UserError("Escribí nombre y apellido del jugador nuevo.");
  if (first.length > 60 || last.length > 60) throw new UserError("Nombre demasiado largo.");
  const [dup] = await tx<{ id: string }[]>`SELECT id FROM players WHERE org_id = ${user.orgId} AND deleted_at IS NULL
    AND lower(first_name) = lower(${first}) AND lower(last_name) = lower(${last}) ORDER BY created_at LIMIT 1`;
  if (dup) return dup.id;
  const gender = genderRule === "MALE" ? "M" : genderRule === "FEMALE" ? "F" : "X";
  const [{ n }] = await tx<{ n: string }[]>`SELECT nextval('player_code_seq')::text AS n`;
  const code = `PM-${n.padStart(5, "0")}`;
  const [p] = await tx<{ id: string }[]>`INSERT INTO players (org_id, code, first_name, last_name, gender, notes)
    VALUES (${user.orgId}, ${code}, ${first}, ${last}, ${gender}, ${"Cargado como reemplazo durante un torneo"}) RETURNING id`;
  await audit(tx, user, { entity: "player", entityId: p.id, action: "create", summary: `Jugador ${first} ${last} (${code}) creado como reemplazo` });
  return p.id;
}

export async function replacePlayer(tx: Tx, user: CurrentUser, entryId: string, slot: 1 | 2, newPlayerId: string) {
  const { lc, entry } = await entryContext(tx, user, entryId);
  const old = entry.players.find((p) => p.slot === slot);
  if (!old) throw new UserError("Lugar inválido.");
  if (old.id === newPlayerId) throw new UserError("Es el mismo jugador.");
  const other = entry.players.find((p) => p.slot !== slot);
  const ps = await checkGender(tx, lc.tc.gender_rule, other ? [other.id, newPlayerId] : [newPlayerId], user.orgId);
  const np = ps.find((p) => p.id === newPlayerId)!;
  await tx`UPDATE entry_players SET active = false, replaced_at = now() WHERE entry_id = ${entryId} AND slot = ${slot} AND replaced_at IS NULL`;
  await tx`INSERT INTO entry_players (entry_id, tc_id, player_id, slot, active) VALUES (${entryId}, ${lc.tc.id}, ${newPlayerId}, ${slot}, ${entry.status === "ACTIVE"})`;
  await audit(tx, user, {
    entity: "entry", entityId: entryId, action: "replace_player", tournamentId: lc.tc.tournament_id,
    summary: `Reemplazo en ${entryLabel(entry)}: sale ${old.first_name} ${old.last_name}, entra ${np.first_name} ${np.last_name}. Los resultados de la pareja se conservan.`,
    before: { playerId: old.id }, after: { playerId: newPlayerId },
  });
  await afterChange(tx, user, lc.tc.id);
}

/* ------------------------------------------------------------------ */
/* Zonas                                                               */
/* ------------------------------------------------------------------ */

/** Zona GvG/PvP: 1ª ronda A vs B y C vs D (orden de la zona); la 2ª ronda (ganadores y perdedores) se completa sola. */
async function createGvgFixtures(tx: Tx, tcId: string, zoneId: string, entryIds: string[]) {
  const [e1, e2, e3, e4] = entryIds;
  await tx`INSERT INTO matches (tc_id, phase, zone_id, round, entry_a, entry_b) VALUES (${tcId}, 'ZONE', ${zoneId}, 1, ${e1}, ${e2}), (${tcId}, 'ZONE', ${zoneId}, 1, ${e3}, ${e4})`;
  await tx`INSERT INTO matches (tc_id, phase, zone_id, round, slot) VALUES (${tcId}, 'ZONE', ${zoneId}, 2, 'GVG'), (${tcId}, 'ZONE', ${zoneId}, 2, 'PVP')`;
}

/**
 * Completa (o vuelve a dejar «a definir») la 2ª ronda de las zonas GvG según los resultados de la 1ª.
 * Si una corrección cambia quién juega y ese partido ya tenía resultado, el resultado queda invalidado.
 */
async function syncGvgZones(tx: Tx, user: CurrentUser, lc: LoadedCategory): Promise<boolean> {
  let changed = false;
  for (const z of lc.zones.filter((x) => x.format === "GVG")) {
    const ms = lc.matches.filter((m) => m.zone_id === z.id && m.status !== "ANNULLED");
    const pos = (id: string | null) => (id ? z.entry_ids.indexOf(id) : 99);
    const r1 = ms.filter((m) => m.round === 1).sort((a, b) => Math.min(pos(a.entry_a), pos(a.entry_b)) - Math.min(pos(b.entry_a), pos(b.entry_b)));
    const win = (m: MatchRow) => { const sm = lc.view.summaries.get(m.id); return sm ? (sm.winner === "A" ? m.entry_a : m.entry_b) : null; };
    const lose = (m: MatchRow) => { const sm = lc.view.summaries.get(m.id); return sm ? (sm.winner === "A" ? m.entry_b : m.entry_a) : null; };
    const done = r1.length === 2 && r1.every((m) => m.status === "PLAYED" && lc.view.summaries.has(m.id));
    for (const m of ms.filter((x) => x.slot)) {
      const want: [string | null, string | null] = !done ? [null, null] : m.slot === "GVG" ? [win(r1[0]), win(r1[1])] : [lose(r1[0]), lose(r1[1])];
      if (m.entry_a === want[0] && m.entry_b === want[1]) continue;
      changed = true;
      if (m.status === "PLAYED" || m.status === "IN_PLAY") {
        await saveMatchResult(tx, user, m, "PENDING", null, "Invalidado: cambiaron las parejas por una corrección de la 1ª ronda", want[0], want[1]);
        await audit(tx, user, { entity: "match", entityId: m.id, action: "result_correction", tournamentId: lc.tc.tournament_id, summary: `Zona ${z.name}: resultado de ${m.slot === "GVG" ? "ganadores" : "perdedores"} invalidado porque cambió la 1ª ronda`, before: { outcome: m.outcome, entryA: m.entry_a, entryB: m.entry_b } });
      } else {
        await tx`UPDATE matches SET entry_a = ${want[0]}, entry_b = ${want[1]}, version = version + 1, updated_at = now() WHERE id = ${m.id}`;
      }
    }
  }
  return changed;
}

/**
 * Cambia el formato de las zonas de 4 ya armadas (con o sin partidos jugados):
 * - a GvG/PvP: la 1ª ronda se elige respetando los partidos ya jugados (A vs B y C vs D si no hay ninguno);
 *   la 2ª ronda (ganadores vs ganadores y perdedores vs perdedores) se completa sola. Un partido jugado que no
 *   encaja queda anulado (visible en el historial).
 * - a todos contra todos: se agregan los partidos que falten; no se pierde ningún resultado.
 */
async function convertFourZones(tx: Tx, user: CurrentUser, lc: LoadedCategory, to: "GVG" | "RR", confirmed: boolean) {
  const zones = lc.zones.filter((z) => z.entry_ids.length === 4 && z.format !== to);
  if (!zones.length) return;
  const same = (m: MatchRow, a: string, b: string) => (m.entry_a === a && m.entry_b === b) || (m.entry_a === b && m.entry_b === a);
  const items: string[] = [];
  const plans = zones.map((z) => {
    const ms = lc.matches.filter((m) => m.zone_id === z.id && m.status !== "ANNULLED");
    const played = ms.filter((m) => m.status === "PLAYED" || m.status === "IN_PLAY");
    if (to === "RR") return { z, ms, played, r1: [] as [string, string][], reuse: [] as { m: MatchRow; slot: "GVG" | "PVP" }[], annul: [] as MatchRow[] };
    const [e0, e1, e2, e3] = z.entry_ids;
    const options: [string, string][][] = [[[e0, e1], [e2, e3]], [[e0, e3], [e1, e2]], [[e0, e2], [e1, e3]]];
    const score = (o: [string, string][]) => o.filter(([a, b]) => played.some((m) => same(m, a, b))).length;
    const r1 = options.reduce((best, o) => (score(o) > score(best) ? o : best), options[0]);
    const r1Played = r1.map(([a, b]) => played.find((m) => same(m, a, b) && m.status === "PLAYED" && lc.view.summaries.has(m.id)));
    const winLose = (m: MatchRow) => { const w = lc.view.summaries.get(m.id)!.winner; return w === "A" ? [m.entry_a!, m.entry_b!] : [m.entry_b!, m.entry_a!]; };
    const reuse: { m: MatchRow; slot: "GVG" | "PVP" }[] = [];
    const annul: MatchRow[] = [];
    for (const m of played) {
      if (r1.some(([a, b]) => same(m, a, b))) continue;
      if (r1Played[0] && r1Played[1]) {
        const [w0, l0] = winLose(r1Played[0]), [w1, l1] = winLose(r1Played[1]);
        if (same(m, w0, w1)) { reuse.push({ m, slot: "GVG" }); continue; }
        if (same(m, l0, l1)) { reuse.push({ m, slot: "PVP" }); continue; }
      }
      annul.push(m);
    }
    const name = (id: string) => entryLabel(lc.entryMap.get(id));
    items.push(`Zona ${z.name}: 1ª ronda ${r1.map(([a, b]) => `${name(a)} vs ${name(b)}`).join(" y ")}; después ganadores vs ganadores y perdedores vs perdedores.`);
    if (annul.length) items.push(`Zona ${z.name}: ${annul.length} partido(s) ya jugado(s) no encajan y quedarían anulados (se ven en el historial): ${annul.map((m) => `${name(m.entry_a!)} vs ${name(m.entry_b!)}`).join(", ")}.`);
    return { z, ms, played, r1, reuse, annul };
  });
  if (to === "RR") items.push(...zones.map((z) => `Zona ${z.name}: pasa a todos contra todos; se agregan los partidos que falten y se conservan los jugados.`));
  if (!confirmed) throw new NeedsConfirmation(to === "GVG" ? "Pasar las zonas de 4 a GvG/PvP" : "Pasar las zonas de 4 a todos contra todos", items);

  for (const p of plans) {
    if (to === "RR") {
      await tx`DELETE FROM matches WHERE zone_id = ${p.z.id} AND slot IS NOT NULL AND status = 'PENDING'`;
      await tx`UPDATE matches SET slot = NULL WHERE zone_id = ${p.z.id} AND slot IS NOT NULL`;
      const fresh = await loadCategory(tx, lc.tc.id, user.orgId);
      await createFixtures(tx, lc.tc.id, p.z.id, p.z.entry_ids, fresh.matches);
    } else {
      const keep = new Set<string>();
      for (const [a, b] of p.r1) {
        const m = p.ms.find((x) => same(x, a, b) && x.status !== "PENDING") ?? p.ms.find((x) => same(x, a, b));
        if (m) { keep.add(m.id); await tx`UPDATE matches SET round = 1, slot = NULL, updated_at = now() WHERE id = ${m.id}`; }
        else await tx`INSERT INTO matches (tc_id, phase, zone_id, round, entry_a, entry_b) VALUES (${lc.tc.id}, 'ZONE', ${p.z.id}, 1, ${a}, ${b})`;
      }
      for (const r of p.reuse) { keep.add(r.m.id); await tx`UPDATE matches SET round = 2, slot = ${r.slot}, updated_at = now() WHERE id = ${r.m.id}`; }
      for (const m of p.annul) { keep.add(m.id); await saveMatchResult(tx, user, m, "ANNULLED", m.outcome, `Zona ${p.z.name} pasó a GvG/PvP`); }
      const drop = p.ms.filter((m) => !keep.has(m.id) && m.status === "PENDING").map((m) => m.id);
      if (drop.length) await tx`DELETE FROM matches WHERE id = ANY(${drop}::uuid[])`;
      for (const slot of ["GVG", "PVP"] as const) {
        if (!p.reuse.some((r) => r.slot === slot)) await tx`INSERT INTO matches (tc_id, phase, zone_id, round, slot) VALUES (${lc.tc.id}, 'ZONE', ${p.z.id}, 2, ${slot})`;
      }
    }
    await tx`UPDATE zones SET format = ${to} WHERE id = ${p.z.id}`;
    await audit(tx, user, { entity: "zone", entityId: p.z.id, action: "update", tournamentId: lc.tc.tournament_id, summary: `Zona ${p.z.name} (${lc.tc.category_name}) pasó a ${to === "GVG" ? "GvG/PvP" : "todos contra todos"}` });
  }
}

async function createFixtures(tx: Tx, tcId: string, zoneId: string, entryIds: string[], existing: MatchRow[]) {
  const has = (a: string, b: string) => existing.some((m) => m.zone_id === zoneId && m.status !== "ANNULLED" && ((m.entry_a === a && m.entry_b === b) || (m.entry_a === b && m.entry_b === a)));
  for (const f of roundRobin(entryIds.length)) {
    const a = entryIds[f.a], b = entryIds[f.b];
    if (has(a, b)) continue;
    await tx`INSERT INTO matches (tc_id, phase, zone_id, round, entry_a, entry_b) VALUES (${tcId}, 'ZONE', ${zoneId}, ${f.round}, ${a}, ${b})`;
  }
}

export async function generateZones(tx: Tx, user: CurrentUser, tcId: string, sizes: number[] | null, randomSeed: number, manual?: string[][]) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (lc.rules.mode === "KNOCKOUT") throw new UserError("Esta categoría es de eliminación directa: no tiene zonas. Generá el cuadro directamente.");
  if (lc.matches.some((m) => m.phase === "ZONE" && m.status === "PLAYED")) {
    throw new UserError("Ya hay resultados de zona. Para reorganizar usá «Mover de zona» y así no se pierden los resultados.");
  }
  if (lc.tc.bracket.length) throw new UserError("Ya hay un cuadro generado. Eliminá el cuadro antes de regenerar las zonas.");
  const active = lc.entries.filter((e) => e.status === "ACTIVE");
  if (active.length < 2) throw new UserError("Se necesitan al menos 2 parejas inscriptas.");
  let plan: number[];
  let groups: { id: string }[][];
  if (manual) {
    const ids = new Set(active.map((e) => e.id));
    const seen = new Set<string>();
    for (const g of manual) for (const id of g) {
      if (!ids.has(id)) throw new UserError("Hay una pareja que no está inscripta (o fue retirada). Recargá la página.");
      if (seen.has(id)) throw new UserError(`${entryLabel(lc.entryMap.get(id))} está en dos zonas.`);
      seen.add(id);
    }
    const missing = active.filter((e) => !seen.has(e.id));
    if (missing.length) throw new UserError(`Faltan ubicar: ${missing.map((e) => entryLabel(e)).join(", ")}.`);
    plan = manual.map((g) => g.length);
    validateZoneSizes(active.length, plan);
    groups = manual.map((g) => g.map((id) => ({ id })));
  } else {
    plan = sizes ?? planZoneSizes(active.length, { preferredSize: lc.rules.preferredZoneSize });
    validateZoneSizes(active.length, plan);
    groups = distributeEntries(active.map((e) => ({ id: e.id, seed: e.seed })), plan, randomSeed);
  }

  const before = lc.zones.map((z) => ({ name: z.name, entries: z.entry_ids }));
  await tx`DELETE FROM matches WHERE tc_id = ${tcId} AND phase = 'ZONE'`;
  await tx`DELETE FROM zones WHERE tc_id = ${tcId}`;
  for (let i = 0; i < groups.length; i++) {
    const ids = groups[i].map((e) => e.id);
    const gvg = ids.length === 4 && fourZoneFormat(lc.rules) === "GVG";
    const [z] = await tx<{ id: string }[]>`INSERT INTO zones (tc_id, name, sort, format) VALUES (${tcId}, ${zoneName(i)}, ${i}, ${gvg ? "GVG" : "RR"}) RETURNING id`;
    for (let k = 0; k < ids.length; k++) await tx`INSERT INTO zone_entries (zone_id, entry_id, tc_id, sort) VALUES (${z.id}, ${ids[k]}, ${tcId}, ${k})`;
    if (gvg) await createGvgFixtures(tx, tcId, z.id, ids);
    else await createFixtures(tx, tcId, z.id, ids, []);
  }
  await tx`UPDATE tournament_categories SET status = 'ZONES', version = version + 1 WHERE id = ${tcId}`;
  await audit(tx, user, {
    entity: "zones", entityId: tcId, action: "generate_zones", tournamentId: lc.tc.tournament_id,
    summary: `Zonas ${manual ? "armadas a mano" : "generadas"} para ${lc.tc.category_name}: ${plan.join(", ")} parejas${manual ? "" : ` (sorteo #${randomSeed})`}`,
    before, after: groups.map((g, i) => ({ name: zoneName(i), entries: g.map((e) => e.id) })),
  });
}

export async function addZone(tx: Tx, user: CurrentUser, tcId: string) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const names = new Set(lc.zones.map((z) => z.name));
  let i = 0;
  while (names.has(zoneName(i))) i++;
  await tx`INSERT INTO zones (tc_id, name, sort) VALUES (${tcId}, ${zoneName(i)}, ${lc.zones.length})`;
  await audit(tx, user, { entity: "zone", action: "create", tournamentId: lc.tc.tournament_id, summary: `Zona ${zoneName(i)} creada en ${lc.tc.category_name}` });
}

export async function deleteZone(tx: Tx, user: CurrentUser, zoneId: string) {
  const [z] = await tx<{ tc_id: string; name: string }[]>`SELECT z.tc_id, z.name FROM zones z JOIN tournament_categories tc ON tc.id = z.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE z.id = ${zoneId} AND t.org_id = ${user.orgId}`;
  if (!z) throw new UserError("Zona no encontrada.");
  const [n] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM zone_entries WHERE zone_id = ${zoneId}`;
  if (n.n > 0) throw new UserError("La zona tiene parejas. Movelas a otra zona primero.");
  const lc = await loadCategory(tx, z.tc_id, user.orgId, { lock: true });
  if (lc.tc.bracket.some((d) => [d.a, d.b].some((r) => r.t === "ZONE" && r.zone === zoneId))) throw new UserError("El cuadro hace referencia a esta zona. Regenerá el cuadro primero.");
  await tx`DELETE FROM matches WHERE zone_id = ${zoneId} AND status <> 'PLAYED'`;
  await tx`DELETE FROM zones WHERE id = ${zoneId}`;
  await audit(tx, user, { entity: "zone", entityId: zoneId, action: "delete", tournamentId: lc.tc.tournament_id, summary: `Zona ${z.name} eliminada` });
}

/**
 * Mueve una pareja a otra zona. Sus partidos jugados en la zona anterior NO se borran:
 * quedan anulados (visibles en el historial) y se crean los partidos nuevos.
 */
export async function moveEntry(tx: Tx, user: CurrentUser, entryId: string, targetZoneId: string, confirmed: boolean) {
  const { lc, entry } = await entryContext(tx, user, entryId);
  const target = lc.zones.find((z) => z.id === targetZoneId);
  if (!target) throw new UserError("Zona destino inválida.");
  const source = lc.zones.find((z) => z.entry_ids.includes(entryId));
  if (source?.id === target.id) throw new UserError("La pareja ya está en esa zona.");
  if (target.format === "GVG" || source?.format === "GVG") throw new UserError("Las zonas GvG/PvP tienen un cruce fijo de 4 parejas: no se pueden mover parejas. Si hace falta, regenerá las zonas o reemplazá un jugador.");

  const oldMatches = source ? lc.matches.filter((m) => m.zone_id === source.id && m.status !== "ANNULLED" && (m.entry_a === entryId || m.entry_b === entryId)) : [];
  const played = oldMatches.filter((m) => m.status === "PLAYED");

  // Simular el cambio para mostrar el impacto
  const sim = structuredClone(lc.state);
  for (const z of sim.zones) {
    z.entryIds = z.entryIds.filter((id) => id !== entryId);
    if (z.id === target.id) z.entryIds.push(entryId);
  }
  sim.zoneMatches = sim.zoneMatches.map((m) => (oldMatches.some((o) => o.id === m.id) ? { ...m, status: "ANNULLED" as const } : m));
  const after = evaluateCategory(lc.rules, sim);
  const bracketPlayed = new Set(lc.matches.filter((m) => m.phase === "BRACKET" && m.status === "PLAYED").map((m) => m.bracket_code!));
  const impact = diffBracket(lc.view.bracket, after.bracket, bracketPlayed);

  if (!confirmed) {
    const items: string[] = [];
    if (played.length) items.push(`${played.length} partido(s) ya jugado(s) en Zona ${source!.name} quedarán anulados (se conservan en el historial).`);
    items.push(`Se crearán ${target.entry_ids.length} partido(s) nuevos en Zona ${target.name}.`);
    if (impact.length) items.push(`${impact.length} cruce(s) del cuadro pueden cambiar.`);
    if (impact.some((i) => i.hadResult)) items.push("Hay partidos del cuadro ya jugados que quedarían invalidados.");
    throw new NeedsConfirmation(`Mover ${entryLabel(entry)} a Zona ${target.name}`, items);
  }

  for (const m of oldMatches) {
    if (m.status === "PLAYED") await saveMatchResult(tx, user, m, "ANNULLED", m.outcome, `Cambio de zona de ${entryLabel(entry)}`);
    else await tx`DELETE FROM matches WHERE id = ${m.id}`;
  }
  await tx`DELETE FROM zone_entries WHERE entry_id = ${entryId}`;
  await tx`INSERT INTO zone_entries (zone_id, entry_id, tc_id, sort) VALUES (${target.id}, ${entryId}, ${lc.tc.id}, ${target.entry_ids.length})`;
  const fresh = await loadCategory(tx, lc.tc.id, user.orgId);
  const newIds = fresh.zones.find((z) => z.id === target.id)!.entry_ids;
  await createFixtures(tx, lc.tc.id, target.id, newIds, fresh.matches);
  await audit(tx, user, {
    entity: "entry", entityId: entryId, action: "move_zone", tournamentId: lc.tc.tournament_id,
    summary: `${entryLabel(entry)}: ${source ? `Zona ${source.name}` : "sin zona"} → Zona ${target.name}`,
    before: { zone: source?.name ?? null }, after: { zone: target.name },
  });
  await afterChange(tx, user, lc.tc.id);
}

export async function setZoneManualOrder(tx: Tx, user: CurrentUser, zoneId: string, order: string[]) {
  const [z] = await tx<{ tc_id: string; name: string; manual_order: string[] }[]>`SELECT z.tc_id, z.name, z.manual_order FROM zones z JOIN tournament_categories tc ON tc.id = z.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE z.id = ${zoneId} AND t.org_id = ${user.orgId}`;
  if (!z) throw new UserError("Zona no encontrada.");
  await tx`UPDATE zones SET manual_order = ${j(order)}::text::jsonb WHERE id = ${zoneId}`;
  const lc = await loadCategory(tx, z.tc_id, user.orgId);
  await audit(tx, user, { entity: "zone", entityId: zoneId, action: "tiebreak", tournamentId: lc.tc.tournament_id, summary: `Desempate manual (sorteo) en Zona ${z.name}`, before: z.manual_order, after: order });
  await afterChange(tx, user, z.tc_id);
}

export async function setCrossManualOrder(tx: Tx, user: CurrentUser, tcId: string, pos: number, order: string[]) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const next = { ...(lc.tc.cross_manual_order ?? {}), [pos]: order };
  await tx`UPDATE tournament_categories SET cross_manual_order = ${j(next)}::text::jsonb WHERE id = ${tcId}`;
  await audit(tx, user, { entity: "tournament_category", entityId: tcId, action: "tiebreak", tournamentId: lc.tc.tournament_id, summary: `Desempate manual entre zonas (${pos}° puestos)`, before: lc.tc.cross_manual_order, after: next });
  await afterChange(tx, user, tcId);
}

/* ------------------------------------------------------------------ */
/* Cuadro                                                              */
/* ------------------------------------------------------------------ */

export async function generateBracket(tx: Tx, user: CurrentUser, tcId: string, randomSeed?: number) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (lc.matches.some((m) => m.phase === "BRACKET" && m.status === "PLAYED")) {
    throw new UserError("Ya hay resultados en el cuadro. Modificá los cruces manualmente en lugar de regenerarlo.");
  }
  let defs: BracketMatchDef[];
  if (lc.rules.mode === "KNOCKOUT") {
    const active = lc.entries.filter((e) => e.status === "ACTIVE");
    if (active.length < 2) throw new UserError("Se necesitan al menos 2 parejas inscriptas.");
    defs = coreGenerateBracket(knockoutQualifiers(active.map((e) => ({ id: e.id, seed: e.seed })), randomSeed ?? Math.floor(Math.random() * 1_000_000)));
  } else {
    if (!lc.zones.length) throw new UserError("Primero generá las zonas.");
    const zoneInfos = lc.state.zones.map((z) => ({ id: z.id, size: z.entryIds.length - (z.withdrawn?.length ?? 0) })).filter((z) => z.size > 0);
    defs = coreGenerateBracket(qualifierRefs(zoneInfos, lc.rules.qualification));
  }
  await tx`DELETE FROM matches WHERE tc_id = ${tcId} AND phase = 'BRACKET'`;
  for (const d of defs) {
    await tx`INSERT INTO matches (tc_id, phase, bracket_code, round) VALUES (${tcId}, 'BRACKET', ${d.code}, ${d.round})`;
  }
  await tx`UPDATE tournament_categories SET bracket = ${j(defs)}::text::jsonb, status = 'PLAYOFFS', version = version + 1 WHERE id = ${tcId}`;
  await audit(tx, user, { entity: "bracket", entityId: tcId, action: "generate_bracket", tournamentId: lc.tc.tournament_id, summary: `Cuadro generado para ${lc.tc.category_name}: ${defs.filter((d) => d.round === 1).length * 2} lugares`, before: lc.tc.bracket, after: defs });
  await afterChange(tx, user, tcId);
}

export async function deleteBracket(tx: Tx, user: CurrentUser, tcId: string) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (lc.matches.some((m) => m.phase === "BRACKET" && m.status === "PLAYED")) throw new UserError("El cuadro tiene resultados: no se puede eliminar.");
  await tx`DELETE FROM matches WHERE tc_id = ${tcId} AND phase = 'BRACKET'`;
  await tx`UPDATE tournament_categories SET bracket = '[]'::jsonb, status = 'ZONES' WHERE id = ${tcId}`;
  await audit(tx, user, { entity: "bracket", entityId: tcId, action: "delete", tournamentId: lc.tc.tournament_id, summary: `Cuadro eliminado en ${lc.tc.category_name}`, before: lc.tc.bracket });
}

/** Cambio manual de un lugar del cuadro (primera ronda o cualquier otra). */
/** Lugar del cuadro → pareja que hoy lo ocupa (si ya está definida). */
function slotEntry(lc: LoadedCategory, code: string, side: "a" | "b"): string | null {
  const m = lc.view.bracket.find((x) => x.code === code);
  const r = m?.[side];
  return r && r.kind === "ENTRY" ? r.entryId : null;
}

async function saveBracketEdit(tx: Tx, user: CurrentUser, lc: LoadedCategory, defs: BracketMatchDef[], title: string, items: string[], summary: string, before: unknown, after: unknown, confirmed: boolean) {
  const res = evaluateCategory(lc.rules, { ...lc.state, bracket: defs });
  const played = new Set(lc.matches.filter((m) => m.phase === "BRACKET" && m.status === "PLAYED").map((m) => m.bracket_code!));
  const impact = diffBracket(lc.view.bracket, res.bracket, played);
  if (!confirmed) {
    if (impact.some((i) => i.hadResult)) items.push("Hay partidos ya jugados cuyos participantes cambian: esos resultados quedarán invalidados.");
    throw new NeedsConfirmation(title, items);
  }
  await tx`UPDATE tournament_categories SET bracket = ${j(defs)}::text::jsonb, version = version + 1 WHERE id = ${lc.tc.id}`;
  await audit(tx, user, { entity: "bracket", entityId: lc.tc.id, action: "edit_bracket", tournamentId: lc.tc.tournament_id, summary, before, after });
  await afterChange(tx, user, lc.tc.id);
}

const sideName = (code: string, side: "a" | "b") => `${code} ${side === "a" ? "arriba" : "abajo"}`;

export async function setBracketSlot(tx: Tx, user: CurrentUser, tcId: string, code: string, side: "a" | "b", ref: SlotRef, confirmed: boolean) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const defs: BracketMatchDef[] = structuredClone(lc.tc.bracket);
  const d = defs.find((x) => x.code === code);
  if (!d) throw new UserError("Partido del cuadro no encontrado.");
  if (ref.t === "ENTRY") {
    const e = lc.entryMap.get(ref.entryId);
    if (!e || e.status !== "ACTIVE") throw new UserError("Pareja inválida.");
    for (const x of defs) for (const s of ["a", "b"] as const) {
      if (x.code === code && s === side) continue;
      const r = x[s];
      if ((r.t === "ENTRY" && r.entryId === ref.entryId) || slotEntry(lc, x.code, s) === ref.entryId) {
        throw new UserError(`${entryLabel(e)} ya está en el cuadro (${sideName(x.code, s)}). Usá «Intercambiar lugares» para cambiarlas de lugar.`);
      }
    }
  }
  const before = d[side];
  d[side] = ref;
  const zoneNames = Object.fromEntries(lc.zones.map((z) => [z.id, z.name]));
  const cur = slotEntry(lc, code, side);
  const label = (r: SlotRef) => (r.t === "ENTRY" ? entryLabel(lc.entryMap.get(r.entryId)) : refLabel(r, zoneNames));
  await saveBracketEdit(tx, user, lc, defs, "Corregir clasificado",
    [`${sideName(code, side)}: sale ${cur ? entryLabel(lc.entryMap.get(cur)) : label(before)} → entra ${label(ref)}`],
    `Cuadro ${sideName(code, side)}: ${cur ? entryLabel(lc.entryMap.get(cur)) : label(before)} → ${label(ref)} (corrección manual)`, before, ref, confirmed);
}

/** Intercambia dos lugares del cuadro (por ejemplo, dos clasificados). */
export async function swapBracketSlots(tx: Tx, user: CurrentUser, tcId: string, x: { code: string; side: "a" | "b" }, y: { code: string; side: "a" | "b" }, confirmed: boolean) {
  if (x.code === y.code && x.side === y.side) throw new UserError("Elegí dos lugares distintos.");
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const defs: BracketMatchDef[] = structuredClone(lc.tc.bracket);
  const dx = defs.find((d) => d.code === x.code), dy = defs.find((d) => d.code === y.code);
  if (!dx || !dy) throw new UserError("Partido del cuadro no encontrado.");
  const zoneNames = Object.fromEntries(lc.zones.map((z) => [z.id, z.name]));
  const who = (c: string, s: "a" | "b", r: SlotRef) => { const e = slotEntry(lc, c, s); return e ? entryLabel(lc.entryMap.get(e)) : r.t === "ENTRY" ? entryLabel(lc.entryMap.get(r.entryId)) : refLabel(r, zoneNames); };
  const rx = dx[x.side], ry = dy[y.side];
  const wx = who(x.code, x.side, rx), wy = who(y.code, y.side, ry);
  dx[x.side] = ry; dy[y.side] = rx;
  await saveBracketEdit(tx, user, lc, defs, "Intercambiar lugares del cuadro",
    [`${wx}: pasa de ${sideName(x.code, x.side)} a ${sideName(y.code, y.side)}`, `${wy}: pasa de ${sideName(y.code, y.side)} a ${sideName(x.code, x.side)}`],
    `Cuadro: intercambio ${sideName(x.code, x.side)} (${wx}) ↔ ${sideName(y.code, y.side)} (${wy})`, { [x.code]: rx, [y.code]: ry }, { [x.code]: ry, [y.code]: rx }, confirmed);
}

/* ------------------------------------------------------------------ */
/* Resultados                                                          */
/* ------------------------------------------------------------------ */

/** Guarda un resultado creando una versión nueva en el historial (nunca se pisa). */
async function saveMatchResult(
  tx: Tx, user: CurrentUser, m: MatchRow, status: MatchRow["status"], outcome: MatchOutcome | null, reason: string | null,
  entryA?: string | null, entryB?: string | null,
) {
  const a = entryA === undefined ? m.entry_a : entryA;
  const b = entryB === undefined ? m.entry_b : entryB;
  const [u] = await tx<{ version: number }[]>`
    UPDATE matches SET status = ${status}, outcome = ${outcome ? j(outcome) : null}::text::jsonb, entry_a = ${a}, entry_b = ${b},
           version = version + 1, updated_at = now()
    WHERE id = ${m.id} RETURNING version`;
  await tx`INSERT INTO match_result_versions (match_id, version, entry_a, entry_b, status, outcome, reason, user_id)
           VALUES (${m.id}, ${u.version}, ${a}, ${b}, ${status}, ${outcome ? j(outcome) : null}::text::jsonb, ${reason}, ${user.id})`;
}

export async function matchContext(tx: Tx, user: CurrentUser, matchId: string) {
  const [r] = await tx<{ tc_id: string }[]>`
    SELECT m.tc_id FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    WHERE m.id = ${matchId} AND t.org_id = ${user.orgId}`;
  if (!r) throw new UserError("Partido no encontrado.");
  const lc = await loadCategory(tx, r.tc_id, user.orgId, { lock: true });
  const m = lc.matches.find((x) => x.id === matchId)!;
  return { lc, m };
}

export function matchLabel(lc: LoadedCategory, m: MatchRow): string {
  if (m.phase === "ZONE") {
    const z = lc.zones.find((x) => x.id === m.zone_id);
    return `Zona ${z?.name ?? "?"}: ${zoneSideLabel(lc, m, "a")} vs ${zoneSideLabel(lc, m, "b")}`;
  }
  const rm = lc.view.bracket.find((x) => x.code === m.bracket_code);
  const name = (r?: { kind: string; entryId?: string }) => (r?.kind === "ENTRY" ? entryLabel(lc.entryMap.get(r.entryId!)) : r?.kind === "BYE" ? "Pase libre" : "A definir");
  return `${m.bracket_code}: ${name(rm?.a)} vs ${name(rm?.b)}`;
}

export async function recordResult(tx: Tx, user: CurrentUser, matchId: string, outcome: MatchOutcome, expectedVersion: number | null, reason: string | null, confirmed: boolean) {
  const { lc, m } = await matchContext(tx, user, matchId);
  if (expectedVersion !== null && expectedVersion !== m.version) {
    throw new UserError("Este partido fue modificado por otra persona mientras cargabas. Revisá el resultado actual y volvé a intentar.");
  }
  if (m.status === "ANNULLED") throw new UserError("El partido está anulado.");
  if (m.phase === "ZONE" && (!m.entry_a || !m.entry_b)) throw new UserError("Este partido se define cuando terminen los dos partidos de la 1ª ronda de la zona.");
  try { summarize(lc.rules.format, outcome); } catch (e) { if (e instanceof ScoreError) throw new UserError(e.message); throw e; }

  let entryA = m.entry_a, entryB = m.entry_b;
  const sim = structuredClone(lc.state);
  if (m.phase === "ZONE") {
    const zm = sim.zoneMatches.find((x) => x.id === m.id)!;
    zm.status = "PLAYED"; zm.outcome = outcome;
  } else {
    const rm = lc.view.bracket.find((x) => x.code === m.bracket_code);
    if (!rm || rm.a.kind !== "ENTRY" || rm.b.kind !== "ENTRY") throw new UserError("Todavía no están definidas las dos parejas de este partido.");
    entryA = rm.a.entryId; entryB = rm.b.entryId;
    sim.bracketResults = sim.bracketResults.filter((r) => r.code !== m.bracket_code);
    sim.bracketResults.push({ code: m.bracket_code!, entryA, entryB, outcome });
  }
  const after = evaluateCategory(lc.rules, sim);
  const played = new Set(lc.matches.filter((x) => x.phase === "BRACKET" && x.status === "PLAYED" && x.bracket_code !== m.bracket_code).map((x) => x.bracket_code!));
  const impact = diffBracket(lc.view.bracket, after.bracket, played).filter((i) => i.code !== m.bracket_code);
  const isCorrection = m.status === "PLAYED";

  const gvgItems: string[] = [];
  const zone = m.phase === "ZONE" ? lc.zones.find((z) => z.id === m.zone_id) : null;
  if (isCorrection && zone?.format === "GVG" && m.round === 1) {
    const oldW = lc.view.summaries.get(m.id)?.winner, newW = after.summaries.get(m.id)?.winner;
    if (oldW && newW && oldW !== newW) {
      for (const x of lc.matches.filter((y) => y.zone_id === zone.id && y.slot && (y.status === "PLAYED" || y.status === "IN_PLAY"))) {
        gvgItems.push(`Zona ${zone.name}: cambia quién juega el partido de ${x.slot === "GVG" ? "ganadores" : "perdedores"} (${entryLabel(lc.entryMap.get(x.entry_a ?? ""))} vs ${entryLabel(lc.entryMap.get(x.entry_b ?? ""))}). Su resultado quedará invalidado.`);
      }
    }
  }
  if (!confirmed && (gvgItems.length || impact.some((i) => i.hadResult) || (isCorrection && lc.tc.points_awarded_at))) {
    const items: string[] = [...gvgItems];
    for (const i of impact.filter((x) => x.hadResult)) {
      const label = (id: string | null) => (id === "BYE" ? "Pase libre" : id ? entryLabel(lc.entryMap.get(id)) : "A definir");
      items.push(`${i.code}: ${label(i.before.a)} vs ${label(i.before.b)} → ${label(i.after.a)} vs ${label(i.after.b)}. Su resultado quedará invalidado.`);
    }
    if (isCorrection && lc.tc.points_awarded_at) items.push("Los puntos de ranking de esta categoría se recalcularán (sin duplicar).");
    throw new NeedsConfirmation("Esta corrección afecta partidos ya jugados", items);
  }

  await saveMatchResult(tx, user, m, "PLAYED", outcome, reason ?? (isCorrection ? "Corrección" : null), entryA, entryB);
  // Con el primer resultado, el torneo pasa a "En curso"
  await tx`UPDATE tournaments SET status = 'IN_PROGRESS', updated_at = now() WHERE id = ${lc.tc.tournament_id} AND status = 'OPEN'`;
  await audit(tx, user, {
    entity: "match", entityId: m.id, action: isCorrection ? "result_correction" : "result", tournamentId: lc.tc.tournament_id,
    summary: `${matchLabel(lc, m)} · ${isCorrection ? `${m.outcome ? scoreText(m.outcome) : "—"} → ` : ""}${scoreText(outcome)}${reason ? ` (${reason})` : ""}`,
    before: isCorrection ? { status: m.status, outcome: m.outcome } : null,
    after: { status: "PLAYED", outcome },
  });
  await afterChange(tx, user, lc.tc.id);
}

export async function annulResult(tx: Tx, user: CurrentUser, matchId: string, reason: string) {
  const { lc, m } = await matchContext(tx, user, matchId);
  if (m.status !== "PLAYED") throw new UserError("El partido no tiene resultado.");
  if (!reason || reason.length < 3) throw new UserError("Indicá el motivo.");
  await saveMatchResult(tx, user, m, "PENDING", null, reason, m.phase === "BRACKET" ? null : m.entry_a, m.phase === "BRACKET" ? null : m.entry_b);
  await audit(tx, user, { entity: "match", entityId: m.id, action: "result_correction", tournamentId: lc.tc.tournament_id, summary: `Resultado borrado: ${matchLabel(lc, m)} (${reason})`, before: { outcome: m.outcome }, after: null });
  await afterChange(tx, user, lc.tc.id);
}

export async function setInPlay(tx: Tx, user: CurrentUser, matchId: string, inPlay: boolean) {
  const { lc, m } = await matchContext(tx, user, matchId);
  if (m.status === "PLAYED" || m.status === "ANNULLED") throw new UserError("El partido ya terminó.");
  await tx`UPDATE matches SET status = ${inPlay ? "IN_PLAY" : "PENDING"}, updated_at = now() WHERE id = ${matchId}`;
  await audit(tx, user, { entity: "match", entityId: matchId, action: "update", tournamentId: lc.tc.tournament_id, summary: `${matchLabel(lc, m)}: ${inPlay ? "en juego" : "pendiente"}` });
}

/**
 * Después de cualquier cambio: invalida resultados del cuadro cuyos participantes cambiaron
 * (conservando el historial) y recalcula el ranking de la categoría.
 */
export async function afterChange(tx: Tx, user: CurrentUser, tcId: string) {
  for (let i = 0; i < 10; i++) {
    const lc0 = await loadCategory(tx, tcId, user.orgId);
    if (await syncGvgZones(tx, user, lc0)) continue;
    const lc = lc0;
    const stale = lc.view.bracket.filter((b) => b.staleResult);
    if (!stale.length) {
      await recalcRanking(tx, user, lc);
      return;
    }
    for (const s of stale) {
      const row = lc.matches.find((m) => m.phase === "BRACKET" && m.bracket_code === s.code);
      if (!row) continue;
      await saveMatchResult(tx, user, row, "PENDING", null, "Invalidado: cambiaron los participantes por una corrección anterior", null, null);
      await audit(tx, user, { entity: "match", entityId: row.id, action: "result_correction", tournamentId: lc.tc.tournament_id, summary: `${s.code}: resultado invalidado porque cambiaron los participantes`, before: { outcome: row.outcome, entryA: row.entry_a, entryB: row.entry_b } });
    }
  }
}

export function parseRules(raw: unknown): CategoryRules {
  return normalizeRules(raw as Partial<CategoryRules>);
}

/* --------------------------- Reiniciar --------------------------- */

export type ResetMode = "RESULTS" | "ALL";

/**
 * Reinicia una categoría SIN tocar las inscripciones.
 * - RESULTS: borra los resultados (vuelven a pendientes). Se mantienen zonas, cruces y horarios.
 * - ALL: borra zonas, partidos, cuadro y horarios. La categoría vuelve a "Inscripción".
 * Las parejas retiradas siguen retiradas. Los puntos de ranking de la categoría se quitan.
 */
async function resetCategoryCore(tx: Tx, user: CurrentUser, tcId: string, mode: ResetMode) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const withdrawn = new Set(lc.entries.filter((e) => e.status === "WITHDRAWN").map((e) => e.id));
  const played = lc.matches.filter((m) => m.status === "PLAYED" || m.status === "IN_PLAY");
  if (mode === "RESULTS") {
    for (const m of played) {
      if (m.phase === "ZONE" && ((m.entry_a && withdrawn.has(m.entry_a)) || (m.entry_b && withdrawn.has(m.entry_b)))) continue;
      await saveMatchResult(tx, user, m, "PENDING", null, "Reinicio de la categoría", m.phase === "BRACKET" ? null : undefined, m.phase === "BRACKET" ? null : undefined);
    }
    await tx`UPDATE zones SET manual_order = '[]'::jsonb WHERE tc_id = ${tcId}`;
    await tx`UPDATE tournament_categories SET cross_manual_order = '{}'::jsonb, version = version + 1,
             status = ${lc.tc.bracket.length ? "PLAYOFFS" : lc.zones.length ? "ZONES" : "REGISTRATION"} WHERE id = ${tcId}`;
  } else {
    await tx`DELETE FROM matches WHERE tc_id = ${tcId}`;
    await tx`DELETE FROM zones WHERE tc_id = ${tcId}`;
    await tx`UPDATE tournament_categories SET bracket = '[]'::jsonb, cross_manual_order = '{}'::jsonb, status = 'REGISTRATION', version = version + 1 WHERE id = ${tcId}`;
  }
  await audit(tx, user, {
    entity: "tournament_category", entityId: tcId, action: "reset", tournamentId: lc.tc.tournament_id,
    summary: mode === "RESULTS"
      ? `${lc.tc.category_name}: resultados borrados (${played.length} partido(s)). Se mantienen inscripciones, zonas y cuadro.`
      : `${lc.tc.category_name}: reiniciada desde cero. Se mantienen las ${lc.entries.filter((e) => e.status === "ACTIVE").length} inscripciones.`,
    before: { zones: lc.zones.map((z) => ({ name: z.name, entries: z.entry_ids })), bracket: lc.tc.bracket, results: played.map((m) => ({ id: m.id, a: m.entry_a, b: m.entry_b, outcome: m.outcome })) },
  });
  await afterChange(tx, user, tcId);
  return lc;
}

function resetItems(mode: ResetMode, cats: { name: string; played: number; zones: number; bracket: boolean; entries: number }[]): string[] {
  const items = cats.map((c) => mode === "RESULTS"
    ? `${c.name}: se borran ${c.played} resultado(s); quedan las ${c.entries} parejas, las zonas${c.bracket ? ", el cuadro" : ""} y los horarios.`
    : `${c.name}: se borran ${c.zones} zona(s), todos los partidos${c.bracket ? ", el cuadro" : ""} y los horarios; quedan las ${c.entries} parejas inscriptas.`);
  items.push("Los puntos de ranking que ya se habían dado por estas categorías se quitan.");
  items.push("Queda registrado en el historial. Esta acción no se puede deshacer.");
  return items;
}

async function setTournamentStatusAfterReset(tx: Tx, tournamentId: string) {
  const [r] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id
    WHERE tc.tournament_id = ${tournamentId} AND m.status IN ('PLAYED','IN_PLAY')`;
  if (r.n === 0) await tx`UPDATE tournaments SET status = 'OPEN', updated_at = now() WHERE id = ${tournamentId} AND status IN ('IN_PROGRESS','FINISHED')`;
}

async function resetSummary(tx: Tx, tcIds: string[]) {
  return tx<{ id: string; name: string; played: number; zones: number; bracket: boolean; entries: number }[]>`
    SELECT tc.id, c.name,
      (SELECT count(*)::int FROM matches m WHERE m.tc_id = tc.id AND m.status IN ('PLAYED','IN_PLAY')) AS played,
      (SELECT count(*)::int FROM zones z WHERE z.tc_id = tc.id) AS zones,
      jsonb_array_length(tc.bracket) > 0 AS bracket,
      (SELECT count(*)::int FROM entries e WHERE e.tc_id = tc.id AND e.status = 'ACTIVE') AS entries
    FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.id = ANY(${tcIds}::uuid[]) ORDER BY c.name`;
}

export async function resetCategory(tx: Tx, user: CurrentUser, tcId: string, mode: ResetMode, confirmed: boolean) {
  const lc = await loadCategory(tx, tcId, user.orgId);
  if (!confirmed) {
    const sum = await resetSummary(tx, [tcId]);
    throw new NeedsConfirmation(mode === "RESULTS" ? `Borrar los resultados de ${lc.tc.category_name}` : `Reiniciar ${lc.tc.category_name} desde cero`, resetItems(mode, sum));
  }
  await resetCategoryCore(tx, user, tcId, mode);
  await setTournamentStatusAfterReset(tx, lc.tc.tournament_id);
}

export async function resetTournament(tx: Tx, user: CurrentUser, tournamentId: string, mode: ResetMode, confirmed: boolean) {
  await assertTournament(tx, user, tournamentId);
  const tcs = await tx<{ id: string }[]>`SELECT id FROM tournament_categories WHERE tournament_id = ${tournamentId}`;
  if (!tcs.length) throw new UserError("El torneo no tiene categorías.");
  if (!confirmed) {
    const sum = await resetSummary(tx, tcs.map((x) => x.id));
    throw new NeedsConfirmation(mode === "RESULTS" ? `Borrar todos los resultados del torneo` : `Reiniciar todo el torneo desde cero`, resetItems(mode, sum));
  }
  for (const tc of tcs) await resetCategoryCore(tx, user, tc.id, mode);
  await setTournamentStatusAfterReset(tx, tournamentId);
}

/* --------------------------- Eliminar torneo --------------------------- */

/**
 * Elimina un torneo con sus categorías, inscripciones, zonas, partidos y horarios.
 * Los puntos de ranking automáticos que dio se quitan. Los jugadores y las sedes no se tocan.
 * El historial de auditoría conserva el registro de lo eliminado.
 */
export async function deleteTournament(tx: Tx, user: CurrentUser, tournamentId: string, confirmed: boolean) {
  const [t] = await tx<{ id: string; name: string }[]>`SELECT id, name FROM tournaments WHERE id = ${tournamentId} AND org_id = ${user.orgId} FOR UPDATE`;
  if (!t) throw new UserError("Torneo no encontrado.");
  const [s] = await tx<{ cats: number; entries: number; played: number; points: number }[]>`
    SELECT (SELECT count(*)::int FROM tournament_categories WHERE tournament_id = ${t.id}) AS cats,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = ${t.id}) AS entries,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = ${t.id} AND m.status = 'PLAYED') AS played,
      (SELECT count(*)::int FROM ranking_ledger r JOIN tournament_categories tc ON tc.id = r.tc_id WHERE tc.tournament_id = ${t.id} AND r.kind = 'AUTO' AND r.superseded_at IS NULL) AS points`;
  if (!confirmed) {
    const items = [
      `Se borran ${s.cats} categoría(s) con sus ${s.entries} inscripción(es), zonas, cuadros y horarios.`,
      s.played ? `Se pierden ${s.played} resultado(s) cargado(s).` : "No tiene resultados cargados.",
    ];
    if (s.points) items.push(`Se quitan del ranking los puntos que dio este torneo (${s.points} jugador(es)).`);
    items.push("Los jugadores, sedes y categorías no se borran.", "Esta acción no se puede deshacer.");
    throw new NeedsConfirmation(`Eliminar «${t.name}»`, items);
  }
  await tx`DELETE FROM ranking_ledger WHERE kind = 'AUTO' AND tc_id IN (SELECT id FROM tournament_categories WHERE tournament_id = ${t.id})`;
  await tx`DELETE FROM tournaments WHERE id = ${t.id}`;
  await audit(tx, user, { entity: "tournament", entityId: t.id, action: "delete", tournamentId: t.id, summary: `Torneo ${t.name} eliminado (${s.cats} categorías, ${s.entries} inscripciones, ${s.played} resultados)` });
}
