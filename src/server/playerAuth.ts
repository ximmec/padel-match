/**
 * Cuentas de jugadores: completamente separadas de las cuentas del panel (otra tabla, otra cookie).
 * Un jugador nunca obtiene permisos de administración.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql, UserError } from "./db";
import { clientIp, isLoginBlocked } from "./auth";
import { hashPassword, newToken, sha256, verifyPassword } from "./password";
import { getT } from "@/i18n/server";

export const PLAYER_COOKIE = "pm_player";
const SESSION_DAYS = 180; // la sesión queda iniciada ~6 meses

export interface CurrentPlayer {
  id: string;
  orgId: string;
  name: string;
  email: string;
  phone: string | null;
  playerId: string | null;
  linkStatus: "NONE" | "PENDING" | "APPROVED";
  linkNote: string | null;
}

export function playerPasswordProblems(pw: string, msg = { short: "La contraseña debe tener al menos 8 caracteres.", mix: "La contraseña debe combinar letras y números." }): string | null {
  if (pw.length < 8) return msg.short;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return msg.mix;
  return null;
}

/** Organizador al que se suman los jugadores (si hay uno solo, ese; si no, por su slug). */
export async function playerOrg(slug?: string | null): Promise<{ id: string; name: string }> {
  const [o] = slug
    ? await sql<{ id: string; name: string }[]>`SELECT id, name FROM organizations WHERE slug = ${slug}`
    : await sql<{ id: string; name: string }[]>`SELECT id, name FROM organizations ORDER BY created_at LIMIT 1`;
  if (!o) throw new UserError("Todavía no hay un organizador configurado.");
  return o;
}

async function startSession(accountId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`INSERT INTO player_sessions (account_id, token_hash, expires_at) VALUES (${accountId}, ${sha256(token)}, ${expires})`;
  const c = await cookies();
  c.set(PLAYER_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

export async function registerPlayer(input: { name: string; email: string; password: string; phone: string | null; document: string | null; orgSlug?: string | null }) {
  const { lang, t } = await getT();
  const E = t.err;
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) throw new UserError(E.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new UserError(E.email);
  const pwErr = playerPasswordProblems(input.password, { short: E.pwShort, mix: E.pwMix });
  if (pwErr) throw new UserError(pwErr);
  const ip = await clientIp();
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM login_attempts WHERE email = ${"registro:" + ip} AND created_at > now() - interval '1 hour'`;
  if (r.n >= 10) throw new UserError(E.tooMany);
  await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${"registro:" + ip}, ${ip}, true)`;
  const org = await playerOrg(input.orgSlug);
  const hash = await hashPassword(input.password);
  const doc = input.document?.replace(/[^0-9A-Za-z]/g, "").toUpperCase() || null;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO player_accounts (org_id, email, name, password_hash, phone, document, lang)
    VALUES (${org.id}, ${email}, ${name}, ${hash}, ${input.phone?.trim() || null}, ${doc}, ${lang})
    ON CONFLICT (org_id, email) DO NOTHING RETURNING id`;
  if (!rows.length) throw new UserError(E.exists);
  await suggestLink(rows[0].id);
  await startSession(rows[0].id);
}

/**
 * Busca la ficha del jugador en los torneos (por DNI o por nombre exacto) y deja el vínculo
 * «pendiente» para que la administradora lo confirme.
 */
export async function suggestLink(accountId: string, nameHint?: string | null, docHint?: string | null) {
  const [a] = await sql<{ org_id: string; name: string; document: string | null; link_status: string }[]>`SELECT org_id, name, document, link_status FROM player_accounts WHERE id = ${accountId}`;
  if (!a || a.link_status === "APPROVED") return;
  const doc = (docHint ?? a.document)?.replace(/[^0-9A-Za-z]/g, "").toUpperCase() || null;
  const name = (nameHint ?? a.name).trim();
  let pid: string | null = null;
  if (doc) {
    const byDoc = await sql<{ id: string }[]>`SELECT id FROM players WHERE org_id = ${a.org_id} AND deleted_at IS NULL AND upper(regexp_replace(coalesce(document, ''), '[^0-9A-Za-z]', '', 'g')) = ${doc}`;
    if (byDoc.length === 1) pid = byDoc[0].id;
  }
  if (!pid) {
    const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const byName = await sql<{ id: string }[]>`
      SELECT id FROM players WHERE org_id = ${a.org_id} AND deleted_at IS NULL
        AND lower(translate(first_name || ' ' || last_name, 'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN')) = ${fold(name)}`;
    if (byName.length === 1) pid = byName[0].id;
  }
  await sql`UPDATE player_accounts SET player_id = ${pid}, link_status = 'PENDING', link_note = ${nameHint ? `Pidió vincularse como: ${nameHint}${docHint ? ` (DNI ${docHint})` : ""}` : null} WHERE id = ${accountId}`;
}

export async function loginPlayer(emailRaw: string, password: string, orgSlug?: string | null) {
  const { t } = await getT();
  const email = emailRaw.trim().toLowerCase();
  const ip = await clientIp();
  const key = "jugador:" + email;
  if (await isLoginBlocked(key, ip)) throw new UserError(t.err.blocked);
  const org = await playerOrg(orgSlug);
  const [a] = await sql<{ id: string; password_hash: string; active: boolean }[]>`SELECT id, password_hash, active FROM player_accounts WHERE org_id = ${org.id} AND email = ${email}`;
  const ok = !!a && a.active && (await verifyPassword(password, a.password_hash));
  await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${key}, ${ip}, ${ok})`;
  if (!ok) throw new UserError(t.err.bad);
  await startSession(a.id);
  // El idioma que eligió el jugador lo sigue en este dispositivo
  const [{ lang }] = await sql<{ lang: string }[]>`SELECT lang FROM player_accounts WHERE id = ${a.id}`;
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
}

export async function logoutPlayer() {
  const c = await cookies();
  const t = c.get(PLAYER_COOKIE)?.value;
  if (t) await sql`DELETE FROM player_sessions WHERE token_hash = ${sha256(t)}`;
  c.delete(PLAYER_COOKIE);
}

export const getCurrentPlayer = cache(async (): Promise<CurrentPlayer | null> => {
  const c = await cookies();
  const t = c.get(PLAYER_COOKIE)?.value;
  if (!t) return null;
  const [a] = await sql<{ id: string; org_id: string; name: string; email: string; phone: string | null; player_id: string | null; link_status: CurrentPlayer["linkStatus"]; link_note: string | null; last_seen_at: Date | null }[]>`
    SELECT a.id, a.org_id, a.name, a.email, a.phone, a.player_id, a.link_status, a.link_note, a.last_seen_at
    FROM player_sessions s JOIN player_accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${sha256(t)} AND s.expires_at > now() AND a.active`;
  if (!a) return null;
  if (!a.last_seen_at || Date.now() - new Date(a.last_seen_at).getTime() > 3600_000) {
    await sql`UPDATE player_accounts SET last_seen_at = now() WHERE id = ${a.id}`;
  }
  return { id: a.id, orgId: a.org_id, name: a.name, email: a.email, phone: a.phone, playerId: a.player_id, linkStatus: a.link_status, linkNote: a.link_note };
});

export async function requirePlayer(): Promise<CurrentPlayer> {
  const p = await getCurrentPlayer();
  if (!p) redirect("/jugadores/ingresar");
  return p;
}
