import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "./auth";
import { friendlyDbError, UserError } from "./db";
import type { Permission } from "./permissions";
import { ScoreError } from "@/core/scoring";
import { ZoneError } from "@/core/zones";
import { BracketError } from "@/core/bracket";

/** Estado devuelto por las Server Actions a los formularios. */
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** La acción requiere confirmación: se muestra el impacto y un botón "Confirmar". */
  confirm?: { title: string; items: string[] };
  /** Redirección del lado del cliente tras el éxito. */
  redirectTo?: string;
  /** Marca de tiempo para que el formulario sepa que hubo una respuesta nueva. */
  at?: number;
}

export class NeedsConfirmation extends Error {
  constructor(public title: string, public items: string[]) { super(title); }
}

export function isConfirmed(fd: FormData) {
  return fd.get("__confirm") === "1";
}

/**
 * Envuelve una Server Action: verifica sesión y permiso, captura errores y
 * los traduce a mensajes para el usuario.
 */
export async function runAction(
  perm: Permission | null,
  fn: (user: CurrentUser) => Promise<ActionState | void>,
  revalidate: string[] = [],
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Tu sesión expiró. Volvé a iniciar sesión.", at: Date.now() };
  if (perm && !user.permissions.has(perm)) return { error: "No tenés permiso para esta acción.", at: Date.now() };
  try {
    const r = (await fn(user)) ?? {};
    for (const p of revalidate) revalidatePath(p, "layout");
    return { ok: true, ...r, at: Date.now() };
  } catch (e) {
    if (e instanceof NeedsConfirmation) return { confirm: { title: e.title, items: e.items }, at: Date.now() };
    if (e instanceof UserError || e instanceof ScoreError || e instanceof ZoneError || e instanceof BracketError) return { error: e.message, at: Date.now() };
    return { error: friendlyDbError(e), at: Date.now() };
  }
}

export function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(fd: FormData, k: string): string | null {
  const v = str(fd, k);
  return v === "" ? null : v;
}

export function int(fd: FormData, k: string, def: number | null = null): number | null {
  const v = str(fd, k);
  if (v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError(`El campo "${k}" debe ser un número entero.`);
  return n;
}

export function req(fd: FormData, k: string, label: string): string {
  const v = str(fd, k);
  if (!v) throw new UserError(`Completá ${label}.`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(fd: FormData | string, k?: string): string {
  const v = typeof fd === "string" ? fd : str(fd, k!);
  if (!UUID.test(v)) throw new UserError("Identificador inválido.");
  return v;
}
export function isUuid(v: string) { return UUID.test(v); }
