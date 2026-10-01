export const APP_TZ = process.env.NEXT_PUBLIC_APP_TZ || "America/Argentina/Buenos_Aires";
/** Desplazamiento fijo usado al interpretar fechas ingresadas en formularios (Argentina no usa horario de verano). */
export const APP_TZ_OFFSET = process.env.NEXT_PUBLIC_APP_TZ_OFFSET || "-03:00";

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00${APP_TZ_OFFSET}` : d) : d;
  return new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function fmtDay(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, weekday: "short", day: "2-digit", month: "2-digit" }).format(d);
}

export function fmtTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${fmtDay(d)} ${fmtTime(d)}`;
}

/** Fecha → valor para <input type="datetime-local"> en la zona horaria de la app. */
export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")}T${hour}:${g("minute")}`;
}

/** Valor de <input type="datetime-local"> (hora local de la app) → Date. */
export function fromLocalInput(v: string): Date | null {
  if (!v) return null;
  const s = v.length === 16 ? `${v}:00${APP_TZ_OFFSET}` : `${v}${APP_TZ_OFFSET}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" de una fecha en la zona de la app (clave para agrupar por día). */
export function dayKey(d: Date): string {
  return toLocalInput(d).slice(0, 10);
}

export function isoDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  return toLocalInput(d).slice(0, 10);
}

export function playerName(p: { first_name: string; last_name: string }) {
  return `${p.first_name} ${p.last_name}`;
}
