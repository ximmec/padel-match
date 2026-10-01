import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { loadTournamentSchedule } from "@/server/schedule";
import { ResultForm } from "@/components/ResultForm";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Forbidden } from "@/components/views";
import { setInPlayAction } from "@/server/actions/competition";
import { scoreText } from "@/core/scoring";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Cargar resultados" };

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ t?: string; f?: string; c?: string }> }) {
  const u = await requireUser();
  if (!can(u, "results.enter")) return <Forbidden />;
  const sp = await searchParams;
  const tournaments = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM tournaments WHERE org_id = ${u.orgId} AND status IN ('OPEN','IN_PROGRESS') ORDER BY start_date`;
  const tId = sp.t && isUuid(sp.t) ? sp.t : tournaments[0]?.id;
  if (!tId) return <div className="card empty">No hay torneos activos. <Link href="/admin/tournaments/new">Crear torneo</Link></div>;
  const s = await loadTournamentSchedule(sql, tId, u.orgId);
  const filter = sp.f ?? "pending";
  const cat = sp.c && isUuid(sp.c) ? sp.c : null;

  const items = s.items
    .filter((i) => (cat ? i.tcId === cat : true))
    .filter((i) => {
      const ready = i.sideA !== "A definir" && i.sideB !== "A definir";
      if (filter === "pending") return ready && (i.status === "PENDING" || i.status === "IN_PLAY");
      if (filter === "live") return i.status === "IN_PLAY";
      if (filter === "done") return i.status === "PLAYED";
      return true;
    })
    .sort((a, b) => {
      if (filter === "done") return 0;
      const live = (x: typeof a) => (x.status === "IN_PLAY" ? 0 : 1);
      return live(a) - live(b) || (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || a.priority - b.priority;
    });

  const lcBy = new Map(s.categories.map((c) => [c.tc.id, c]));
  const href = (f: string, c: string | null = cat) => `?${new URLSearchParams({ t: tId, f, ...(c ? { c } : {}) })}`;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>⚡ Resultados</h1>
        <form className="row">
          <select name="t" defaultValue={tId} className="sm">{tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button className="btn sm">Ver</button>
        </form>
      </div>
      <div className="chips">
        <Link href={href("pending")} className={filter === "pending" ? "active" : ""}>Por jugar</Link>
        <Link href={href("live")} className={filter === "live" ? "active" : ""}>En juego</Link>
        <Link href={href("done")} className={filter === "done" ? "active" : ""}>Finalizados</Link>
        <span style={{ width: 12 }} />
        <Link href={href(filter, null)} className={!cat ? "active" : ""}>Todas</Link>
        {s.categories.map((c) => <Link key={c.tc.id} href={href(filter, c.tc.id)} className={cat === c.tc.id ? "active" : ""}>{c.tc.category_name}</Link>)}
      </div>
      <div className="grid grid-2">
        {items.map((i) => {
          const lc = lcBy.get(i.tcId)!;
          const m = lc.matches.find((x) => x.id === i.matchId)!;
          return (
            <div key={i.matchId} id={`m-${i.matchId}`} className="quick-match">
              <div className="row between" style={{ marginBottom: 6 }}>
                <div className="row">
                  <span className="badge">{i.categoryName}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{i.stage}</span>
                  {i.status === "IN_PLAY" && <span className="badge live">En juego</span>}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{i.start ? fmtDateTime(i.start) : "Sin horario"}{i.courtId ? ` · ${s.courts.find((c) => c.id === i.courtId)?.name ?? ""}` : ""}</span>
              </div>
              {i.status === "PLAYED" && m.outcome && <div className="alert ok" style={{ margin: "0 0 8px" }}>Resultado actual: <b>{scoreText(m.outcome)}</b></div>}
              <ResultForm matchId={i.matchId} version={i.version} sideA={i.sideA} sideB={i.sideB} maxSets={lc.rules.format.setsToWin * 2 - 1} current={i.status === "PLAYED" ? m.outcome : null} />
              {i.status !== "PLAYED" && (
                <ActionForm action={setInPlayAction} hideSuccess>
                  <input type="hidden" name="match_id" value={i.matchId} />
                  <input type="hidden" name="in_play" value={i.status === "IN_PLAY" ? "0" : "1"} />
                  <Submit className="link-btn" pendingText="…">{i.status === "IN_PLAY" ? "Quitar «en juego»" : "▶ Marcar en juego"}</Submit>
                </ActionForm>
              )}
            </div>
          );
        })}
      </div>
      {items.length === 0 && <div className="card empty">No hay partidos en esta lista.</div>}
    </div>
  );
}
