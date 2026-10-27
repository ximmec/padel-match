/**
 * Notificaciones a jugadores: se guardan en la base (bandeja dentro de la app) y se envían
 * como notificación push (Web Push con claves VAPID) a los celulares/compus que las activaron.
 */
import webpush from "web-push";
import { sql, type Db, type Tx } from "./db";
import { env } from "@/lib/env";

/* ----------------------------- Claves VAPID ----------------------------- */

let vapidCache: { publicKey: string; privateKey: string } | null = null;

/** Claves del servidor para Web Push: de variables de entorno, o generadas una vez y guardadas en la base. */
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (vapidCache) return vapidCache;
  const pub = env("VAPID_PUBLIC_KEY"), priv = env("VAPID_PRIVATE_KEY");
  if (pub && priv) return (vapidCache = { publicKey: pub, privateKey: priv });
  const read = async () => {
    const rows = await sql<{ key: string; value: string }[]>`SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private')`;
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return m.get("vapid_public") && m.get("vapid_private") ? { publicKey: m.get("vapid_public")!, privateKey: m.get("vapid_private")! } : null;
  };
  let k = await read();
  if (!k) {
    const g = webpush.generateVAPIDKeys();
    await sql`INSERT INTO app_settings (key, value) VALUES ('vapid_public', ${g.publicKey}), ('vapid_private', ${g.privateKey}) ON CONFLICT (key) DO NOTHING`;
    k = await read();
  }
  return (vapidCache = k!);
}

/* ----------------------------- Crear notificaciones ----------------------------- */

export interface NewNotification {
  orgId: string;
  title: string;
  body: string;
  url?: string | null;
  kind?: "MANUAL" | "AUTO";
  audience?: string | null;
  sentBy?: string | null;
  accountIds: string[];
}

/** Guarda la notificación y sus destinatarios (el envío push se hace después, con `deliverPending`). */
export async function createNotification(db: Db | Tx, n: NewNotification): Promise<string | null> {
  const ids = [...new Set(n.accountIds)];
  if (!ids.length) return null;
  const [row] = await db<{ id: string }[]>`
    INSERT INTO notifications (org_id, kind, title, body, url, audience, sent_by)
    VALUES (${n.orgId}, ${n.kind ?? "MANUAL"}, ${n.title.slice(0, 120)}, ${n.body.slice(0, 600)}, ${n.url ?? null}, ${n.audience ?? null}, ${n.sentBy ?? null})
    RETURNING id`;
  await db`
    INSERT INTO notification_recipients (notification_id, account_id)
    SELECT ${row.id}, a.id FROM player_accounts a WHERE a.id = ANY(${ids}::uuid[]) AND a.org_id = ${n.orgId} AND a.active
    ON CONFLICT DO NOTHING`;
  return row.id;
}

/** Cuentas (vinculadas y aprobadas) de los jugadores de estas parejas. */
export async function accountsOfEntries(db: Db | Tx, entryIds: string[]): Promise<string[]> {
  if (!entryIds.length) return [];
  const rows = await db<{ id: string }[]>`
    SELECT DISTINCT a.id FROM entry_players ep
    JOIN player_accounts a ON a.player_id = ep.player_id AND a.link_status = 'APPROVED' AND a.active
    WHERE ep.entry_id = ANY(${entryIds}::uuid[]) AND ep.replaced_at IS NULL`;
  return rows.map((r) => r.id);
}

/** Aviso automático a los jugadores de una pareja (si tienen cuenta vinculada). */
export async function notifyEntry(db: Db | Tx, orgId: string, entryId: string, title: string, body: string, url?: string | null) {
  const ids = await accountsOfEntries(db, [entryId]);
  if (ids.length) await createNotification(db, { orgId, kind: "AUTO", title, body, url, accountIds: ids, audience: "Aviso automático" });
}

/* ----------------------------- Envío push ----------------------------- */

/** Envía las notificaciones pendientes. Se puede llamar varias veces a la vez sin duplicar envíos. */
export async function deliverPending(limit = 300): Promise<{ sent: number; noDevice: number; failed: number }> {
  const out = { sent: 0, noDevice: 0, failed: 0 };
  // Reintenta las que quedaron «enviando» hace más de 5 minutos (por ejemplo, si se cortó la función)
  await sql`UPDATE notification_recipients r SET push_status = 'PENDING' FROM notifications n
            WHERE n.id = r.notification_id AND r.push_status = 'SENDING' AND n.created_at < now() - interval '5 minutes'`;
  const batch = await sql<{ notification_id: string; account_id: string; title: string; body: string; url: string | null }[]>`
    WITH c AS (
      SELECT notification_id, account_id FROM notification_recipients
      WHERE push_status = 'PENDING' LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_recipients r SET push_status = 'SENDING' FROM c, notifications n
    WHERE r.notification_id = c.notification_id AND r.account_id = c.account_id AND n.id = r.notification_id
    RETURNING r.notification_id, r.account_id, n.title, n.body, n.url`;
  if (!batch.length) return out;
  const keys = await vapidKeys();
  const subject = (env("APP_URL") || "https://padel-match.net").replace(/\/$/, "");
  const accountIds = [...new Set(batch.map((b) => b.account_id))];
  const subs = await sql<{ id: string; account_id: string; endpoint: string; p256dh: string; auth: string }[]>`
    SELECT id, account_id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = ANY(${accountIds}::uuid[])`;
  for (const b of batch) {
    const mine = subs.filter((s) => s.account_id === b.account_id);
    let status: "SENT" | "NO_DEVICE" | "FAILED" = mine.length ? "FAILED" : "NO_DEVICE";
    const payload = JSON.stringify({ title: b.title, body: b.body, url: b.url || "/jugadores", tag: b.notification_id });
    await Promise.all(mine.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 6, urgency: "high", vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        });
        status = "SENT";
        await sql`UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = ${s.id}`;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410: el celular dio de baja la suscripción (desinstaló, borró datos, quitó el permiso)
        if (code === 404 || code === 410) await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`;
        else await sql`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ${s.id}`;
      }
    }));
    await sql`UPDATE notification_recipients SET push_status = ${status} WHERE notification_id = ${b.notification_id} AND account_id = ${b.account_id}`;
    if (status === "SENT") out.sent++; else if (status === "NO_DEVICE") out.noDevice++; else out.failed++;
  }
  return out;
}

/** Para usar con `after()`: nunca rompe la acción que lo llamó. */
export async function deliverPendingSafe() {
  try { await deliverPending(); } catch (e) { console.error("push", e); }
}
