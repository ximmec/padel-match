/**
 * Cronograma: asignación de partidos a canchas y horarios.
 * Respeta disponibilidad de canchas, superposición de jugadores, descanso mínimo
 * y orden de dependencias (un partido de cuadro va después de los que lo alimentan).
 * Los tiempos son milisegundos (epoch).
 */

export interface TimeWindow { start: number; end: number }
export interface CourtInput { id: string; name: string; windows: TimeWindow[] }

export interface SchedMatch {
  id: string;
  label?: string;
  /** IDs de jugadores (vacío si aún no se conocen, p. ej. cuadro). */
  players: string[];
  /** Partidos que deben terminar antes (más el descanso). */
  dependsOn: string[];
  /** Menor = se programa antes. */
  priority: number;
  durationMin?: number;
  /** Si está fijo (bloqueado, en juego o terminado), no se mueve. */
  fixed?: { courtId: string; start: number };
  /** No programar antes de este momento (p. ej. "ahora" al recalcular). */
  notBefore?: number;
}

export interface Assignment { matchId: string; courtId: string; start: number; end: number }

export interface ScheduleConfig {
  durationMin: number;
  minRestMin: number;
}

export interface ScheduleResult { assignments: Assignment[]; unscheduled: string[] }

const MIN = 60_000;

function overlaps(a0: number, a1: number, b0: number, b1: number) { return a0 < b1 && b0 < a1; }

export function generateSchedule(courts: CourtInput[], matches: SchedMatch[], cfg: ScheduleConfig): ScheduleResult {
  const rest = cfg.minRestMin * MIN;
  const courtBusy = new Map<string, TimeWindow[]>(courts.map((c) => [c.id, []]));
  const playerBusy = new Map<string, TimeWindow[]>();
  const endOf = new Map<string, number>();
  const assignments: Assignment[] = [];
  const unscheduled: string[] = [];
  const byId = new Map(matches.map((m) => [m.id, m]));

  const book = (m: SchedMatch, courtId: string, start: number, end: number) => {
    courtBusy.get(courtId)?.push({ start, end });
    for (const p of m.players) {
      const arr = playerBusy.get(p) ?? [];
      arr.push({ start, end });
      playerBusy.set(p, arr);
    }
    endOf.set(m.id, end);
    assignments.push({ matchId: m.id, courtId, start, end });
  };

  for (const m of matches) {
    if (m.fixed) {
      const d = (m.durationMin ?? cfg.durationMin) * MIN;
      book(m, m.fixed.courtId, m.fixed.start, m.fixed.start + d);
    }
  }

  // Orden topológico estable por prioridad
  const pending = matches.filter((m) => !m.fixed).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const done = new Set(matches.filter((m) => m.fixed).map((m) => m.id));
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const m = pending[i];
      const deps = m.dependsOn.filter((d) => byId.has(d));
      if (deps.some((d) => !done.has(d) && !unscheduled.includes(d))) continue;
      pending.splice(i, 1);
      i--;
      progress = true;
      if (deps.some((d) => unscheduled.includes(d))) { unscheduled.push(m.id); continue; }
      const dur = (m.durationMin ?? cfg.durationMin) * MIN;
      let minStart = m.notBefore ?? Number.NEGATIVE_INFINITY;
      for (const d of deps) minStart = Math.max(minStart, (endOf.get(d) ?? 0) + rest);

      let best: { court: string; start: number } | null = null;
      for (const c of courts) {
        const t = earliestFit(c, courtBusy.get(c.id)!, m.players, playerBusy, minStart, dur, rest);
        if (t !== null && (best === null || t < best.start)) best = { court: c.id, start: t };
      }
      if (best) { book(m, best.court, best.start, best.start + dur); done.add(m.id); }
      else unscheduled.push(m.id);
    }
  }
  for (const m of pending) unscheduled.push(m.id); // ciclo de dependencias
  assignments.sort((a, b) => a.start - b.start || a.courtId.localeCompare(b.courtId));
  return { assignments, unscheduled };
}

