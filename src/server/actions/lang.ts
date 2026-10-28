"use server";
import { cookies } from "next/headers";
import { sql } from "../db";
import { getCurrentPlayer } from "../playerAuth";
import { isLang, LANG_COOKIE, type Lang } from "@/i18n";

/** Guarda el idioma (un año en el navegador/app y, si es un jugador con cuenta, en su cuenta). */
export async function setLangAction(lang: Lang) {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  const p = await getCurrentPlayer();
  if (p) await sql`UPDATE player_accounts SET lang = ${lang} WHERE id = ${p.id}`;
}
