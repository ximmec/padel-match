"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLangAction } from "@/server/actions/lang";
import { useLang } from "@/i18n/client";
import type { Lang } from "@/i18n";

/** Selector de idioma 🇪🇸 / 🇬🇧: cambia en el momento y queda recordado. */
export function LangSwitch() {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (l: Lang) => {
    if (l === lang) return;
    start(async () => { await setLangAction(l); router.refresh(); });
  };
  return (
    <div className={`lang-switch ${pending ? "busy" : ""}`} role="group" aria-label="Idioma / Language">
      <button type="button" className={lang === "es" ? "on" : ""} onClick={() => pick("es")} aria-pressed={lang === "es"} title="Español">🇪🇸 <span>ES</span></button>
      <button type="button" className={lang === "en" ? "on" : ""} onClick={() => pick("en")} aria-pressed={lang === "en"} title="English">🇬🇧 <span>EN</span></button>
    </div>
  );
}
