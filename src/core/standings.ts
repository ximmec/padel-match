/**
 * Tabla de posiciones de una zona con criterios de desempate configurables.
 */
import type { ScoreSummary } from "./scoring";

export type TiebreakCriterion =
  | "WINS"          // partidos ganados
  | "HEAD_TO_HEAD"  // enfrentamiento directo (solo si el empate es entre 2 parejas)
  | "SET_DIFF"      // diferencia de sets
  | "GAME_DIFF"     // diferencia de games
  | "SETS_WON"      // sets a favor
  | "GAMES_WON"     // games a favor
  | "WIN_RATIO"     // % de partidos ganados (útil con zonas de distinto tamaño)
  | "MANUAL";       // sorteo / decisión manual registrada

export const DEFAULT_TIEBREAKS: TiebreakCriterion[] = ["WINS", "HEAD_TO_HEAD", "SET_DIFF", "GAME_DIFF", "MANUAL"];

export const TIEBREAK_LABELS: Record<TiebreakCriterion, string> = {
  WINS: "Partidos ganados",
  HEAD_TO_HEAD: "Resultado entre sí",
  SET_DIFF: "Diferencia de sets",
  GAME_DIFF: "Diferencia de games",
  SETS_WON: "Sets a favor",
  GAMES_WON: "Games a favor",
  WIN_RATIO: "% de partidos ganados",
  MANUAL: "Sorteo / decisión manual",
};

export interface ZoneMatchInput {
  id: string;
  a: string; // entryId
  b: string;
  /** Resumen solo si el partido terminó (incluye W.O.). */
  summary: ScoreSummary | null;
}

export interface StandingRow {
  entryId: string;
  played: number;
  won: number;
  lost: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
  position: number;
  /** true si la posición quedó empatada y requiere decisión manual. */
  unresolvedTie: boolean;
  /** Criterio que definió la posición respecto de la pareja siguiente (informativo). */
  decidedBy: TiebreakCriterion | null;
}

export interface ZoneStandings {
  rows: StandingRow[];
  /** La zona terminó: todos los partidos tienen resultado. */
  complete: boolean;
  pendingMatches: number;
  /** Las posiciones son definitivas: zona completa y sin empates sin resolver. */
  final: boolean;
}

function emptyRow(entryId: string): StandingRow {
  return { entryId, played: 0, won: 0, lost: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0, position: 0, unresolvedTie: false, decidedBy: null };
}

function metric(c: TiebreakCriterion, r: StandingRow): number {
  switch (c) {
    case "WINS": return r.won;
    case "SET_DIFF": return r.setsFor - r.setsAgainst;
    case "GAME_DIFF": return r.gamesFor - r.gamesAgainst;
    case "SETS_WON": return r.setsFor;
    case "GAMES_WON": return r.gamesFor;
    case "WIN_RATIO": return r.played ? r.won / r.played : 0;
    default: return 0;
  }
}

/**
 * @param manualOrder orden manual (entryIds) para resolver empates que persisten (sorteo registrado).
 */
