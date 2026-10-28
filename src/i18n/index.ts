import { es, type Dict } from "./es";
import { en } from "./en";

export type Lang = "es" | "en";
export type { Dict };
export const LANG_COOKIE = "lang";
export const dicts: Record<Lang, Dict> = { es, en };
export const isLang = (x: unknown): x is Lang => x === "es" || x === "en";
export function dict(lang: Lang | null | undefined): Dict {
  return dicts[lang === "en" ? "en" : "es"];
}
/** Idioma por el encabezado del navegador: español si el primero es español; si no, inglés. */
export function langFromAcceptLanguage(h: string | null | undefined): Lang {
  const first = (h ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return "es";
  return first.startsWith("es") ? "es" : "en";
}
