import { TournamentCard, type Row } from "@/components/PublicTournamentCard";
import Link from "next/link";
import { sql } from "@/server/db";
import { Icon } from "@/components/Icon";

export default async function Home() {
  const rows = await sql<Row[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.start_time::text AS start_time, t.entry_fee, (SELECT sum(COALESCE(NULLIF(tc.rules->>'maxEntries', '')::int, t.max_entries))::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS max_entries, t.logo, t.card_bg, t.status, v.name AS venue, o.name AS org_name, ci.name AS circuit_name, ci.logo AS circuit_logo,
      (SELECT string_agg(c.name, ' · ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries
    FROM tournaments t JOIN organizations o ON o.id = t.org_id LEFT JOIN venues v ON v.id = t.venue_id LEFT JOIN circuits ci ON ci.id = t.circuit_id
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
      <section className="hero-split">
        <div className="hero-split-bg" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hero-mapa.webp" alt="" width={903} height={732} fetchPriority="high" />
        </div>
        <div className="hero-split-inner">
          <h1 className="hero-title">Tu torneo de pádel, <span>en tiempo real</span></h1>
          <p className="hero-lead">Zonas, resultados, cuadros, horarios y ranking en un solo lugar. Buscá tu nombre y enterate cuándo y en qué cancha jugás.</p>
          <form action="/buscar" className="hero-search">
            <input name="q" placeholder="Buscá tu nombre o apellido…" aria-label="Buscar jugador" />
            <button className="btn primary pill">Buscar <span aria-hidden>→</span></button>
          </form>
          <div className="hero-links">
            <Link href="#torneos"><Icon name="trophy" size={24} /> Torneos</Link>
            <Link href="/buscar"><Icon name="calendar" size={24} /> ¿Cuándo juego?</Link>
            <Link href="/ranking"><Icon name="chart" size={24} /> Ranking</Link>
            <Link href="/login"><Icon name="users" size={24} /> Organizadores</Link>
          </div>
          <div className="hero-mini-stats">
            <span><b>{stats.tournaments}</b> torneos</span>
            <span><b>{stats.players}</b> jugadores</span>
            <span><b>{stats.played}</b> partidos jugados</span>
          </div>
        </div>
      </section>

      <main className="container stack" id="torneos">
        {live.length > 0 && (
          <>
            <h2 className="section-title"><span className="badge live">En vivo</span> Jugándose ahora</h2>
            <div className="tgrid">{live.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <h2 className="section-title">Próximos torneos</h2>
            <div className="tgrid">{upcoming.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </>
        )}
        {past.length > 0 && (
          <>
            <h2 className="section-title">Finalizados</h2>
            <div className="tgrid">{past.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
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
