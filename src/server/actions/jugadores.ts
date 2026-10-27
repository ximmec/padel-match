"use server";
/**
 * Acciones del área de jugadores («Mi Padel Match») y del panel de notificaciones.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { sql, friendlyDbError, UserError } from "../db";
import { runAction, str, optStr, uuid, type ActionState } from "../action";
import { audit } from "../audit";
import { NeedsConfirmation } from "../errors";
import type { CurrentUser } from "../auth";
import { getCurrentPlayer, loginPlayer, logoutPlayer, registerPlayer, suggestLink, type CurrentPlayer } from "../playerAuth";
import { createNotification, deliverPendingSafe, deliverPending } from "../notify";

/* ------------------------------ Jugador ------------------------------ */

async function runPlayer(fn: (p: CurrentPlayer) => Promise<ActionState | void>): Promise<ActionState> {
  const p = await getCurrentPlayer();
  if (!p) return { error: "Tu sesión expiró. Volvé a ingresar.", at: Date.now() };
  try {
    const r = (await fn(p)) ?? {};
    revalidatePath("/jugadores", "layout");
    return { ok: true, ...r, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    return { error: friendlyDbError(e), at: Date.now() };
  }
}

async function guarded(fn: () => Promise<ActionState>): Promise<ActionState> {
  try { return await fn(); } catch (e) {
    if (e instanceof UserError) return { error: e.message, at: Date.now() };
    return { error: friendlyDbError(e), at: Date.now() };
  }
}

export async function playerRegisterAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    if (str(fd, "password") !== str(fd, "password2")) throw new UserError("Las contraseñas no coinciden.");
    await registerPlayer({ name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password"), phone: optStr(fd, "phone"), document: optStr(fd, "document"), orgSlug: optStr(fd, "org") });
    return { ok: true, message: "¡Cuenta creada!", redirectTo: "/jugadores", at: Date.now() };
  });
}

export async function playerLoginAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await loginPlayer(str(fd, "email"), str(fd, "password"), optStr(fd, "org"));
    return { ok: true, redirectTo: "/jugadores", at: Date.now() };
  });
}

export async function playerLogoutAction() {
  await logoutPlayer();
  revalidatePath("/jugadores", "layout");
}

/** Pedir (o volver a pedir) el vínculo con la ficha de jugador de los torneos. */
export async function playerLinkRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runPlayer(async (p) => {
    if (p.linkStatus === "APPROVED") throw new UserError("Tu cuenta ya está vinculada.");
    const name = str(fd, "as_name");
    if (name.length < 3) throw new UserError("Escribí tu nombre y apellido como figura en los torneos.");
    await suggestLink(p.id, name, optStr(fd, "as_document"));
    return { message: "¡Listo! La organización va a confirmar que sos vos." };
  });
}

export async function playerProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runPlayer(async (p) => {
    const name = str(fd, "name").replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 80) throw new UserError("Escribí tu nombre y apellido.");
    await sql`UPDATE player_accounts SET name = ${name}, phone = ${optStr(fd, "phone")} WHERE id = ${p.id}`;
    return { message: "Datos guardados." };
  });
}

/** Guarda la suscripción push de este celular/compu (la llama el botón «Activar notificaciones»). */
export async function savePushSubscription(json: string, userAgent: string): Promise<{ ok: boolean; error?: string }> {
  const p = await getCurrentPlayer();
  if (!p) return { ok: false, error: "Tu sesión expiró. Volvé a ingresar." };
  try {
    const s = JSON.parse(json) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth || s.endpoint.length > 1000) return { ok: false, error: "Suscripción inválida." };
    await sql`
      INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, user_agent)
      VALUES (${p.id}, ${s.endpoint}, ${s.keys.p256dh}, ${s.keys.auth}, ${userAgent.slice(0, 200)})
      ON CONFLICT (endpoint) DO UPDATE SET account_id = EXCLUDED.account_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`;
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const p = await getCurrentPlayer();
  if (!p) return { ok: false };
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND account_id = ${p.id}`;
  return { ok: true };
}

/** «Enviarme una prueba»: para comprobar que las notificaciones llegan a este celular. */
export async function sendTestToMe(): Promise<{ ok: boolean; error?: string; result?: string }> {
  const p = await getCurrentPlayer();
  if (!p) return { ok: false, error: "Tu sesión expiró." };
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications n JOIN notification_recipients r ON r.notification_id = n.id
    WHERE r.account_id = ${p.id} AND n.audience = 'Prueba' AND n.created_at > now() - interval '1 minute'`;
  if (r.n >= 3) return { ok: false, error: "Esperá un minuto antes de pedir otra prueba." };
  await createNotification(sql, { orgId: p.orgId, kind: "AUTO", title: "¡Notificaciones activadas! 🎾", body: "Así te van a llegar los avisos de tus partidos.", url: "/jugadores", audience: "Prueba", accountIds: [p.id] });
  const d = await deliverPending();
  return { ok: true, result: d.sent ? "sent" : d.noDevice ? "nodevice" : "failed" };
}

