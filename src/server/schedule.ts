/**
 * Cronograma de un torneo (todas sus categorías comparten canchas).
 */
import type { Db, Tx } from "./db";
import { UserError } from "./db";
import type { CurrentUser } from "./auth";
import { audit } from "./audit";
import { notifyScheduleChange } from "./autoNotify";
import { NeedsConfirmation } from "./errors";
import { loadCategory, entryLabel, type LoadedCategory, type MatchRow, zoneSideLabel } from "./category";
import { generateSchedule, rescheduleFrom, validateSchedule, type CourtInput, type SchedMatch, type Assignment } from "@/core/scheduling";
import { dict, type Lang } from "@/i18n";

export interface TournamentSchedule {
  tournament: { id: string; name: string; match_duration_min: number; min_rest_min: number; venue_id: string | null; no_schedule: boolean; ignore_restrictions: boolean };
  courts: CourtInput[];
  categories: LoadedCategory[];
  items: ScheduleItem[];
}

export interface ScheduleItem {
  matchId: string;
  tcId: string;
  categoryName: string;
  label: string;
  stage: string;
  players: string[];
  sideA: string;
  sideB: string;
  status: MatchRow["status"];
  courtId: string | null;
  start: Date | null;
  locked: boolean;
  dependsOn: string[];
  priority: number;
  version: number;
  /** Franja diaria pedida por las parejas (minutos). */
  daily?: { from: number | null; to: number | null };
  /** Ya se conocen las dos parejas (se puede cargar el resultado). */
  ready: boolean;
}

