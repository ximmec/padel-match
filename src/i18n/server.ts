import { cookies, headers } from "next/headers";
import { cache } from "react";
import { dict, isLang, langFromAcceptLanguage, LANG_COOKIE, type Lang } from "./index";

/** Idioma elegido (cookie) o, la primera vez, el del navegador/celular. */
export const getLang = cache(async (): Promise<Lang> => {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(c)) return c;
  return langFromAcceptLanguage((await headers()).get("accept-language"));
});

export async function getT() {
  const lang = await getLang();
  return { lang, t: dict(lang) };
}
