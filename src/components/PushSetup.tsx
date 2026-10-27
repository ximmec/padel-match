"use client";
import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription, sendTestToMe } from "@/server/actions/jugadores";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlB64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Botón «Activar notificaciones» + instrucciones para instalar la app (sobre todo en iPhone). */
export function PushSetup({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) { setState(isIos() && !isStandalone() ? "ios-install" : "unsupported"); return; }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const sub = await reg.pushManager.getSubscription();
        if (Notification.permission === "denied") setState("denied");
        else if (sub) {
          setState("on");
          // Por si la suscripción cambió: la volvemos a guardar
          savePushSubscription(JSON.stringify(sub), navigator.userAgent).catch(() => {});
        } else setState("off");
      } catch { setState("unsupported"); }
    })();
  }, []);

  const enable = async () => {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapidKey) }));
      const r = await savePushSubscription(JSON.stringify(sub), navigator.userAgent);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "No se pudo activar." }); return; }
      setState("on");
      setMsg({ ok: true, text: "¡Listo! Ya te pueden llegar avisos a este dispositivo." });
    } catch {
      setMsg({ ok: false, text: "No se pudo activar en este dispositivo. Probá de nuevo." });
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
      setState("off");
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await sendTestToMe();
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "No se pudo enviar." });
      else if (r.result === "sent") setMsg({ ok: true, text: "Te mandamos una notificación de prueba. Si no la ves, revisá que el celular no esté en «No molestar»." });
      else setMsg({ ok: false, text: "No encontramos este dispositivo. Desactivá y volvé a activar las notificaciones." });
    } finally { setBusy(false); }
  };

  return (
    <div className="push-box">
      <div className="push-head">
        <span className="push-ico">🔔</span>
        <div>
          <b>Notificaciones en este dispositivo</b>
          <small>
            {state === "on" ? "Activadas: te llegan los avisos de la organización y de tus partidos."
              : state === "off" ? "Activalas para recibir avisos aunque no tengas la app abierta."
              : state === "denied" ? "Las bloqueaste en este navegador. Para activarlas, habilitá las notificaciones de padel-match.net en los ajustes del navegador o del celular."
              : state === "ios-install" ? "En iPhone, primero instalá la app en tu pantalla de inicio (te explicamos cómo abajo)."
              : state === "unsupported" ? "Este navegador no permite notificaciones. Probá con Chrome (Android) o instalando la app en el iPhone."
              : "Revisando…"}
          </small>
        </div>
      </div>
      <div className="row">
        {state === "off" && <button className="btn primary" onClick={enable} disabled={busy}>{busy ? "Activando…" : "Activar notificaciones"}</button>}
        {state === "on" && <>
          <button className="btn ghost sm" onClick={test} disabled={busy}>Enviarme una prueba</button>
          <button className="btn ghost sm" onClick={disable} disabled={busy}>Desactivar</button>
        </>}
      </div>
      {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      <InstallHelp />
    </div>
  );
}

/** Cómo instalar la app en el celular (si todavía no está instalada). */
export function InstallHelp() {
  const [show, setShow] = useState<"ios" | "android" | null>(null);
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  useEffect(() => {
    if (isStandalone()) return;
    setShow(isIos() ? "ios" : "android");
    const h = (e: Event) => { e.preventDefault(); setPrompt(e as Event & { prompt: () => Promise<void> }); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (!show) return null;
  return (
    <div className="install-help">
      <b>📲 Instalá Padel Match en tu celular</b>
      {show === "ios" ? (
        <ol>
          <li>Abrí esta página en <b>Safari</b>.</li>
          <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li>
          <li>Elegí <b>«Agregar a pantalla de inicio»</b> y después <b>Agregar</b>.</li>
          <li>Abrí Padel Match desde el ícono nuevo y tocá <b>Activar notificaciones</b>.</li>
        </ol>
      ) : prompt ? (
        <button className="btn sm" onClick={() => prompt.prompt()}>Instalar la app</button>
      ) : (
        <ol>
          <li>En Chrome, tocá el menú <b>⋮</b> (arriba a la derecha).</li>
          <li>Elegí <b>«Instalar app»</b> o <b>«Agregar a pantalla principal»</b>.</li>
        </ol>
      )}
    </div>
  );
}
