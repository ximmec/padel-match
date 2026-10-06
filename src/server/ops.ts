/**
 * Operaciones de negocio transaccionales. Cada función recibe una transacción (`tx`)
 * y deja registro en la auditoría. Las Server Actions (src/server/actions) las invocan.
 */
import type { Tx } from "./db";
import { UserError } from "./db";
import type { CurrentUser } from "./auth";
import { audit } from "./audit";
import { NeedsConfirmation } from "./errors";
import { loadCategory, entryLabel, type LoadedCategory, type MatchRow } from "./category";
import { recalcRanking } from "./ranking";
import {
  planZoneSizes, validateZoneSizes, distributeEntries, roundRobin, zoneName,
} from "@/core/zones";
import {
  generateBracket as coreGenerateBracket, qualifierRefs, diffBracket, refLabel, type SlotRef, type BracketMatchDef,
} from "@/core/bracket";
import { evaluateCategory, normalizeRules, withdrawalChanges, type CategoryRules, type WithdrawalPolicy } from "@/core/engine";
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
  await tx`UPDATE tournament_categories SET rules = ${j(rules)}::text::jsonb, version = version + 1 WHERE id = ${tcId}`;
  await audit(tx, user, { entity: "tournament_category", entityId: tcId, action: "update", tournamentId: lc.tc.tournament_id, summary: `Reglas de ${lc.tc.category_name} modificadas`, before: lc.rules, after: rules });
  await afterChange(tx, user, tcId);
}

/* ------------------------------------------------------------------ */
/* Inscripciones                                                       */
/* ------------------------------------------------------------------ */

async function checkGender(tx: Tx, rule: string, playerIds: string[], orgId: string) {
  const ps = await tx<{ id: string; gender: string; first_name: string; last_name: string; deleted_at: Date | null }[]>`
    SELECT id, gender, first_name, last_name, deleted_at FROM players WHERE id = ANY(${playerIds}::uuid[]) AND org_id = ${orgId}`;
  if (ps.length !== playerIds.length) throw new UserError("Algún jugador no existe.");
  if (ps.some((p) => p.deleted_at)) throw new UserError("No se puede inscribir a un jugador dado de baja.");
  const g = ps.map((p) => p.gender).sort().join("");
  if (rule === "MALE" && g !== "MM") throw new UserError("Esta categoría es masculina: ambos jugadores deben ser hombres.");
  if (rule === "FEMALE" && g !== "FF") throw new UserError("Esta categoría es femenina: ambas jugadoras deben ser mujeres.");
  // Mixta: se permite cualquier combinación (dos hombres, dos mujeres o un hombre y una mujer).
  return ps;
}

