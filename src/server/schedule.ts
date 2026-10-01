/**
 * Cronograma de un torneo (todas sus categorías comparten canchas).
 */
import type { Db, Tx } from "./db";
import { UserError } from "./db";
import type { CurrentUser } from "./auth";
import { audit } from "./audit";
import { NeedsConfirmation } from "./errors";
import { loadCategory, entryLabel, type LoadedCategory, type MatchRow } from "./category";
import { generateSchedule, rescheduleFrom, validateSchedule, type CourtInput, type SchedMatch, type Assignment } from "@/core/scheduling";
import { roundName } from "@/core/bracket";

export interface TournamentSchedule {
  tournament: { id: string; name: string; match_duration_min: number; min_rest_min: number; venue_id: string | null };
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
}

export async function loadTournamentSchedule(db: Db, tournamentId: string, orgId: string | null): Promise<TournamentSchedule> {
  const [t] = await db<TournamentSchedule["tournament"][]>`
    SELECT id, name, match_duration_min, min_rest_min, venue_id FROM tournaments WHERE id = ${tournamentId} ${orgId ? db`AND org_id = ${orgId}` : db``}`;
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
    const playersOf = (entryId: string | null) => (entryId ? lc.entryMap.get(entryId)?.players.map((p) => p.id) ?? [] : []);
    for (const m of lc.matches) {
      if (m.status === "ANNULLED") continue;
      if (m.phase === "ZONE") {
        const z = lc.zones.find((x) => x.id === m.zone_id);
        items.push({
          matchId: m.id, tcId: lc.tc.id, categoryName: lc.tc.category_name,
          label: `${lc.tc.category_name} · Zona ${z?.name ?? "?"}`, stage: `Zona ${z?.name ?? "?"}`,
          players: [...playersOf(m.entry_a), ...playersOf(m.entry_b)],
          sideA: entryLabel(lc.entryMap.get(m.entry_a!)), sideB: entryLabel(lc.entryMap.get(m.entry_b!)),
          status: m.status, courtId: m.court_id, start: m.scheduled_at, locked: m.schedule_locked,
          dependsOn: [], priority: m.round * 100 + ci, version: m.version,
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
          label: `${lc.tc.category_name} · ${roundName(perRound.get(def.round) ?? 1)}`, stage: roundName(perRound.get(def.round) ?? 1),
          players: [...playersOf(a), ...playersOf(b)],
          sideA: a ? entryLabel(lc.entryMap.get(a)) : "A definir", sideB: b ? entryLabel(lc.entryMap.get(b)) : "A definir",
          status: m.status, courtId: m.court_id, start: m.scheduled_at, locked: m.schedule_locked,
          dependsOn: [...realDeps, ...zoneIds], priority: (maxRound + def.round) * 100 + ci, version: m.version,
        });
      }
    }
  });
  return { tournament: t, courts: [...courtMap.values()], categories, items };
}

function toSched(items: ScheduleItem[], durationMin: number): SchedMatch[] {
  return items.map((i) => ({
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
  const sched = toSched(s.items.filter((i) => i.status !== "PLAYED" || (i.courtId && i.start)), cfg.durationMin);
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
  const sched = toSched(s.items, cfg.durationMin);
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
}

export function scheduleConflicts(s: TournamentSchedule) {
  const cfg = { durationMin: s.tournament.match_duration_min, minRestMin: s.tournament.min_rest_min };
  const assignments = s.items.filter((i) => i.courtId && i.start).map((i) => ({ matchId: i.matchId, courtId: i.courtId!, start: i.start!.getTime(), end: i.start!.getTime() + cfg.durationMin * 60_000 }));
  return validateSchedule(s.courts, toSched(s.items, cfg.durationMin), assignments, cfg);
}
