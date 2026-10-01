import type { Db } from "./db";
import { UserError } from "./db";
import type { CurrentUser } from "./auth";
import { audit } from "./audit";
import { loadCategory, type LoadedCategory } from "./category";
import { computeAwards, aggregateRanking, type RankingFilter, type LedgerRow } from "@/core/ranking";
import { categoryStages } from "@/core/engine";

/**
 * Recalcula los puntos automáticos de una categoría de torneo.
 * Idempotente: las asignaciones vigentes se marcan como reemplazadas y se insertan las nuevas,
 * nunca se suman dos veces. Si el cuadro deja de estar completo (p. ej. por una corrección),
 * los puntos se retiran hasta que vuelva a haber campeón.
 */
export async function recalcRanking(db: Db, user: CurrentUser | null, lc: LoadedCategory): Promise<{ changed: boolean; awarded: number }> {
  const { stages, complete } = categoryStages(lc.state, lc.view);
  const current = await db<{ player_id: string; points: number; stage: string }[]>`
    SELECT player_id, points, stage FROM ranking_ledger
    WHERE tc_id = ${lc.tc.id} AND kind = 'AUTO' AND superseded_at IS NULL`;

  const awards = complete
    ? computeAwards(
        stages,
        lc.entries.map((e) => ({ entryId: e.id, playerIds: e.players.map((p) => p.id) })),
        lc.rules.points,
      )
    : [];

  const key = (p: string, pts: number, s: string) => `${p}|${pts}|${s}`;
  const before = new Set(current.map((c) => key(c.player_id, c.points, c.stage)));
  const after = new Set(awards.map((a) => key(a.playerId, a.points, a.stage)));
  const same = before.size === after.size && [...before].every((k) => after.has(k));
  if (same) return { changed: false, awarded: awards.length };

  await db`UPDATE ranking_ledger SET superseded_at = now()
           WHERE tc_id = ${lc.tc.id} AND kind = 'AUTO' AND superseded_at IS NULL`;
  for (const a of awards) {
    await db`
      INSERT INTO ranking_ledger (org_id, player_id, tc_id, entry_id, kind, stage, points, category_id, circuit_id, season_id, created_by)
      VALUES (${lc.tc.org_id}, ${a.playerId}, ${lc.tc.id}, ${a.entryId}, 'AUTO', ${a.stage}, ${a.points},
              ${lc.tc.category_id}, ${lc.tc.circuit_id}, ${lc.tc.season_id}, ${user?.id ?? null})`;
  }
  await db`UPDATE tournament_categories SET points_awarded_at = ${complete ? new Date() : null},
           status = ${complete ? "FINISHED" : lc.tc.status === "FINISHED" ? "PLAYOFFS" : lc.tc.status}
           WHERE id = ${lc.tc.id}`;
  await audit(db, user, {
    entity: "ranking", entityId: lc.tc.id, action: "ranking_recalc", tournamentId: lc.tc.tournament_id,
    summary: complete
      ? `Puntos asignados en ${lc.tc.tournament_name} · ${lc.tc.category_name} (${awards.length} jugadores)`
      : `Puntos retirados de ${lc.tc.tournament_name} · ${lc.tc.category_name}: el cuadro ya no está completo`,
    before: current, after: awards,
  });
  return { changed: true, awarded: awards.length };
}

export async function recalcRankingById(db: Db, user: CurrentUser | null, tcId: string, orgId: string) {
  const lc = await loadCategory(db, tcId, orgId);
  return recalcRanking(db, user, lc);
}