export async function registerEntry(tx: Tx, user: CurrentUser, tcId: string, p1: string, p2: string, seed: number | null) {
  if (p1 === p2) throw new UserError("Elegí dos jugadores distintos.");
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const ps = await checkGender(tx, lc.tc.gender_rule, [p1, p2], user.orgId);
  // Incompatibilidad: el mismo jugador en otra categoría del mismo torneo con horarios superpuestos se permite,
  // pero no dos veces en la misma categoría (lo garantiza un índice único).
  const [e] = await tx<{ id: string }[]>`INSERT INTO entries (tc_id, seed) VALUES (${tcId}, ${seed}) RETURNING id`;
  await tx`INSERT INTO entry_players (entry_id, tc_id, player_id, slot) VALUES (${e.id}, ${tcId}, ${p1}, 1), (${e.id}, ${tcId}, ${p2}, 2)`;
  const label = ps.map((p) => `${p.first_name} ${p.last_name}`).join(" / ");
  await audit(tx, user, { entity: "entry", entityId: e.id, action: "create", tournamentId: lc.tc.tournament_id, summary: `Inscripción de ${label} en ${lc.tc.category_name}`, after: { p1, p2, seed } });
  return e.id;
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

async function createFixtures(tx: Tx, tcId: string, zoneId: string, entryIds: string[], existing: MatchRow[]) {
  const has = (a: string, b: string) => existing.some((m) => m.zone_id === zoneId && m.status !== "ANNULLED" && ((m.entry_a === a && m.entry_b === b) || (m.entry_a === b && m.entry_b === a)));
  for (const f of roundRobin(entryIds.length)) {
    const a = entryIds[f.a], b = entryIds[f.b];
    if (has(a, b)) continue;
    await tx`INSERT INTO matches (tc_id, phase, zone_id, round, entry_a, entry_b) VALUES (${tcId}, 'ZONE', ${zoneId}, ${f.round}, ${a}, ${b})`;
  }
}

export async function generateZones(tx: Tx, user: CurrentUser, tcId: string, sizes: number[] | null, randomSeed: number) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (lc.matches.some((m) => m.phase === "ZONE" && m.status === "PLAYED")) {
    throw new UserError("Ya hay resultados de zona. Para reorganizar usá «Mover de zona» y así no se pierden los resultados.");
  }
  if (lc.tc.bracket.length) throw new UserError("Ya hay un cuadro generado. Eliminá el cuadro antes de regenerar las zonas.");
  const active = lc.entries.filter((e) => e.status === "ACTIVE");
  if (active.length < 2) throw new UserError("Se necesitan al menos 2 parejas inscriptas.");
  const plan = sizes ?? planZoneSizes(active.length, { preferredSize: lc.rules.preferredZoneSize });
  validateZoneSizes(active.length, plan);
  const groups = distributeEntries(active.map((e) => ({ id: e.id, seed: e.seed })), plan, randomSeed);

  const before = lc.zones.map((z) => ({ name: z.name, entries: z.entry_ids }));
  await tx`DELETE FROM matches WHERE tc_id = ${tcId} AND phase = 'ZONE'`;
  await tx`DELETE FROM zones WHERE tc_id = ${tcId}`;
  for (let i = 0; i < groups.length; i++) {
    const [z] = await tx<{ id: string }[]>`INSERT INTO zones (tc_id, name, sort) VALUES (${tcId}, ${zoneName(i)}, ${i}) RETURNING id`;
    const ids = groups[i].map((e) => e.id);
    for (let k = 0; k < ids.length; k++) await tx`INSERT INTO zone_entries (zone_id, entry_id, tc_id, sort) VALUES (${z.id}, ${ids[k]}, ${tcId}, ${k})`;
    await createFixtures(tx, tcId, z.id, ids, []);
  }
  await tx`UPDATE tournament_categories SET status = 'ZONES', version = version + 1 WHERE id = ${tcId}`;
  await audit(tx, user, {
    entity: "zones", entityId: tcId, action: "generate_zones", tournamentId: lc.tc.tournament_id,
    summary: `Zonas generadas para ${lc.tc.category_name}: ${plan.join(", ")} parejas (sorteo #${randomSeed})`,
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

export async function generateBracket(tx: Tx, user: CurrentUser, tcId: string) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  if (lc.matches.some((m) => m.phase === "BRACKET" && m.status === "PLAYED")) {
    throw new UserError("Ya hay resultados en el cuadro. Modificá los cruces manualmente en lugar de regenerarlo.");
  }
  if (!lc.zones.length) throw new UserError("Primero generá las zonas.");
  const zoneInfos = lc.state.zones.map((z) => ({ id: z.id, size: z.entryIds.length - (z.withdrawn?.length ?? 0) })).filter((z) => z.size > 0);
  const defs = coreGenerateBracket(qualifierRefs(zoneInfos, lc.rules.qualification));
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
export async function setBracketSlot(tx: Tx, user: CurrentUser, tcId: string, code: string, side: "a" | "b", ref: SlotRef, confirmed: boolean) {
  const lc = await loadCategory(tx, tcId, user.orgId, { lock: true });
  const defs: BracketMatchDef[] = structuredClone(lc.tc.bracket);
  const d = defs.find((x) => x.code === code);
  if (!d) throw new UserError("Partido del cuadro no encontrado.");
  if (ref.t === "ENTRY" && !lc.entryMap.has(ref.entryId)) throw new UserError("Pareja inválida.");
  const before = d[side];
  d[side] = ref;
  const after = evaluateCategory(lc.rules, { ...lc.state, bracket: defs });
  const played = new Set(lc.matches.filter((m) => m.phase === "BRACKET" && m.status === "PLAYED").map((m) => m.bracket_code!));
  const impact = diffBracket(lc.view.bracket, after.bracket, played);
  const zoneNames = Object.fromEntries(lc.zones.map((z) => [z.id, z.name]));
  if (!confirmed) {
    const items = [`${code}: ${refLabel(before, zoneNames)} → ${ref.t === "ENTRY" ? entryLabel(lc.entryMap.get(ref.entryId)) : refLabel(ref, zoneNames)}`];
    if (impact.some((i) => i.hadResult)) items.push("Hay partidos ya jugados cuyos participantes cambian: esos resultados quedarán invalidados.");
    throw new NeedsConfirmation("Modificar cruce del cuadro", items);
  }
  await tx`UPDATE tournament_categories SET bracket = ${j(defs)}::text::jsonb, version = version + 1 WHERE id = ${tcId}`;
  await audit(tx, user, { entity: "bracket", entityId: tcId, action: "edit_bracket", tournamentId: lc.tc.tournament_id, summary: `Cruce ${code} lado ${side.toUpperCase()} modificado manualmente`, before, after: ref });
  await afterChange(tx, user, tcId);
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
    return `Zona ${z?.name ?? "?"}: ${entryLabel(lc.entryMap.get(m.entry_a!))} vs ${entryLabel(lc.entryMap.get(m.entry_b!))}`;
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

  if (!confirmed && (impact.some((i) => i.hadResult) || (isCorrection && lc.tc.points_awarded_at))) {
    const items: string[] = [];
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
    const lc = await loadCategory(tx, tcId, user.orgId);
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
