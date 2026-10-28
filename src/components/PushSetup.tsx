"use client";
import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription, sendTestToMe } from "@/server/actions/jugadores";
import { InstallApp } from "@/components/InstallApp";
import { useT } from "@/i18n/client";

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
  const P = useT().push;

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
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? P.errEnable }); return; }
      setState("on");
      setMsg({ ok: true, text: P.okEnabled });
    } catch {
      setMsg({ ok: false, text: P.errEnable });
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
      if (!r.ok) setMsg({ ok: false, text: r.error ?? P.errSend });
      else if (r.result === "sent") setMsg({ ok: true, text: P.okTest });
      else setMsg({ ok: false, text: P.noDevice });
    } finally { setBusy(false); }
  };

  return (
    <div className="push-box">
      <div className="push-head">
        <span className="push-ico">🔔</span>
        <div>
          <b>{P.title} {state === "on" ? <span className="push-pill on">{P.on}</span> : state !== "loading" ? <span className="push-pill">{P.off}</span> : null}</b>
          <small>
            {state === "on" ? P.sOn : state === "off" ? P.sOff : state === "denied" ? P.sDenied : state === "ios-install" ? P.sIos : state === "unsupported" ? P.sUnsupported : P.checking}
          </small>
        </div>
      </div>
      <div className="row">
        {state === "off" && <button className="btn primary" onClick={enable} disabled={busy}>{busy ? P.enabling : P.enable}</button>}
        {state === "on" && <>
          <button className="btn ghost sm" onClick={test} disabled={busy}>{P.test}</button>
          <button className="btn ghost sm" onClick={disable} disabled={busy}>{P.disable}</button>
        </>}
      </div>
      {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      <InstallApp variant="card" />
    </div>
  );
}