export async function loadTournamentSchedule(db: Db, tournamentId: string, orgId: string | null, lang: Lang = "es"): Promise<TournamentSchedule> {
  const g = dict(lang).g;
  const [t] = await db<TournamentSchedule["tournament"][]>`
    SELECT id, name, match_duration_min, min_rest_min, venue_id, no_schedule, ignore_restrictions FROM tournaments WHERE id = ${tournamentId} ${orgId ? db`AND org_id = ${orgId}` : db``}`;
  if (!t) throw new UserError("Torneo no encontrado.");
  const courtRows = await db<{ id: string; name: string; starts_at: Date | null; ends_at: Date | null }[]>`
    SELECT c.id, c.name, a.starts_at, a.ends_at
    FROM courts c
    LEFT JOIN court_availability a ON a.court_id = c.id AND a.tournament_id = ${tournamentId}
    WHERE c.venue_id = ${t.venue_id} AND c.active
    ORDER BY c.sort, c.name, a.starts_at`;
  const courtMap = new Map<string, CourtInput>();
  for (const r of courtRows) {
    const c = courtMap.get(r.id) ?? { id: r.id, name: r.name, windows: [] };
    if (r.starts_at && r.ends_at) c.windows.push({ start: r.starts_at.getTime(), end: r.ends_at.getTime() });
    courtMap.set(r.id, c);
  }
  const tcs = await db<{ id: string }[]>`SELECT tc.id FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = ${tournamentId} ORDER BY c.name`;
  const categories: LoadedCategory[] = [];
  for (const tc of tcs) categories.push(await loadCategory(db, tc.id, orgId));

  const items: ScheduleItem[] = [];
  categories.forEach((lc, ci) => {
    const codeToId = new Map(lc.matches.filter((m) => m.phase === "BRACKET").map((m) => [m.bracket_code!, m.id]));
    const maxRound = Math.max(0, ...lc.matches.filter((m) => m.phase === "ZONE").map((m) => m.round));
    const perRound = new Map<number, number>();
    for (const b of lc.view.bracket) perRound.set(b.round, (perRound.get(b.round) ?? 0) + 1);
    const mins = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
    const dailyOf = (ids: (string | null)[]) => {
      let from: number | null = null, to: number | null = null;
      for (const id of ids) {
        const e = id ? lc.entryMap.get(id) : undefined;
        const f = mins(e?.not_before ?? null), t = mins(e?.not_after ?? null);
        if (f != null) from = from == null ? f : Math.max(from, f);
        if (t != null) to = to == null ? t : Math.min(to, t);
      }
      return from == null && to == null ? undefined : { from, to };
    };
    const playersOf = (entryId: string | null) => (entryId ? lc.entryMap.get(entryId)?.players.map((p) => p.id) ?? [] : []);
    for (const m of lc.matches) {
      if (m.status === "ANNULLED") continue;
      if (m.phase === "ZONE") {
        const z = lc.zones.find((x) => x.id === m.zone_id);
        items.push({
          matchId: m.id, tcId: lc.tc.id, categoryName: lc.tc.category_name,
          label: `${lc.tc.category_name} · ${g.zone(z?.name ?? "?")}`, stage: g.zone(z?.name ?? "?"),
          players: [...playersOf(m.entry_a), ...playersOf(m.entry_b)],
          sideA: zoneSideLabel(lc, m, "a", lang), sideB: zoneSideLabel(lc, m, "b", lang),
          status: m.status, courtId: m.court_id, start: m.scheduled_at, locked: m.schedule_locked,
          dependsOn: m.slot ? lc.matches.filter((x) => x.zone_id === m.zone_id && x.round === 1 && x.status !== "ANNULLED").map((x) => x.id) : [],
          priority: m.round * 100 + ci, version: m.version, ready: !!(m.entry_a && m.entry_b), daily: dailyOf([m.entry_a, m.entry_b]),
        });
      } else {
        const def = lc.tc.bracket.find((d) => d.code === m.bracket_code);
        const rm = lc.view.bracket.find((b) => b.code === m.bracket_code);
        if (!def || !rm) continue;
        // Pase libre: no se juega (se detecta aunque las zonas aún no estén definidas)
        if (def.a.t === "BYE" || def.b.t === "BYE" || rm.byeAdvance || (rm.a.kind === "BYE" && rm.b.kind === "BYE")) continue;
        const deps = [def.a, def.b].filter((r) => r.t === "WINNER").map((r) => (r.t === "WINNER" ? codeToId.get(r.match) : undefined)).filter((x): x is string => !!x);
        // Si un partido alimentador fue pase libre, no hay dependencia real.
        const realDeps = deps.filter((id) => {
          const code = lc.matches.find((x) => x.id === id)?.bracket_code;
          const feeder = lc.view.bracket.find((b) => b.code === code);
          const fdef = lc.tc.bracket.find((d) => d.code === code);
          return feeder && !feeder.byeAdvance && fdef && fdef.a.t !== "BYE" && fdef.b.t !== "BYE";
        });
        // Los partidos de primera ronda dependen de que terminen las zonas: van después de todos los de zona.
        const zoneIds = def.round === 1 ? lc.matches.filter((x) => x.phase === "ZONE" && x.status !== "ANNULLED").map((x) => x.id) : [];
        const a = rm.a.kind === "ENTRY" ? rm.a.entryId : null;
        const b = rm.b.kind === "ENTRY" ? rm.b.entryId : null;
        items.push({
          matchId: m.id, tcId: lc.tc.id, categoryName: lc.tc.category_name,
          label: `${lc.tc.category_name} · ${g.round(perRound.get(def.round) ?? 1)}`, stage: g.round(perRound.get(def.round) ?? 1),
          players: [...playersOf(a), ...playersOf(b)],
          sideA: a ? entryLabel(lc.entryMap.get(a)) : g.tbd, sideB: b ? entryLabel(lc.entryMap.get(b)) : g.tbd,
          status: m.status, courtId: m.court_id, start: m.scheduled_at, locked: m.schedule_locked,
          dependsOn: [...realDeps, ...zoneIds], priority: (maxRound + def.round) * 100 + ci, version: m.version, ready: !!(a && b), daily: dailyOf([a, b]),
        });
      }
    }
  });
  return { tournament: t, courts: [...courtMap.values()], categories, items };
}

function toSched(items: ScheduleItem[], durationMin: number, ignoreRestrictions = false): SchedMatch[] {
  return items.map((i) => ({
    daily: ignoreRestrictions ? undefined : i.daily,
    id: i.matchId,
    label: `${i.label}: ${i.sideA} vs ${i.sideB}`,
    players: i.players,
    dependsOn: i.dependsOn,
    priority: i.priority,
    durationMin,
    fixed: (i.status === "PLAYED" || i.status === "IN_PLAY" || i.locked) && i.courtId && i.start ? { courtId: i.courtId, start: i.start.getTime() } : undefined,
  }));
}

