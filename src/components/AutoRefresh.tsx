"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Actualización automática: consulta cada `seconds` si hubo cambios en el torneo
 * y, si los hubo, refresca la página sin recargarla. Se pausa si la pestaña no está visible.
 */
export function AutoRefresh({ tournamentId, seconds = 15 }: { tournamentId: string; seconds?: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/public/version?t=${tournamentId}`, { cache: "no-store" });
        if (!r.ok) { setLive(false); return; }
        const { v } = (await r.json()) as { v: string };
        setLive(true);
        if (last.current && last.current !== v && !stop) router.refresh();
        last.current = v;
      } catch {
        setLive(false);
      }
    };
    tick();
    const id = setInterval(tick, seconds * 1000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [tournamentId, seconds, router]);

  return (
    <span className={`badge ${live ? "ok" : ""}`} title="La página se actualiza sola cuando hay resultados u horarios nuevos">
      <span className={`dot ${live ? "ok" : "idle"}`} /> {live ? "En vivo" : "Sin conexión"}
    </span>
  );
}