export function computeStandings(
  entryIds: string[],
  matches: ZoneMatchInput[],
  criteria: TiebreakCriterion[] = DEFAULT_TIEBREAKS,
  manualOrder: string[] = [],
): ZoneStandings {
  const rows = new Map(entryIds.map((id) => [id, emptyRow(id)]));
  let pending = 0;
  for (const m of matches) {
    const ra = rows.get(m.a);
    const rb = rows.get(m.b);
    if (!ra || !rb) continue; // partido de una pareja que ya no está en la zona
    if (!m.summary) { pending++; continue; }
    const s = m.summary;
    ra.played++; rb.played++;
    ra.setsFor += s.setsA; ra.setsAgainst += s.setsB; ra.gamesFor += s.gamesA; ra.gamesAgainst += s.gamesB;
    rb.setsFor += s.setsB; rb.setsAgainst += s.setsA; rb.gamesFor += s.gamesB; rb.gamesAgainst += s.gamesA;
    if (s.winner === "A") { ra.won++; rb.lost++; } else { rb.won++; ra.lost++; }
  }

  const h2hWinner = (x: string, y: string): string | null => {
    const ms = matches.filter((m) => m.summary && ((m.a === x && m.b === y) || (m.a === y && m.b === x)));
    let wx = 0, wy = 0;
    for (const m of ms) {
      const w = m.summary!.winner === "A" ? m.a : m.b;
      if (w === x) wx++; else wy++;
    }
    if (wx === wy) return null;
    return wx > wy ? x : y;
  };

  const manualIdx = (id: string) => {
    const i = manualOrder.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };

  /** Ordena un grupo empatado aplicando criterios desde `ci`. Devuelve grupos ordenados. */
  const rank = (group: StandingRow[], ci: number): { rows: StandingRow[]; tied: boolean; by: TiebreakCriterion | null }[] => {
    if (group.length === 1) return [{ rows: group, tied: false, by: ci > 0 ? criteria[ci - 1] ?? null : null }];
    if (ci >= criteria.length) return [{ rows: group, tied: true, by: null }];
    const c = criteria[ci];
    if (c === "HEAD_TO_HEAD") {
      if (group.length === 2) {
        const w = h2hWinner(group[0].entryId, group[1].entryId);
        if (w) {
          const first = group.find((r) => r.entryId === w)!;
          const second = group.find((r) => r.entryId !== w)!;
          return [{ rows: [first], tied: false, by: c }, { rows: [second], tied: false, by: c }];
        }
      }
      return rank(group, ci + 1);
    }
    if (c === "MANUAL") {
      const allKnown = group.every((r) => manualIdx(r.entryId) !== Number.POSITIVE_INFINITY);
      if (!allKnown) return [{ rows: group, tied: true, by: null }];
      return group
        .slice()
        .sort((x, y) => manualIdx(x.entryId) - manualIdx(y.entryId))
        .map((r) => ({ rows: [r], tied: false, by: c }));
    }
    const buckets = new Map<number, StandingRow[]>();
    for (const r of group) {
      const k = metric(c, r);
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    const keys = [...buckets.keys()].sort((x, y) => y - x);
    const out: { rows: StandingRow[]; tied: boolean; by: TiebreakCriterion | null }[] = [];
    for (const k of keys) {
      const b = buckets.get(k)!;
      if (b.length === 1) out.push({ rows: b, tied: false, by: keys.length > 1 ? c : null });
      else out.push(...rank(b, ci + 1));
    }
    return out;
  };

  const all = [...rows.values()];
  const groups = rank(all, 0);
  const ordered: StandingRow[] = [];
  let anyTie = false;
  for (const g of groups) {
    // dentro de un empate sin resolver mantenemos orden estable por entryIds originales
    const sorted = g.rows.slice().sort((x, y) => entryIds.indexOf(x.entryId) - entryIds.indexOf(y.entryId));
    for (const r of sorted) {
      r.unresolvedTie = g.tied;
      r.decidedBy = g.tied ? null : g.by;
      ordered.push(r);
    }
    if (g.tied) anyTie = true;
  }
  // posiciones: las parejas empatadas sin resolver comparten la mejor posición del grupo
  let pos = 1;
  for (const g of groups) {
    for (const r of g.rows) r.position = g.tied ? pos : pos + g.rows.indexOf(r);
    pos += g.rows.length;
  }
  ordered.sort((x, y) => x.position - y.position);
  const complete = pending === 0;
  return { rows: ordered, complete, pendingMatches: pending, final: complete && !anyTie };
}

/**
 * Comparación entre zonas de distinto tamaño (p. ej. "mejores segundos").
 * Usa promedios por partido para no favorecer zonas más grandes:
 * % ganados → dif. de sets por partido → dif. de games por partido → games a favor por partido.
 */
export interface CrossZoneRow {
  entryId: string;
  zoneId: string;
  row: StandingRow;
}

export function crossZoneKey(r: StandingRow): number[] {
  const p = Math.max(1, r.played);
  return [r.won / p, (r.setsFor - r.setsAgainst) / p, (r.gamesFor - r.gamesAgainst) / p, r.gamesFor / p];
}

export interface CrossZoneOptions {
  /**
   * Si es true, en zonas más grandes que la más chica se descartan los partidos
   * contra la/s última/s pareja/s para igualar cantidad de partidos.
   * Requiere pasar los partidos y standings completos; ver `normalizeForCrossZone`.
   */
  dropVsLast?: boolean;
}

export function rankAcrossZones(rows: CrossZoneRow[], manualOrder: string[] = []): { ordered: CrossZoneRow[]; ties: string[][] } {
  const cmp = (x: CrossZoneRow, y: CrossZoneRow) => {
    const kx = crossZoneKey(x.row), ky = crossZoneKey(y.row);
    for (let i = 0; i < kx.length; i++) {
      if (Math.abs(kx[i] - ky[i]) > 1e-9) return ky[i] - kx[i];
    }
    return 0;
  };
  const sorted = rows.slice().sort((x, y) => {
    const c = cmp(x, y);
    if (c !== 0) return c;
    const mi = manualOrder.indexOf(x.entryId), mj = manualOrder.indexOf(y.entryId);
    if (mi !== -1 && mj !== -1) return mi - mj;
    return x.zoneId < y.zoneId ? -1 : x.zoneId > y.zoneId ? 1 : 0;
  });
  const ties: string[][] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    if (j - i > 1) {
      const ids = sorted.slice(i, j).map((r) => r.entryId);
      const resolved = ids.every((id) => manualOrder.includes(id));
      if (!resolved) ties.push(ids);
    }
    i = j;
  }
  return { ordered: sorted, ties };
}

/**
 * Opción (b): en zonas más grandes, excluye los partidos contra la última pareja
 * de esa zona antes de comparar. Devuelve los partidos filtrados.
 */
export function dropMatchesVsLast(standings: ZoneStandings, matches: ZoneMatchInput[], extra: number): ZoneMatchInput[] {
  if (extra <= 0) return matches;
  const last = standings.rows.slice(-extra).map((r) => r.entryId);
  return matches.filter((m) => !last.includes(m.a) && !last.includes(m.b));
}
