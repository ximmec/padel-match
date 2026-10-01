/**
 * Ranking individual acumulativo.
 *
 * Los puntos funcionan como un libro contable: por cada (jugador, torneo-categoría)
 * existe a lo sumo UNA asignación automática. Recalcular reemplaza esa asignación,
 * nunca la suma de nuevo. Los ajustes manuales son filas aparte con motivo obligatorio.
 */
import type { Stage } from "./bracket";

export type PointsTable = Record<Stage, number>;

export const DEFAULT_POINTS: PointsTable = {
  CHAMPION: 1000,
  FINALIST: 600,
  SEMIFINAL: 360,
  QUARTERFINAL: 180,
  ROUND_OF_16: 90,
  ROUND_OF_32: 45,
  ROUND_OF_64: 25,
  ZONE: 10,
};

export interface EntryPlayers { entryId: string; playerIds: string[] }

export interface Award { playerId: string; entryId: string; stage: Stage; points: number }

/** Puntos para cada jugador de cada pareja según la etapa alcanzada. */
export function computeAwards(stages: Map<string, Stage>, entries: EntryPlayers[], table: PointsTable): Award[] {
  const out: Award[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const stage = stages.get(e.entryId);
    if (!stage) continue;
    for (const p of e.playerIds) {
      // Un jugador recibe puntos una sola vez por torneo-categoría.
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ playerId: p, entryId: e.entryId, stage, points: table[stage] ?? 0 });
    }
  }
  return out;
}

export interface LedgerRow {
  playerId: string;
  points: number;
  tournamentCategoryId: string | null;
  categoryId: string | null;
  circuitId: string | null;
  seasonId: string | null;
}

export interface RankingFilter { categoryId?: string; circuitId?: string; seasonId?: string }

export interface RankingRow { playerId: string; points: number; events: number; position: number }

export function aggregateRanking(rows: LedgerRow[], f: RankingFilter = {}): RankingRow[] {
  const acc = new Map<string, { points: number; events: Set<string> }>();
  for (const r of rows) {
    if (f.categoryId && r.categoryId !== f.categoryId) continue;
    if (f.circuitId && r.circuitId !== f.circuitId) continue;
    if (f.seasonId && r.seasonId !== f.seasonId) continue;
    const a = acc.get(r.playerId) ?? { points: 0, events: new Set<string>() };
    a.points += r.points;
    if (r.tournamentCategoryId) a.events.add(r.tournamentCategoryId);
    acc.set(r.playerId, a);
  }
  const list = [...acc.entries()]
    .map(([playerId, a]) => ({ playerId, points: a.points, events: a.events.size, position: 0 }))
    .sort((x, y) => y.points - x.points || x.events - y.events || x.playerId.localeCompare(y.playerId));
  let pos = 0;
  list.forEach((r, i) => {
    if (i === 0 || r.points !== list[i - 1].points) pos = i + 1;
    r.position = pos;
  });
  return list;
}
