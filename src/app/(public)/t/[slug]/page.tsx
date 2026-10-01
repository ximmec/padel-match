import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/server/db";
import { publicTournamentBySlug, publicTournamentCategories } from "@/server/publicData";
import { loadTournamentSchedule } from "@/server/schedule";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StatusBadge } from "@/components/views";
import { scoreText } from "@/core/scoring";
import { fmtDate, fmtDay, fmtTime, dayKey } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const t = await publicTournamentBySlug((await params).slug);
  return { title: t?.name ?? "Torneo" };
}

export default async function PublicTournament({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await publicTournamentBySlug(slug);
  if (!t) notFound();
  const [cats, s] = await Promise.all([publicTournamentCategories(t.id), loadTournamentSchedule(sql, t.id, null)]);
  const court = (id: string | null) => s.courts.find((c) => c.id === id)?.name ?? "";
  const lcBy = new Map(s.categories.map((c) => [c.tc.id, c]));
  const live = s.items.filter((i) => i.status === "IN_PLAY");
  const upcoming = s.items.filter((i) => i.status === "PENDING" && i.start).sort((a, b) => a.start!.getTime() - b.start!.getTime());
  const byDay = new Map<string, typeof upcoming>();
  for (const i of upcoming) { const k = dayKey(i.start!); byDay.set(k, [...(byDay.get(k) ?? []), i]); }
  const recent = s.items.filter((i) => i.status === "PLAYED").sort((a, b) => {
    const ma = lcBy.get(a.tcId)!.matches.find((m) => m.id === a.matchId)!.updated_at.getTime();
    const mb = lcBy.get(b.tcId)!.matches.find((m) => m.id === b.matchId)!.updated_at.getTime();
    return mb - ma;
  }).slice(0, 12);
  const outcome = (i: (typeof s.items)[number]) => lcBy.get(i.tcId)!.matches.find((m) => m.id === i.matchId)?.outcome ?? null;

  return (
    <>
      <section className="hero">
        <div className="inner">
          <div className="row"><StatusBadge status={t.status} /><AutoRefresh tournamentId={t.id} /></div>
          <h1 style={{ marginTop: 8 }}>{t.name}</h1>
          <p>{fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` al ${fmtDate(t.end_date)}` : ""}{t.venue ? ` · ${t.venue}` : ""}{t.address ? ` (${t.address})` : ""} · {t.org_name}</p>
        </div>
      </section>
      <main className="container stack">
        <div className="chips">
          {cats.map((c) => <Link key={c.id} href={`/t/${slug}/c/${c.id}`}>{c.name} <span className="muted">({c.entries})</span></Link>)}
        </div>
        <form action="/buscar" className="row">
          <input name="q" placeholder="Buscá tu nombre para ver tus partidos" style={{ maxWidth: 360 }} />
          <input type="hidden" name="t" value={t.id} />
          <button className="btn">Buscar</button>
        </form>

        {live.length > 0 && (
          <div className="card flush">
            <div className="card-head"><h2>🔴 Jugándose ahora</h2></div>
            {live.map((i) => (
              <div key={i.matchId} className="match">
                <div><div className="side">{i.sideA}</div><div className="side">{i.sideB}</div></div>
                <span className="badge live">En juego</span>
                <div className="meta"><span className="badge">{i.categoryName}</span><span>{i.stage}</span>{i.courtId && <span>📍 {court(i.courtId)}</span>}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-2">
          <div className="card flush">
            <div className="card-head"><h2>Próximos partidos</h2></div>
            {[...byDay.entries()].map(([k, items]) => (
              <div key={k}>
                <div style={{ padding: "8px 12px", background: "#f8fafc", fontWeight: 700, fontSize: 13, textTransform: "capitalize" }}>{fmtDay(items[0].start)}</div>
                {items.slice(0, 60).map((i) => (
                  <div key={i.matchId} className="match">
                    <div><div className="side">{i.sideA}</div><div className="side">{i.sideB}</div></div>
                    <div style={{ textAlign: "right" }}><b style={{ fontSize: 18 }}>{fmtTime(i.start)}</b><div className="muted" style={{ fontSize: 12 }}>{court(i.courtId)}</div></div>
                    <div className="meta"><span className="badge">{i.categoryName}</span><span>{i.stage}</span></div>
                  </div>
                ))}
              </div>
            ))}
            {upcoming.length === 0 && <div className="empty">No hay partidos programados por ahora.</div>}
          </div>
          <div className="card flush">
            <div className="card-head"><h2>Últimos resultados</h2></div>
            {recent.map((i) => {
              const o = outcome(i);
              const sum = lcBy.get(i.tcId)!.view.summaries;
              const m = lcBy.get(i.tcId)!.matches.find((x) => x.id === i.matchId)!;
              const w = sum.get(m.phase === "ZONE" ? m.id : `B:${m.bracket_code}`)?.winner;
              return (
                <div key={i.matchId} className="match">
                  <div><div className={`side ${w === "A" ? "win" : "lose"}`}>{i.sideA}</div><div className={`side ${w === "B" ? "win" : "lose"}`}>{i.sideB}</div></div>
                  <b>{o ? scoreText(o) : ""}</b>
                  <div className="meta"><span className="badge">{i.categoryName}</span><span>{i.stage}</span></div>
                </div>
              );
            })}
            {recent.length === 0 && <div className="empty">Todavía no hay resultados.</div>}
          </div>
        </div>
        {t.rules_text && <div className="card"><h2>Información</h2><p style={{ whiteSpace: "pre-wrap" }}>{t.rules_text}</p></div>}
      </main>
    </>
  );
}
