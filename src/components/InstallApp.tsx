"use client";
import { useEffect, useState } from "react";

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
  if (env.standalone) return variant === "card" ? <div className="install-ok">✅ {APP_NAME} está instalada en este celular.</div> : null;
  if (env.platform === "desktop" && !autoOpen) return variant === "card" ? <div className="install-desk">📲 Para instalar la app, abrí <b>padel-match.net/app</b> desde tu celular.</div> : null;

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
        <span><b>Instalar Padel-Match</b><small>{done ? `¡Listo! Buscá «${APP_NAME}» en tu pantalla de inicio` : "Gratis · sin App Store ni Play Store · recibí los avisos de tus partidos"}</small></span>
      </button>
      {open && <InstallGuide env={env} onClose={() => setOpen(false)} />}
    </>
  );
}

function CopyLink() {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn primary block" onClick={async () => {
      try { await navigator.clipboard.writeText(SHARE_URL); setOk(true); } catch { window.prompt("Copiá este enlace:", SHARE_URL); }
    }}>{ok ? "✓ Enlace copiado" : "Copiar enlace"}</button>
  );
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
);
const PlusSquare = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
);
const Dots = () => <span className="g-dots" aria-hidden>⋮</span>;

function InstallGuide({ env, onClose }: { env: ReturnType<typeof detect>; onClose: () => void }) {
  return (
    <div className="install-modal" role="dialog" aria-modal="true" aria-label="Cómo instalar la app" onClick={onClose}>
      <div className="install-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="install-sheet-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={56} height={56} />
          <div><b>Instalá {APP_NAME}</b><small>Va a aparecer en tu pantalla de inicio como una app más.</small></div>
          <button type="button" className="install-x" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {env.inApp ? (
          <div className="stack">
            <div className="alert warn">Abriste el enlace desde otra app (Instagram, Facebook, WhatsApp…). Desde acá <b>no se puede instalar</b>.</div>
            <ol className="g-steps">
              <li><span className="g-n">1</span><div>Tocá <b>⋮</b> o <b>···</b> (arriba a la derecha) y elegí <b>«Abrir en {env.platform === "ios" ? "Safari" : "Chrome"}»</b>.</div></li>
              <li><span className="g-n">2</span><div>O copiá el enlace y pegalo en {env.platform === "ios" ? "Safari" : "Chrome"}:</div></li>
            </ol>
            <CopyLink />
          </div>
        ) : env.platform === "ios" ? (
          <div className="stack">
            {env.iosOtherBrowser && <div className="alert warn">Para que te lleguen las notificaciones, hacelo desde <b>Safari</b>. Copiá el enlace y pegalo en Safari. <CopyLink /></div>}
            <ol className="g-steps">
              <li><span className="g-n">1</span><div>Tocá el botón <b>Compartir</b> <span className="g-key"><ShareIcon /></span><small>Está abajo en el medio (o arriba a la derecha en iPad). Si no lo ves, deslizá la página un poco hacia arriba.</small></div></li>
              <li><span className="g-n">2</span><div>Bajá y tocá <b>«Agregar a pantalla de inicio»</b>
                <div className="g-mock"><span>Agregar a pantalla de inicio</span><PlusSquare /></div>
                <small>Si no aparece, tocá «Editar acciones» al final de la lista y agregalo.</small></div></li>
              <li><span className="g-n">3</span><div>Tocá <b>«Agregar»</b> (arriba a la derecha)
                <div className="g-mock g-mock-add">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon-192.png" alt="" width={34} height={34} /><span>{APP_NAME}</span><b>Agregar</b>
                </div></div></li>
              <li><span className="g-n">4</span><div>Abrí <b>{APP_NAME}</b> desde el ícono nuevo, ingresá y tocá <b>«Activar notificaciones»</b>.<small>En iPhone las notificaciones solo funcionan abriendo la app desde el ícono (iOS 16.4 o más nuevo).</small></div></li>
            </ol>
            <div className="g-arrow" aria-hidden>⬇︎ El botón Compartir está acá abajo ⬇︎</div>
          </div>
        ) : env.platform === "android" ? (
          <div className="stack">
            <ol className="g-steps">
              <li><span className="g-n">1</span><div>Abrí esta página en <b>Google Chrome</b>.</div></li>
              <li><span className="g-n">2</span><div>Tocá el menú <span className="g-key"><Dots /></span> (arriba a la derecha).</div></li>
              <li><span className="g-n">3</span><div>Tocá <b>«Instalar app»</b> o <b>«Agregar a pantalla principal»</b>
                <div className="g-mock"><span>Instalar app</span><PlusSquare /></div></div></li>
              <li><span className="g-n">4</span><div>Confirmá con <b>«Instalar»</b>. Después abrí <b>{APP_NAME}</b> desde el ícono y tocá <b>«Activar notificaciones»</b>.</div></li>
            </ol>
          </div>
        ) : (
          <div className="stack">
            <p>Abrí este enlace desde tu <b>celular</b> para instalar la app:</p>
            <div className="g-link">{SHARE_URL.replace("https://", "")}</div>
            <CopyLink />
          </div>
        )}
        <button type="button" className="btn ghost block" style={{ marginTop: 14 }} onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}
