"use client";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import type { Dict } from "@/i18n";

type Platform = "ios" | "android" | "desktop";
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const APP_NAME = "BlokoPadel";
const SHARE_URL = "https://padel-match.net/app";

// El aviso de instalación de Android llega una sola vez: se guarda para cualquier botón de la página.
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as PromptEvent; listeners.forEach((l) => l()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((l) => l()); });
}

function detect() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  // Navegadores internos de Instagram, Facebook, TikTok, etc. (desde ahí no se puede instalar)
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(ua);
  const iosOtherBrowser = ios && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const platform: Platform = ios ? "ios" : android ? "android" : "desktop";
  return { platform, standalone, inApp, iosOtherBrowser };
}

/**
 * Botón «Instalar Padel-Match»: en Android instala con un toque (si el navegador lo permite);
 * en iPhone muestra la guía con dibujos para «Agregar a pantalla de inicio».
 */
export function InstallApp({ variant = "card", autoOpen = false }: { variant?: "hero" | "card"; autoOpen?: boolean }) {
  const [env, setEnv] = useState<ReturnType<typeof detect> | null>(null);
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const T = useT();
  const I = T.install;

  useEffect(() => {
    const d = detect();
    setEnv(d);
    const l = () => force((x) => x + 1);
    listeners.add(l);
    if (autoOpen && !d.standalone) setOpen(true);
    const inst = () => setDone(true);
    window.addEventListener("appinstalled", inst);
    return () => { listeners.delete(l); window.removeEventListener("appinstalled", inst); };
  }, [autoOpen]);

  if (!env) return null;
  if (env.standalone) return variant === "card" ? <div className="install-ok">{I.installed(APP_NAME)}</div> : null;
  if (env.platform === "desktop" && !autoOpen) return variant === "card" ? <div className="install-desk">{I.desk1}<b>padel-match.net/app</b>{I.desk2}</div> : null;

  const click = async () => {
    if (env.platform === "android" && deferred && !env.inApp) {
      await deferred.prompt();
      const r = await deferred.userChoice.catch(() => null);
      if (r?.outcome === "accepted") { setDone(true); return; }
    }
    setOpen(true);
  };

  return (
    <>
      <button type="button" className={`install-btn ${variant}`} onClick={click}>
        <span className="install-ico" aria-hidden>📲</span>
        <span><b>{I.btn}</b><small>{done ? I.done(APP_NAME) : I.sub}</small></span>
      </button>
      {open && <InstallGuide env={env} onClose={() => setOpen(false)} t={T} />}
    </>
  );
}

function CopyLink() {
  const [ok, setOk] = useState(false);
  const I = useT().install;
  return (
    <button type="button" className="btn primary block" onClick={async () => {
      try { await navigator.clipboard.writeText(SHARE_URL); setOk(true); } catch { window.prompt(I.copyPrompt, SHARE_URL); }
    }}>{ok ? I.copied : I.copy}</button>
  );
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
);
const PlusSquare = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
);
const Dots = () => <span className="g-dots" aria-hidden>⋮</span>;

function InstallGuide({ env, onClose, t }: { env: ReturnType<typeof detect>; onClose: () => void; t: Dict }) {
  const I = t.install;
  const browser = env.platform === "ios" ? "Safari" : "Chrome";
  return (
    <div className="install-modal" role="dialog" aria-modal="true" aria-label={I.title(APP_NAME)} onClick={onClose}>
      <div className="install-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="install-sheet-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={56} height={56} />
          <div><b>{I.title(APP_NAME)}</b><small>{I.subtitle}</small></div>
          <button type="button" className="install-x" onClick={onClose} aria-label={I.close}>✕</button>
        </div>

        {env.inApp ? (
          <div className="stack">
            <div className="alert warn">{I.inApp1}<b>{I.inAppB}</b>{I.inApp2}</div>
            <ol className="g-steps">
              <li><span className="g-n">1</span><div>{I.inAppS1(browser)}</div></li>
              <li><span className="g-n">2</span><div>{I.inAppS2(browser)}</div></li>
            </ol>
            <CopyLink />
          </div>
        ) : env.platform === "ios" ? (
          <div className="stack">
            {env.iosOtherBrowser && <div className="alert warn">{I.iosOther} <CopyLink /></div>}
            <ol className="g-steps">
              <li><span className="g-n">1</span><div><b>{I.ios1}</b> <span className="g-key"><ShareIcon /></span><small>{I.ios1s}</small></div></li>
              <li><span className="g-n">2</span><div><b>{I.ios2}</b>
                <div className="g-mock"><span>{I.ios2mock}</span><PlusSquare /></div>
                <small>{I.ios2s}</small></div></li>
              <li><span className="g-n">3</span><div><b>{I.ios3}</b>
                <div className="g-mock g-mock-add">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon-192.png" alt="" width={34} height={34} /><span>{APP_NAME}</span><b>{I.ios3mock}</b>
                </div></div></li>
              <li><span className="g-n">4</span><div><b>{I.ios4(APP_NAME)}</b><small>{I.ios4s}</small></div></li>
            </ol>
            <div className="g-arrow" aria-hidden>{I.arrow}</div>
          </div>
        ) : env.platform === "android" ? (
          <div className="stack">
            <ol className="g-steps">
              <li><span className="g-n">1</span><div>{I.and1}</div></li>
              <li><span className="g-n">2</span><div>{I.and2} <span className="g-key"><Dots /></span></div></li>
              <li><span className="g-n">3</span><div><b>{I.and3}</b>
                <div className="g-mock"><span>{I.and3mock}</span><PlusSquare /></div></div></li>
              <li><span className="g-n">4</span><div>{I.and4(APP_NAME)}</div></li>
            </ol>
          </div>
        ) : (
          <div className="stack">
            <p>{I.deskOpen}</p>
            <div className="g-link">{SHARE_URL.replace("https://", "")}</div>
            <CopyLink />
          </div>
        )}
        <button type="button" className="btn ghost block" style={{ marginTop: 14 }} onClick={onClose}>{I.ok}</button>
      </div>
    </div>
  );
}