export async function markAllReadAction(): Promise<void> {
  const p = await getCurrentPlayer();
  if (!p) return;
  await sql`UPDATE notification_recipients SET read_at = now() WHERE account_id = ${p.id} AND read_at IS NULL`;
  revalidatePath("/jugadores", "layout");
}

/* ------------------------------ Panel (administradora general) ------------------------------ */

function masterOnly(u: CurrentUser) {
  if (u.role !== "ADMIN" && !u.isSuperadmin) throw new UserError("Solo el administrador general puede usar las notificaciones.");
}

export async function sendNotificationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    masterOnly(user);
    const title = str(fd, "title"), body = str(fd, "body");
    if (title.length < 2 || title.length > 80) throw new UserError("Escribí un título (hasta 80 caracteres).");
    if (body.length < 2 || body.length > 500) throw new UserError("Escribí el mensaje (hasta 500 caracteres).");
    let url = optStr(fd, "url");
    if (url && !/^\/[^\s]*$/.test(url) && !/^https:\/\/[^\s]+$/.test(url)) throw new UserError("El enlace tiene que empezar con / (una página de Padel Match) o con https://");
    url = url || "/jugadores";
    const to = str(fd, "to");
    let ids: string[] = [];
    let audience = "";
    if (to === "ALL") {
      ids = (await sql<{ id: string }[]>`SELECT id FROM player_accounts WHERE org_id = ${user.orgId} AND active`).map((r) => r.id);
      audience = "Todos los jugadores registrados";
    } else if (to === "SELECTED") {
      ids = fd.getAll("acc").map(String).filter(Boolean).map((x) => uuid(x));
      audience = `${ids.length} jugador(es) elegidos`;
    } else if (to === "TOURNAMENT") {
      const t = uuid(fd, "tournament_id");
      const [tn] = await sql<{ name: string }[]>`SELECT name FROM tournaments WHERE id = ${t} AND org_id = ${user.orgId}`;
      if (!tn) throw new UserError("Torneo no encontrado.");
      ids = (await sql<{ id: string }[]>`
        SELECT DISTINCT a.id FROM tournament_categories tc JOIN entries e ON e.tc_id = tc.id AND e.status = 'ACTIVE'
        JOIN entry_players ep ON ep.entry_id = e.id AND ep.replaced_at IS NULL
        JOIN player_accounts a ON a.player_id = ep.player_id AND a.link_status = 'APPROVED' AND a.active
        WHERE tc.tournament_id = ${t}`).map((r) => r.id);
      audience = `Jugadores del torneo ${tn.name}`;
    } else throw new UserError("Elegí a quién mandarla.");
    if (!ids.length) throw new UserError(to === "TOURNAMENT" ? "Ningún jugador de ese torneo tiene cuenta vinculada todavía." : "Elegí al menos un jugador.");
    const id = await createNotification(sql, { orgId: user.orgId, kind: "MANUAL", title, body, url, audience, sentBy: user.id, accountIds: ids });
    await audit(sql, user, { entity: "notification", entityId: id ?? undefined, action: "create", summary: `Notificación «${title}» a ${audience} (${ids.length})` });
    after(deliverPendingSafe);
    return { message: `Notificación enviada a ${ids.length} jugador${ids.length > 1 ? "es" : ""}.` };
  }, ["/admin/notificaciones"]);
}