export async function manualAdjustment(db: Db, user: CurrentUser, input: {
  playerId: string; points: number; reason: string; tcId?: string | null; categoryId?: string | null; circuitId?: string | null; seasonId?: string | null;
}) {
  if (!input.reason || input.reason.trim().length < 5) throw new UserError("Indicá un motivo (mínimo 5 caracteres).");
  if (!Number.isInteger(input.points) || input.points === 0) throw new UserError("Los puntos deben ser un entero distinto de 0.");
  const [p] = await db<{ id: string; first_name: string; last_name: string }[]>`SELECT id, first_name, last_name FROM players WHERE id = ${input.playerId} AND org_id = ${user.orgId}`;
  if (!p) throw new UserError("Jugador no encontrado.");
  let tournamentId: string | null = null;
  let categoryId = input.categoryId ?? null, circuitId = input.circuitId ?? null, seasonId = input.seasonId ?? null;
  if (input.tcId) {
    const [tc] = await db<{ tournament_id: string; category_id: string; circuit_id: string | null; season_id: string | null }[]>`
      SELECT tc.tournament_id, tc.category_id, t.circuit_id, t.season_id FROM tournament_categories tc JOIN tournaments t ON t.id = tc.tournament_id
      WHERE tc.id = ${input.tcId} AND t.org_id = ${user.orgId}`;
    if (!tc) throw new UserError("Torneo no encontrado.");
    tournamentId = tc.tournament_id; categoryId = tc.category_id; circuitId = tc.circuit_id; seasonId = tc.season_id;
  }
  const [row] = await db<{ id: string }[]>`
    INSERT INTO ranking_ledger (org_id, player_id, tc_id, kind, points, reason, category_id, circuit_id, season_id, created_by)
    VALUES (${user.orgId}, ${p.id}, ${input.tcId ?? null}, 'MANUAL', ${input.points}, ${input.reason.trim()}, ${categoryId}, ${circuitId}, ${seasonId}, ${user.id})
    RETURNING id`;
  await audit(db, user, {
    entity: "ranking", entityId: row.id, action: "ranking_adjust", tournamentId,
    summary: `Ajuste de ${input.points > 0 ? "+" : ""}${input.points} pts a ${p.first_name} ${p.last_name}: ${input.reason.trim()}`,
    after: input,
  });
}

export interface RankingListRow { position: number; player_id: string; code: string; first_name: string; last_name: string; points: number; events: number }

export async function getRanking(db: Db, orgId: string, f: RankingFilter): Promise<RankingListRow[]> {
  const rows = await db<(LedgerRow & { code: string; first_name: string; last_name: string })[]>`
    SELECT l.player_id AS "playerId", l.points, l.tc_id AS "tournamentCategoryId", l.category_id AS "categoryId",
           l.circuit_id AS "circuitId", l.season_id AS "seasonId", p.code, p.first_name, p.last_name
    FROM ranking_ledger l JOIN players p ON p.id = l.player_id
    WHERE l.org_id = ${orgId} AND l.superseded_at IS NULL AND p.deleted_at IS NULL`;
  const info = new Map(rows.map((r) => [r.playerId, r]));
  return aggregateRanking(rows, f).map((r) => {
    const p = info.get(r.playerId)!;
    return { position: r.position, player_id: r.playerId, code: p.code, first_name: p.first_name, last_name: p.last_name, points: r.points, events: r.events };
  });
}

export async function playerPointsHistory(db: Db, playerId: string) {
  return db<{ id: string; kind: string; stage: string | null; points: number; reason: string | null; created_at: Date; superseded_at: Date | null;
              tournament_name: string | null; tournament_slug: string | null; category_name: string | null; start_date: Date | null }[]>`
    SELECT l.id, l.kind, l.stage, l.points, l.reason, l.created_at, l.superseded_at,
           t.name AS tournament_name, t.slug AS tournament_slug, c.name AS category_name, t.start_date
    FROM ranking_ledger l
    LEFT JOIN tournament_categories tc ON tc.id = l.tc_id
    LEFT JOIN tournaments t ON t.id = tc.tournament_id
    LEFT JOIN categories c ON c.id = l.category_id
    WHERE l.player_id = ${playerId}
    ORDER BY l.created_at DESC`;
}
