"use client";
import { createContext, useContext } from "react";
import { dict, type Lang } from "./index";

const LangCtx = createContext<Lang>("es");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}
/** Idioma actual en componentes del navegador (sin proveedor: español, como el panel). */
export function useLang(): Lang {
  return useContext(LangCtx);
}
export function useT() {
  return dict(useContext(LangCtx));
}
