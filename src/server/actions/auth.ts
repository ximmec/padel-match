"use server";

import { redirect } from "next/navigation";
import { sql, UserError, friendlyDbError } from "../db";
import { login, logout, createSession, switchOrg, getCurrentUser } from "../auth";
import { hashPassword, passwordProblems } from "../password";
import { audit } from "../audit";
import type { ActionState } from "../action";
import { str } from "../action";
import { slugify } from "../ops";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await login(str(fd, "email"), String(fd.get("password") ?? ""));
  if (!r.ok) return { error: r.error, at: Date.now() };
  const next = str(fd, "next");
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function switchOrgAction(fd: FormData) {
  await switchOrg(str(fd, "orgId"));
  redirect("/admin");
}

/** Configuración inicial: solo funciona si todavía no existe ningún usuario. */
export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const setupKey = process.env.SETUP_KEY;
    if (setupKey && str(fd, "setupKey") !== setupKey) throw new UserError("Clave de instalación incorrecta.");
    const orgName = str(fd, "orgName");
    const name = str(fd, "name");
    const email = str(fd, "email").toLowerCase();
    const password = String(fd.get("password") ?? "");
    if (!orgName || !name || !/^\S+@\S+\.\S+$/.test(email)) throw new UserError("Completá todos los datos con un email válido.");
    const pp = passwordProblems(password);
    if (pp) throw new UserError(pp);
    const hash = await hashPassword(password);
    const userId = await sql.begin(async (tx) => {
      await tx`LOCK TABLE users IN EXCLUSIVE MODE`;
      const [n] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
      if (n.n > 0) throw new UserError("La aplicación ya fue configurada. Iniciá sesión.");
      const [org] = await tx<{ id: string }[]>`INSERT INTO organizations (name, slug) VALUES (${orgName}, ${slugify(orgName)}) RETURNING id`;
      const [u] = await tx<{ id: string }[]>`INSERT INTO users (email, name, password_hash, is_superadmin) VALUES (${email}, ${name}, ${hash}, true) RETURNING id`;
      await tx`INSERT INTO memberships (user_id, org_id, role) VALUES (${u.id}, ${org.id}, 'ADMIN')`;
      await tx`INSERT INTO categories (org_id, name, gender_rule) VALUES
        (${org.id}, 'Libre Masculina', 'MALE'), (${org.id}, 'Libre Femenina', 'FEMALE'), (${org.id}, 'Mixta', 'MIXED')`;
      await tx`INSERT INTO seasons (org_id, name) VALUES (${org.id}, ${String(new Date().getFullYear())})`;
      await audit(tx, null, { entity: "organization", entityId: org.id, action: "create", summary: `Instalación inicial: ${orgName} / ${email}` });
      return u.id;
    });
    await createSession(userId);
  } catch (e) {
    return { error: friendlyDbError(e), at: Date.now() };
  }
  redirect("/admin");
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sesión expirada.", at: Date.now() };
  try {
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    const { verifyPassword } = await import("../password");
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`;
    if (!(await verifyPassword(current, u.password_hash))) throw new UserError("La contraseña actual no es correcta.");
    const pp = passwordProblems(next);
    if (pp) throw new UserError(pp);
    await sql`UPDATE users SET password_hash = ${await hashPassword(next)} WHERE id = ${user.id}`;
    await sql.begin((tx) => audit(tx, user, { entity: "user", entityId: user.id, action: "update", summary: "Cambio de contraseña" }));
    return { ok: true, message: "Contraseña actualizada.", at: Date.now() };
  } catch (e) {
    return { error: friendlyDbError(e), at: Date.now() };
  }
}
