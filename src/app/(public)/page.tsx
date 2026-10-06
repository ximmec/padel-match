import Link from "next/link";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { fmtDate } from "@/lib/format";

type Row = { id: string; name: string; slug: string; start_date: string; end_date: string; status: string; venue: string | null; org_name: string; categories: string | null; entries: number };

function TournamentCard({ t }: { t: Row }) {
  const cats = (t.categories ?? "").split(" · ").filter(Boolean);
  return (
    <Link href={`/t/${t.slug}`} className="tcard">
      <div className="card stack" style={{ display: "flex", flexDirection: "column" }}>
        <div className="row between">
          <StatusBadge status={t.status} />
          <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>📅 {fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` – ${fmtDate(t.end_date)}` : ""}</span>
        </div>
        <h2 style={{ margin: 0, fontSize: 24 }}>{t.name}</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          {t.venue && <div>📍 {t.venue}</div>}
          <div>🏆 {t.org_name}</div>
        </div>
        {cats.length > 0 && <div className="row" style={{ gap: 6 }}>{cats.map((c) => <span key={c} className="badge">{c}</span>)}</div>}
        <div className="row between" style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <span><b style={{ fontFamily: "var(--font-head)", fontStyle: "italic", fontSize: 22 }}>{t.entries}</b> <span className="muted">parejas</span></span>
          <span className="btn sm primary">Ver detalle →</span>
        </div>
      </div>
    </Link>
  );
}

export default async function Home() {
  const rows = await sql<Row[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.status, v.name AS venue, o.name AS org_name,
      (SELECT string_agg(c.name, ' · ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries
    FROM tournaments t JOIN organizations o ON o.id = t.org_id LEFT JOIN venues v ON v.id = t.venue_id
    WHERE t.is_public AND t.status IN ('OPEN','IN_PROGRESS','FINISHED') AND t.end_date >= (now() - interval '60 days')::date
    ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END, t.start_date`;
  const [stats] = await sql<{ tournaments: number; players: number; played: number }[]>`
    SELECT
      (SELECT count(*)::int FROM tournaments WHERE is_public AND status <> 'DRAFT') AS tournaments,
      (SELECT count(DISTINCT ep.player_id)::int FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE t.is_public) AS players,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE t.is_public AND m.status = 'PLAYED') AS played`;
  const live = rows.filter((t) => t.status === "IN_PROGRESS");
  const upcoming = rows.filter((t) => t.status === "OPEN");
  const past = rows.filter((t) => t.status === "FINISHED");

  const steps = [
    ["01", "Inscripción", "Las parejas se inscriben por categoría: Beginner, Advanced, masculina, femenina o mixta."],
    ["02", "Zonas", "Zonas sorteadas y posiciones que se actualizan solas con cada resultado."],
    ["03", "Playoffs", "Cuadro eliminatorio automático hasta la final, con horarios y canchas."],
    ["04", "Ranking", "Cada jugador suma puntos según la instancia alcanzada, torneo tras torneo."],
  ];

  return (
    <>
      <section className="hero">
        <div className="inner hero-home">
          <div>
            <div className="hero-kicker">Torneos de pádel en vivo</div>
            <h1>Tu torneo, <span className="accent">en tiempo real</span></h1>
            <p style={{ fontSize: 17, maxWidth: 520 }}>Resultados, zonas, cuadros, horarios y ranking. Buscá tu nombre y enterate cuándo y en qué cancha jugás.</p>
            <form action="/buscar" className="search-big">
              <input name="q" placeholder="Tu nombre o apellido…" aria-label="Buscar jugador" />
              <button className="btn primary lg">Buscar</button>
            </form>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 22, maxWidth: 560 }}>
              {[[stats.tournaments, "Torneos"], [stats.players, "Jugadores"], [stats.played, "Partidos jugados"]].map(([n, l]) => (
                <div key={String(l)} className="card stat" style={{ padding: "12px 14px" }}>
                  <div className="n" style={{ fontSize: 32 }}>{n}</div>
                  <div className="l">{l}</div>
                </div>
              ))}
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/logo.webp" alt="PADEL-MATCH.NET" width={420} height={420} />
        </div>
      </section>

      <main className="container stack">
        {live.length > 0 && (
          <>
            <h2 className="section-title"><span className="badge live">En vivo</span> Jugándose ahora</h2>
            <div className="grid grid-3">{live.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <h2 className="section-title">Próximos torneos</h2>
            <div className="grid grid-3">{upcoming.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </>
        )}
        {past.length > 0 && (
          <>
            <h2 className="section-title">Finalizados</h2>
            <div className="grid grid-3">{past.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </>
        )}
        {rows.length === 0 && <div className="card empty">Todavía no hay torneos publicados. ¡Volvé pronto!</div>}

        <h2 className="section-title" style={{ marginTop: 34 }}>Cómo funciona</h2>
        <div className="grid grid-4">
          {steps.map(([n, title, text]) => (
            <div key={n} className="card">
              <div style={{ fontFamily: "var(--font-head)", fontStyle: "italic", fontWeight: 900, fontSize: 40, color: "var(--orange)", lineHeight: 1 }}>{n}</div>
              <h3 style={{ margin: "8px 0 6px" }}>{title}</h3>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>{text}</p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
