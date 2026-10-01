import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "./db";
import { newToken, sha256, verifyPassword } from "./password";
import { effectivePermissions, type Permission, type Role, type PermissionOverrides } from "./permissions";

export const SESSION_COOKIE = "pm_session";
const SESSION_DAYS = 14;

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  isSuperadmin: boolean;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
  permissions: Set<Permission>;
  /** Organizaciones disponibles para cambiar. */
  orgs: { id: string; name: string; role: Role }[];
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** Bloquea después de 5 intentos fallidos en 15 minutos (por email o IP). */
export async function isLoginBlocked(email: string, ip: string): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM login_attempts
    WHERE success = false AND created_at > now() - interval '15 minutes' AND (email = ${email} OR ip = ${ip})`;
  return r.n >= 5;
}

export async function login(emailRaw: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = emailRaw.trim().toLowerCase();
  const ip = await clientIp();
  if (await isLoginBlocked(email, ip)) {
    return { ok: false, error: "Demasiados intentos fallidos. Esperá 15 minutos y volvé a intentar." };
  }
  const [u] = await sql<{ id: string; password_hash: string; active: boolean }[]>`SELECT id, password_hash, active FROM users WHERE email = ${email}`;
  const ok = !!u && u.active && (await verifyPassword(password, u.password_hash));
  await sql`INSERT INTO login_attempts (email, ip, success) VALUES (${email}, ${ip}, ${ok})`;
  if (!ok) return { ok: false, error: "Email o contraseña incorrectos." };
  await createSession(u.id);
  return { ok: true };
}

export async function createSession(userId: string, orgId: string | null = null) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`INSERT INTO sessions (user_id, token_hash, org_id, expires_at) VALUES (${userId}, ${sha256(token)}, ${orgId}, ${expires})`;
  const c = await cookies();
  c.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function logout() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
  c.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [s] = await sql<{ session_id: string; user_id: string; org_id: string | null; name: string; email: string; is_superadmin: boolean; active: boolean }[]>`
    SELECT s.id AS session_id, s.user_id, s.org_id, u.name, u.email, u.is_superadmin, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()`;
  if (!s || !s.active) return null;

  const orgs = s.is_superadmin
    ? await sql<{ id: string; name: string; slug: string; role: Role; permissions: PermissionOverrides }[]>`
        SELECT o.id, o.name, o.slug, 'ADMIN'::text AS role, '{}'::jsonb AS permissions FROM organizations o ORDER BY o.name`
    : await sql<{ id: string; name: string; slug: string; role: Role; permissions: PermissionOverrides }[]>`
        SELECT o.id, o.name, o.slug, m.role, m.permissions FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ${s.user_id} ORDER BY o.name`;
  if (orgs.length === 0) return null;
  const current = orgs.find((o) => o.id === s.org_id) ?? orgs[0];
  return {
    id: s.user_id,
    name: s.name,
    email: s.email,
    isSuperadmin: s.is_superadmin,
    orgId: current.id,
    orgName: current.name,
    orgSlug: current.slug,
    role: current.role,
    permissions: effectivePermissions(current.role, current.permissions, s.is_superadmin),
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, role: o.role })),
  };
});

export async function switchOrg(orgId: string) {
  const u = await requireUser();
  if (!u.orgs.some((o) => o.id === orgId)) return;
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await sql`UPDATE sessions SET org_id = ${orgId} WHERE token_hash = ${sha256(token)}`;
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export class ForbiddenError extends Error {
  constructor(p: Permission) { super(`No tenés permiso para esta acción (${p}).`); }
}

/** Para páginas: redirige si no hay sesión; muestra error si falta permiso. */
export async function requirePermission(p: Permission): Promise<CurrentUser> {
  const u = await requireUser();
  if (!u.permissions.has(p)) throw new ForbiddenError(p);
  return u;
}

export function can(u: CurrentUser, p: Permission) {
  return u.permissions.has(p);
}