export async function setAccountLinkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    masterOnly(user);
    const id = uuid(fd, "account_id");
    const op = str(fd, "op");
    const [a] = await sql<{ name: string; player_id: string | null }[]>`SELECT name, player_id FROM player_accounts WHERE id = ${id} AND org_id = ${user.orgId}`;
    if (!a) throw new UserError("Cuenta no encontrada.");
    if (op === "APPROVE") {
      const pid = uuid(fd, "player_id");
      const [pl] = await sql<{ first_name: string; last_name: string }[]>`SELECT first_name, last_name FROM players WHERE id = ${pid} AND org_id = ${user.orgId} AND deleted_at IS NULL`;
      if (!pl) throw new UserError("Elegí la ficha del jugador.");
      const [other] = await sql<{ name: string }[]>`SELECT name FROM player_accounts WHERE player_id = ${pid} AND link_status = 'APPROVED' AND id <> ${id}`;
      if (other) throw new UserError(`Esa ficha ya está vinculada a la cuenta de ${other.name}.`);
      await sql`UPDATE player_accounts SET player_id = ${pid}, link_status = 'APPROVED' WHERE id = ${id}`;
      await audit(sql, user, { entity: "player_account", entityId: id, action: "update", summary: `Cuenta de ${a.name} vinculada a ${pl.first_name} ${pl.last_name}` });
      await createNotification(sql, { orgId: user.orgId, kind: "AUTO", title: "¡Tu cuenta quedó vinculada! ✅", body: "Ya ves tus partidos y te van a llegar los avisos de tus torneos.", url: "/jugadores", audience: "Vínculo aprobado", accountIds: [id] });
      after(deliverPendingSafe);
      return { message: "Vínculo aprobado." };
    }
    if (op === "REJECT" || op === "UNLINK") {
      await sql`UPDATE player_accounts SET player_id = NULL, link_status = 'NONE', link_note = NULL WHERE id = ${id}`;
      await audit(sql, user, { entity: "player_account", entityId: id, action: "update", summary: `Cuenta de ${a.name}: ${op === "REJECT" ? "vínculo rechazado" : "desvinculada"}` });
      return { message: op === "REJECT" ? "Pedido rechazado." : "Cuenta desvinculada." };
    }
    if (op === "DISABLE" || op === "ENABLE") {
      await sql`UPDATE player_accounts SET active = ${op === "ENABLE"} WHERE id = ${id}`;
      if (op === "DISABLE") await sql`DELETE FROM player_sessions WHERE account_id = ${id}`;
      await audit(sql, user, { entity: "player_account", entityId: id, action: "update", summary: `Cuenta de ${a.name} ${op === "ENABLE" ? "habilitada" : "bloqueada"}` });
      return { message: op === "ENABLE" ? "Cuenta habilitada." : "Cuenta bloqueada." };
    }
    throw new UserError("Acción inválida.");
  }, ["/admin/notificaciones"]);
}

export async function deleteAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    masterOnly(user);
    const id = uuid(fd, "account_id");
    const [a] = await sql<{ name: string }[]>`SELECT name FROM player_accounts WHERE id = ${id} AND org_id = ${user.orgId}`;
    if (!a) throw new UserError("Cuenta no encontrada.");
    if (fd.get("__confirm") !== "1") throw new NeedsConfirmation("Eliminar cuenta de jugador", [`Se elimina la cuenta de ${a.name} (no su ficha de jugador ni sus resultados).`]);
    await sql`DELETE FROM player_accounts WHERE id = ${id}`;
    await audit(sql, user, { entity: "player_account", entityId: id, action: "delete", summary: `Cuenta de jugador ${a.name} eliminada` });
    return { message: "Cuenta eliminada." };
  }, ["/admin/notificaciones"]);
}

/** El jugador borra su propia cuenta. */
export async function playerDeleteSelfAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runPlayer(async (p) => {
    if (str(fd, "confirm").toUpperCase() !== "BORRAR") throw new UserError("Escribí BORRAR para confirmar.");
    await sql`DELETE FROM player_accounts WHERE id = ${p.id}`;
    await logoutPlayer();
    return { message: "Tu cuenta fue eliminada.", redirectTo: "/jugadores" };
  });
}