export async function generateTournamentSchedule(tx: Tx, user: CurrentUser, tournamentId: string, mode: "ALL" | "FROM_NOW") {
  const s = await loadTournamentSchedule(tx, tournamentId, user.orgId);
  if (!s.courts.length) throw new UserError("La sede del torneo no tiene canchas cargadas.");
  if (!s.courts.some((c) => c.windows.length)) throw new UserError("Cargá la disponibilidad horaria de las canchas para este torneo.");
  const cfg = { durationMin: s.tournament.match_duration_min, minRestMin: s.tournament.min_rest_min };
  if (s.tournament.no_schedule) throw new UserError("Este torneo está configurado «Sin horarios»: los partidos se asignan desde la mesa. Cambialo en «Editar torneo» si querés generar el cronograma.");
  const sched = toSched(s.items.filter((i) => i.status !== "PLAYED" || (i.courtId && i.start)), cfg.durationMin, s.tournament.ignore_restrictions);
  const res = mode === "FROM_NOW" ? rescheduleFrom(s.courts, sched, cfg, Date.now()) : generateSchedule(s.courts, sched, cfg);
  const asg = new Map(res.assignments.map((a) => [a.matchId, a]));
  let moved = 0;
  for (const i of s.items) {
    if (i.status === "PLAYED" || i.status === "IN_PLAY" || i.locked) continue;
    const a = asg.get(i.matchId);
    const newCourt = a?.courtId ?? null;
    const newStart = a ? new Date(a.start) : null;
    if (newCourt !== i.courtId || (newStart?.getTime() ?? null) !== (i.start?.getTime() ?? null)) {
      await tx`UPDATE matches SET court_id = ${newCourt}, scheduled_at = ${newStart}, updated_at = now() WHERE id = ${i.matchId}`;
      moved++;
    }
  }
  await audit(tx, user, {
    entity: "schedule", entityId: tournamentId, action: "generate_schedule", tournamentId,
    summary: `Cronograma ${mode === "FROM_NOW" ? "recalculado desde ahora" : "generado"}: ${res.assignments.length} partidos programados, ${moved} cambios, ${res.unscheduled.length} sin lugar`,
    after: { unscheduled: res.unscheduled.length },
  });
  return { scheduled: res.assignments.length, unscheduled: res.unscheduled.length, moved };
}

export async function moveMatchSchedule(tx: Tx, user: CurrentUser, matchId: string, courtId: string | null, start: Date | null, lock: boolean, confirmed: boolean) {
  const [m] = await tx<{ tournament_id: string }[]>`
    SELECT tc.tournament_id FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    WHERE m.id = ${matchId} AND t.org_id = ${user.orgId}`;
  if (!m) throw new UserError("Partido no encontrado.");
  const s = await loadTournamentSchedule(tx, m.tournament_id, user.orgId);
  const item = s.items.find((i) => i.matchId === matchId);
  if (!item) throw new UserError("Partido no encontrado en el cronograma.");
  if (courtId && !s.courts.some((c) => c.id === courtId)) throw new UserError("Cancha inválida.");
  const cfg = { durationMin: s.tournament.match_duration_min, minRestMin: s.tournament.min_rest_min };
  const sched = toSched(s.items, cfg.durationMin, s.tournament.ignore_restrictions);
  const assignments: Assignment[] = [];
  for (const i of s.items) {
    const c = i.matchId === matchId ? courtId : i.courtId;
    const st = i.matchId === matchId ? start : i.start;
    if (c && st) assignments.push({ matchId: i.matchId, courtId: c, start: st.getTime(), end: st.getTime() + cfg.durationMin * 60_000 });
  }
  const conflicts = validateSchedule(s.courts, sched, assignments, cfg).filter((c) => c.matchIds.includes(matchId));
  if (conflicts.length && !confirmed) {
    throw new NeedsConfirmation("El cambio genera conflictos", conflicts.map((c) => c.message));
  }
  await tx`UPDATE matches SET court_id = ${courtId}, scheduled_at = ${start}, schedule_locked = ${lock}, updated_at = now() WHERE id = ${matchId}`;
  const courtName = (id: string | null) => s.courts.find((c) => c.id === id)?.name ?? "sin cancha";
  await audit(tx, user, {
    entity: "match", entityId: matchId, action: "schedule", tournamentId: m.tournament_id,
    summary: `${item.label}: ${item.sideA} vs ${item.sideB} → ${courtName(courtId)} ${start ? start.toISOString() : "sin horario"}${conflicts.length ? ` (con ${conflicts.length} conflicto/s aceptados)` : ""}`,
    before: { courtId: item.courtId, start: item.start }, after: { courtId, start, lock },
  });
  await notifyScheduleChange(tx, user.orgId, item.tcId, matchId, { courtId: item.courtId, start: item.start }, { courtId, courtName: courtId ? courtName(courtId) : null, start });
}

export function scheduleConflicts(s: TournamentSchedule) {
  const cfg = { durationMin: s.tournament.match_duration_min, minRestMin: s.tournament.min_rest_min };
  const assignments = s.items.filter((i) => i.courtId && i.start).map((i) => ({ matchId: i.matchId, courtId: i.courtId!, start: i.start!.getTime(), end: i.start!.getTime() + cfg.durationMin * 60_000 }));
  return validateSchedule(s.courts, toSched(s.items, cfg.durationMin, s.tournament.ignore_restrictions), assignments, cfg);
}

