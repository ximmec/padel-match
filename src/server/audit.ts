import type { Db } from "./db";
import type { CurrentUser } from "./auth";

export interface AuditInput {
  entity: string;
  entityId?: string | null;
  action: string;
  summary?: string;
  tournamentId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function audit(db: Db, user: CurrentUser | null, a: AuditInput) {
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  await db`
    INSERT INTO audit_log (org_id, user_id, user_name, tournament_id, entity, entity_id, action, summary, before, after)
    VALUES (${user?.orgId ?? null}, ${user?.id ?? null}, ${user?.name ?? "sistema"}, ${a.tournamentId ?? null},
            ${a.entity}, ${a.entityId ?? null}, ${a.action}, ${a.summary ?? null},
            ${json(a.before)}::jsonb, ${json(a.after)}::jsonb)`;
}

export const ACTION_LABELS: Record<string, string> = {
  create: "Alta",
  update: "Modificación",
  delete: "Baja",
  result: "Carga de resultado",
  result_correction: "Corrección de resultado",
  withdraw: "Retiro",
  replace_player: "Reemplazo de jugador",
  move_zone: "Cambio de zona",
  generate_zones: "Generación de zonas",
  generate_bracket: "Generación de cuadro",
  edit_bracket: "Cambio manual de cruce",
  schedule: "Cambio de cronograma",
  generate_schedule: "Generación de cronograma",
  ranking_recalc: "Recálculo de ranking",
  ranking_adjust: "Ajuste manual de ranking",
  tiebreak: "Desempate manual",
  login: "Inicio de sesión",
};