function earliestFit(
  court: CourtInput,
  busy: TimeWindow[],
  players: string[],
  playerBusy: Map<string, TimeWindow[]>,
  minStart: number,
  dur: number,
  rest: number,
): number | null {
  const pBusy = players.flatMap((p) => playerBusy.get(p) ?? []);
  const windows = court.windows.slice().sort((a, b) => a.start - b.start);
  for (const w of windows) {
    const candidates = new Set<number>([Math.max(w.start, minStart)]);
    for (const b of busy) candidates.add(b.end);
    for (const b of pBusy) candidates.add(b.end + rest);
    const sorted = [...candidates].filter((t) => t >= w.start && t >= minStart && t + dur <= w.end).sort((a, b) => a - b);
    for (const t of sorted) {
      const e = t + dur;
      if (busy.some((b) => overlaps(t, e, b.start, b.end))) continue;
      if (pBusy.some((b) => overlaps(t, e, b.start - rest, b.end + rest))) continue;
      return t;
    }
  }
  return null;
}

export type ConflictKind = "COURT_OVERLAP" | "PLAYER_OVERLAP" | "REST" | "OUTSIDE_AVAILABILITY" | "DEPENDENCY";

export interface Conflict {
  kind: ConflictKind;
  matchIds: string[];
  message: string;
}

/** Valida un cronograma (por ejemplo después de un cambio manual). */
export function validateSchedule(
  courts: CourtInput[],
  matches: SchedMatch[],
  assignments: Assignment[],
  cfg: ScheduleConfig,
): Conflict[] {
  const rest = cfg.minRestMin * MIN;
  const out: Conflict[] = [];
  const byId = new Map(matches.map((m) => [m.id, m]));
  const courtMap = new Map(courts.map((c) => [c.id, c]));
  const asg = new Map(assignments.map((a) => [a.matchId, a]));
  const name = (id: string) => byId.get(id)?.label ?? id;

  for (let i = 0; i < assignments.length; i++) {
    const x = assignments[i];
    const c = courtMap.get(x.courtId);
    if (c && !c.windows.some((w) => x.start >= w.start && x.end <= w.end)) {
      out.push({ kind: "OUTSIDE_AVAILABILITY", matchIds: [x.matchId], message: `${name(x.matchId)} está fuera del horario disponible de ${c.name}.` });
    }
    for (let j = i + 1; j < assignments.length; j++) {
      const y = assignments[j];
      if (x.courtId === y.courtId && overlaps(x.start, x.end, y.start, y.end)) {
        out.push({ kind: "COURT_OVERLAP", matchIds: [x.matchId, y.matchId], message: `${name(x.matchId)} y ${name(y.matchId)} se superponen en la misma cancha.` });
      }
      const px = byId.get(x.matchId)?.players ?? [];
      const py = byId.get(y.matchId)?.players ?? [];
      const shared = px.filter((p) => py.includes(p));
      if (shared.length) {
        if (overlaps(x.start, x.end, y.start, y.end)) {
          out.push({ kind: "PLAYER_OVERLAP", matchIds: [x.matchId, y.matchId], message: `Un jugador tiene ${name(x.matchId)} y ${name(y.matchId)} al mismo tiempo.` });
        } else if (overlaps(x.start, x.end + rest, y.start, y.end + rest) && rest > 0) {
          out.push({ kind: "REST", matchIds: [x.matchId, y.matchId], message: `No se respeta el descanso mínimo de ${cfg.minRestMin} min entre ${name(x.matchId)} y ${name(y.matchId)}.` });
        }
      }
    }
  }
  for (const m of matches) {
    const a = asg.get(m.id);
    if (!a) continue;
    for (const d of m.dependsOn) {
      const da = asg.get(d);
      if (da && a.start < da.end) {
        out.push({ kind: "DEPENDENCY", matchIds: [d, m.id], message: `${name(m.id)} está programado antes de que termine ${name(d)}.` });
      }
    }
  }
  return out;
}

/**
 * Recalcula a partir de `now`: los partidos fijos (en juego, terminados o bloqueados) se mantienen;
 * el resto se vuelve a programar desde `now`.
 */
export function rescheduleFrom(courts: CourtInput[], matches: SchedMatch[], cfg: ScheduleConfig, now: number): ScheduleResult {
  const adj = matches.map((m) => (m.fixed ? m : { ...m, notBefore: Math.max(m.notBefore ?? now, now) }));
  const trimmedCourts = courts.map((c) => ({ ...c, windows: c.windows.filter((w) => w.end > now).map((w) => ({ start: Math.max(w.start, now), end: w.end })) }));
  // Las ventanas recortadas no deben invalidar los fijos: se programan igual.
  return generateSchedule(trimmedCourts, adj, cfg);
}
