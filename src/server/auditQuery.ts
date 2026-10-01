import type { Db } from "./db";

export interface AuditFilter { orgId: string; tournamentId?: string | null; userId?: string | null; from?: string | null; to?: string | null; limit?: number }

export interface AuditRow { id: string; created_at: Date; user_name: string | null; tournament_name: string | null; entity: string; entity_id: string | null; action: string; summary: string | null; before: unknown; after: unknown }

export async function queryAudit(db: Db, f: AuditFilter): Promise<AuditRow[]> {
  return db<AuditRow[]>`
    SELECT a.id::text, a.created_at, a.user_name, t.name AS tournament_name, a.entity, a.entity_id, a.action, a.summary, a.before, a.after
    FROM audit_log a LEFT JOIN tournaments t ON t.id = a.tournament_id
    WHERE a.org_id = ${f.orgId}
      ${f.tournamentId ? db`AND a.tournament_id = ${f.tournamentId}` : db``}
      ${f.userId ? db`AND a.user_id = ${f.userId}` : db``}
      ${f.from ? db`AND a.created_at >= ${f.from}::date` : db``}
      ${f.to ? db`AND a.created_at < (${f.to}::date + 1)` : db``}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${f.limit ?? 300}`;
}
