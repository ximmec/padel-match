"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { markAdminAlertsSeenAction } from "@/server/actions/jugadores";

type Item = { id: string; kind: "REGISTER" | "LINK"; title: string; detail: string | null; created_at: string | Date; unread: boolean };

function ago(d: string | Date) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const days = Math.floor(s / 86400);
  return days === 1 ? "ayer" : `hace ${days} días`;
}

/** Campanita del panel: jugadores que se registraron en Mi Padel Match o pidieron vincular su ficha. */
export function AdminBell({ initial }: { initial: { unread: number; items: Item[] } }) {
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/admin/alertas", { cache: "no-store" });
        if (r.ok) setData(await r.json());
      } catch { /* sin conexión: se reintenta */ }
    };
    const id = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", load); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && data.unread > 0) {
      markAdminAlertsSeenAction().catch(() => {});
      // Se ven resaltados los nuevos mientras la lista está abierta; el número se va
      setData((d) => ({ ...d, unread: 0 }));
    }
    if (!next) setData((d) => ({ ...d, items: d.items.map((i) => ({ ...i, unread: false })) }));
  };

  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-btn" onClick={toggle} aria-label={data.unread ? `${data.unread} avisos nuevos` : "Avisos"} aria-expanded={open}>
        <Icon name="bell" size={22} />
        {data.unread > 0 && <span className="bell-n">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-pop">
          <div className="bell-head"><b>Avisos</b><small>Jugadores de Mi Padel Match</small></div>
          <div className="bell-list">
            {data.items.length === 0 && <div className="bell-empty">Todavía no hay avisos. Cuando un jugador se registre en Mi Padel Match, te va a aparecer acá.</div>}
            {data.items.map((i) => (
              <Link key={i.id} href="/admin/notificaciones?tab=jugadores" className={`bell-item ${i.unread ? "new" : ""}`} onClick={() => setOpen(false)}>
                <span className="bell-ico">{i.kind === "REGISTER" ? "🆕" : "🔗"}</span>
                <span><b>{i.title}</b>{i.detail && <small>{i.detail}</small>}<em>{ago(i.created_at)}</em></span>
              </Link>
            ))}
          </div>
          <Link href="/admin/notificaciones?tab=jugadores" className="bell-all" onClick={() => setOpen(false)}>Ver todos los jugadores registrados →</Link>
        </div>
      )}
    </div>
  );
}