/**
 * Cambiar las canchas en uso con el torneo ya empezado (ej. de 8 a 6).
 * Las canchas que salen dejan de estar disponibles desde ahora; los partidos pendientes
 * que tenían se reprograman desde ahora en las que quedan. Los resultados no se tocan
 * y los partidos en juego terminan donde están.
 */
export async function setCourtsInUse(tx: Tx, user: CurrentUser, tournamentId: string, keepIds: string[], confirmed: boolean) {
  const s = await loadTournamentSchedule(tx, tournamentId, user.orgId);
  const now = Date.now();
  const keep = new Set(keepIds.filter((id) => s.courts.some((c) => c.id === id)));
  if (!keep.size) throw new UserError("Dejá al menos una cancha en uso.");
  const removed = s.courts.filter((c) => !keep.has(c.id));
  const added = s.courts.filter((c) => keep.has(c.id) && !c.windows.some((w) => w.end > now));
  const onRemoved = (i: ScheduleItem) => !!i.courtId && removed.some((c) => c.id === i.courtId);
  const pendingMoved = s.items.filter((i) => onRemoved(i) && i.status === "PENDING");
  const live = s.items.filter((i) => onRemoved(i) && i.status === "IN_PLAY");
  if (!removed.length && !added.length) throw new UserError("No hay cambios: ya se están usando esas canchas.");
  if (!confirmed) {
    const items: string[] = [];
    if (removed.length) items.push(`Dejan de usarse desde ahora: ${removed.map((c) => c.name).join(", ")}.`);
    if (added.length) items.push(`Se suman desde ahora: ${added.map((c) => c.name).join(", ")}.`);
    items.push(s.tournament.no_schedule
      ? `${pendingMoved.length} partido(s) pendiente(s) de esas canchas quedan sin cancha para asignarlos desde la mesa.`
      : `Los partidos pendientes se reprograman desde ahora en ${keep.size} cancha(s).`);
    if (live.length) items.push(`${live.length} partido(s) en juego terminan en la cancha donde están.`);
    items.push("Los resultados cargados no se tocan.");
    throw new NeedsConfirmation(`Usar ${keep.size} cancha(s) desde ahora`, items);
  }
  const nowD = new Date(now);
  const removedIds = removed.map((c) => c.id);
  if (removedIds.length) {
    await tx`DELETE FROM court_availability WHERE tournament_id = ${tournamentId} AND court_id = ANY(${removedIds}::uuid[]) AND starts_at >= ${nowD}`;
    await tx`UPDATE court_availability SET ends_at = ${nowD} WHERE tournament_id = ${tournamentId} AND court_id = ANY(${removedIds}::uuid[]) AND starts_at < ${nowD} AND ends_at > ${nowD}`;
    await tx`UPDATE matches SET court_id = NULL, scheduled_at = NULL, schedule_locked = false, updated_at = now()
             WHERE court_id = ANY(${removedIds}::uuid[]) AND status = 'PENDING'
               AND tc_id IN (SELECT id FROM tournament_categories WHERE tournament_id = ${tournamentId})`;
  }
  if (added.length) {
    // Las canchas que se suman quedan disponibles desde ahora hasta el final de los horarios del torneo.
    const lastEnd = Math.max(...s.courts.flatMap((c) => c.windows.map((w) => w.end)), 0);
    const end = new Date(lastEnd > now ? lastEnd : now + 6 * 3_600_000);
    for (const c of added) await tx`INSERT INTO court_availability (tournament_id, court_id, starts_at, ends_at) VALUES (${tournamentId}, ${c.id}, ${nowD}, ${end})`;
  }
  let summary = "";
  if (!s.tournament.no_schedule) {
    const r = await generateTournamentSchedule(tx, user, tournamentId, "FROM_NOW");
    summary = ` ${r.scheduled} partidos programados${r.unscheduled ? `, ${r.unscheduled} sin lugar (agregá horarios o canchas)` : ""}.`;
  }
  await audit(tx, user, {
    entity: "schedule", entityId: tournamentId, action: "schedule", tournamentId,
    summary: `Canchas en uso desde ahora: ${keep.size}${removed.length ? ` (salen ${removed.map((c) => c.name).join(", ")})` : ""}${added.length ? ` (entran ${added.map((c) => c.name).join(", ")})` : ""}`,
  });
  return `Listo: ahora se usan ${keep.size} cancha(s).${summary}`;
}
