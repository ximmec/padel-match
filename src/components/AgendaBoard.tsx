"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMatchAction } from "@/server/actions/competition";
import type { ActionState } from "@/server/action";

export interface AgendaItem {
  id: string;
  title: string;
  sub: string;
  courtId: string | null;
  start: number | null; // ms
  status: string;
  locked: boolean;
  conflict: boolean;
}
export interface AgendaCourt { id: string; name: string; windows: { start: number; end: number }[] }

const STEP = 30 * 60_000;

function fmt(ms: number, tz: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
}
function dayLabel(ms: number, tz: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: tz, weekday: "long", day: "2-digit", month: "2-digit" }).format(ms);
}
function dayKey(ms: number, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}
/** ms → "YYYY-MM-DDTHH:mm" en la zona de la app */
function localInput(ms: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(ms);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

export function AgendaBoard({ courts, items, durationMin, tz, canEdit }: { courts: AgendaCourt[]; items: AgendaItem[]; durationMin: number; tz: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; courtId: string; start: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // Días con disponibilidad o partidos
  const days = useMemo(() => {
    const map = new Map<string, { from: number; to: number }>();
    const add = (s: number, e: number) => {
      const k = dayKey(s, tz);
      const d = map.get(k);
      map.set(k, d ? { from: Math.min(d.from, s), to: Math.max(d.to, e) } : { from: s, to: e });
    };
    for (const c of courts) for (const w of c.windows) add(w.start, w.end);
    for (const i of items) if (i.start) add(i.start, i.start + durationMin * 60_000);
    return [...map.entries()].sort().map(([k, v]) => ({ key: k, from: Math.floor(v.from / STEP) * STEP, to: Math.ceil(v.to / STEP) * STEP }));
  }, [courts, items, durationMin, tz]);

  const [day, setDay] = useState(days[0]?.key ?? "");
  const d = days.find((x) => x.key === day) ?? days[0];

  const doMove = (id: string, courtId: string, startMs: number, confirm: boolean) => {
    const fd = new FormData();
    fd.set("match_id", id);
    fd.set("court_id", courtId);
    fd.set("start", localInput(startMs, tz));
    fd.set("__confirm", confirm ? "1" : "0");
    start(async () => {
      const r = await moveMatchAction({}, fd);
      setMsg(r);
      if (r.confirm) setPendingMove({ id, courtId, start: startMs });
      else { setPendingMove(null); router.refresh(); }
    });
  };

  if (!d) return <div className="empty">Cargá la disponibilidad de canchas para ver la agenda.</div>;
  const rows: number[] = [];
  for (let t = d.from; t < d.to; t += STEP) rows.push(t);
  const span = Math.max(1, Math.round((durationMin * 60_000) / STEP));
  const available = (c: AgendaCourt, t: number) => c.windows.some((w) => t >= w.start && t < w.end);
  const unscheduled = items.filter((i) => !i.start || !i.courtId);

  return (
    <div className="stack">
      <div className="chips">
        {days.map((x) => <a key={x.key} href="#" onClick={(e) => { e.preventDefault(); setDay(x.key); }} className={x.key === d.key ? "active" : ""}>{dayLabel(x.from, tz)}</a>)}
      </div>
      {msg?.error && <div className="alert err">{msg.error}</div>}
      {msg?.ok && <div className="alert ok">{msg.message}</div>}
      {msg?.confirm && pendingMove && (
        <div className="confirm-box">
          <h4>⚠ {msg.confirm.title}</h4>
          <ul>{msg.confirm.items.map((i, k) => <li key={k}>{i}</li>)}</ul>
          <div className="row">
            <button className="btn warn sm" disabled={pending} onClick={() => doMove(pendingMove.id, pendingMove.courtId, pendingMove.start, true)}>Mover igual</button>
            <button className="btn ghost sm" onClick={() => { setPendingMove(null); setMsg(null); }}>Cancelar</button>
          </div>
        </div>
      )}
      {canEdit && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Arrastrá un partido a otra cancha u horario. Si genera un conflicto (jugador ocupado, descanso, cancha no disponible) te lo avisa antes de aplicarlo. Los partidos movidos a mano quedan 🔒 fijos al recalcular.</p>}
      <div className="agenda" style={{ gridTemplateColumns: `64px repeat(${courts.length}, minmax(150px, 1fr))`, gridTemplateRows: `auto repeat(${rows.length}, 34px)`, opacity: pending ? 0.6 : 1 }}>
        <div className="h" style={{ gridColumn: 1, gridRow: 1, left: 0, zIndex: 3 }}>Hora</div>
        {courts.map((c, ci) => <div key={c.id} className="h" style={{ gridColumn: ci + 2, gridRow: 1 }}>{c.name}</div>)}
        {rows.map((t, ri) => (
          <div key={`t${t}`} className="t" style={{ gridColumn: 1, gridRow: ri + 2 }}>{fmt(t, tz)}</div>
        ))}
        {courts.map((c, ci) => rows.map((t, ri) => {
          const key = `${c.id}|${t}`;
          return (
            <div
              key={key}
              className={`cell ${available(c, t) ? "" : "off"} ${over === key ? "drop" : ""}`}
              style={{ gridColumn: ci + 2, gridRow: ri + 2 }}
              onDragOver={canEdit ? (e) => { e.preventDefault(); setOver(key); } : undefined}
              onDragLeave={canEdit ? () => setOver((o) => (o === key ? null : o)) : undefined}
              onDrop={canEdit ? (e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) doMove(id, c.id, t, false); } : undefined}
            />
          );
        }))}
        {items.filter((i) => i.start && i.courtId && dayKey(i.start, tz) === d.key).map((i) => {
          const ci = courts.findIndex((c) => c.id === i.courtId);
          if (ci < 0) return null;
          const ri = Math.floor((i.start! - d.from) / STEP);
          return (
            <div
              key={i.id}
              draggable={canEdit && i.status !== "PLAYED" && i.status !== "IN_PLAY"}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", i.id)}
              className={`slot-item ${i.status === "PLAYED" ? "played" : ""} ${i.status === "IN_PLAY" ? "live" : ""} ${i.conflict ? "conflict" : ""} ${i.locked ? "locked" : ""}`}
              style={{ gridColumn: ci + 2, gridRow: `${ri + 2} / span ${span}`, margin: 2, zIndex: 1 }}
              title={`${i.title}\n${i.sub}`}
            >
              <b>{fmt(i.start!, tz)}</b> · {i.title}<br />{i.sub}
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <div className="card">
          <h3>Sin programar ({unscheduled.length})</h3>
          <div className="row">
            {unscheduled.map((i) => (
              <div key={i.id} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData("text/plain", i.id)} className="badge" style={{ cursor: canEdit ? "grab" : "default", padding: "6px 10px" }}>
                {i.title}: {i.sub}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
