/** Campanita del panel: avisos de jugadores que se registran o piden vincular su ficha. */
import { sql, type Db } from "./db";

export interface AdminAlert { id: string; kind: "REGISTER" | "LINK"; title: string; detail: string | null; created_at: Date; unread: boolean }

export async function recordAdminEvent(db: Db, e: { orgId: string; kind: "REGISTER" | "LINK"; accountId: string; title: string; detail?: string | null }) {
  try {
    await db`INSERT INTO admin_events (org_id, kind, account_id, title, detail) VALUES (${e.orgId}, ${e.kind}, ${e.accountId}, ${e.title}, ${e.detail ?? null})`;
  } catch (err) { console.error("aviso panel", err); }
}

export async function getAdminAlerts(userId: string, orgId: string, limit = 15): Promise<{ unread: number; items: AdminAlert[] }> {
  const [seen] = await sql<{ seen_at: Date }[]>`SELECT seen_at FROM admin_seen WHERE user_id = ${userId} AND org_id = ${orgId}`;
  const since = seen?.seen_at ?? new Date(0);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM admin_events WHERE org_id = ${orgId} AND created_at > ${since}`;
  const rows = await sql<Omit<AdminAlert, "unread">[]>`
    SELECT id, kind, title, detail, created_at FROM admin_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${limit}`;
  return { unread: n, items: rows.map((r) => ({ ...r, unread: new Date(r.created_at) > since })) };
}

export async function markAdminAlertsSeen(userId: string, orgId: string) {
  await sql`INSERT INTO admin_seen (user_id, org_id, seen_at) VALUES (${userId}, ${orgId}, now())
            ON CONFLICT (user_id, org_id) DO UPDATE SET seen_at = now()`;
}
