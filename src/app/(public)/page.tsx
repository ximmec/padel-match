import { TournamentCard, type Row } from "@/components/PublicTournamentCard";
import Link from "next/link";
import { sql } from "@/server/db";
import { Icon } from "@/components/Icon";
import { InstallApp } from "@/components/InstallApp";
import { getT } from "@/i18n/server";

const FEATURES = [
  { href: "#torneos", icon: "trophy", img: "/cancha-atardecer.webp", pos: "64% 50%" },
  { href: "/buscar", icon: "calendar", img: "/hero-mapa.webp", pos: "30% 40%" },
  { href: "/ranking", icon: "chart", img: "/login-cancha.webp", pos: "50% 40%" },
  { href: "/jugadores", icon: "bell", img: "/hero-mapa.webp", pos: "80% 30%" },
];
const HOW_ICONS = ["edit", "grid", "trophy", "chart"];

export default async function Home() {
  const { lang, t: T } = await getT();
  const rows = await sql<Row[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.start_time::text AS start_time, t.entry_fee, (SELECT sum(COALESCE(NULLIF(tc.rules->>'maxEntries', '')::int, t.max_entries))::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS max_entries, t.logo, t.card_bg, t.status, v.name AS venue, o.name AS org_name, ci.name AS circuit_name, ci.logo AS circuit_logo,
      (SELECT string_agg(c.name, ' · ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries
    FROM tournaments t JOIN organizations o ON o.id = t.org_id LEFT JOIN venues v ON v.id = t.venue_id LEFT JOIN circuits ci ON ci.id = t.circuit_id
    WHERE t.is_public AND t.status IN ('OPEN','IN_PROGRESS','FINISHED') AND t.end_date >= (now() - interval '60 days')::date
    ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END, t.start_date`;
  const [stats] = await sql<{ tournaments: number; players: number; played: number; circuits: number }[]>`
    SELECT
      (SELECT count(DISTINCT circuit_id)::int FROM tournaments WHERE is_public AND status <> 'DRAFT' AND circuit_id IS NOT NULL) AS circuits,
      (SELECT count(*)::int FROM tournaments WHERE is_public AND status <> 'DRAFT') AS tournaments,
      (SELECT count(DISTINCT ep.player_id)::int FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE t.is_public) AS players,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE t.is_public AND m.status = 'PLAYED') AS played`;
  const live = rows.filter((t) => t.status === "IN_PROGRESS");
  const upcoming = rows.filter((t) => t.status === "OPEN");
  const past = rows.filter((t) => t.status === "FINISHED");

  const steps = T.home.steps;

  return (
    <>
      <section className="hero-split">
        <div className="hero-split-bg" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cancha-atardecer.webp" alt="" width={1704} height={923} fetchPriority="high" />
        </div>
        <div className="hero-split-inner">
          <span className="hero-pill"><Icon name="bolt" size={16} /> {T.home.kicker}</span>
          <h1 className="hero-title">{T.home.title1} <span>{T.home.title2}</span></h1>
          <p className="hero-lead">{T.home.lead}</p>
          <form action="/buscar" className="hero-search">
            <input name="q" placeholder={T.home.searchPh} aria-label={T.home.searchAria} />
            <button className="btn primary pill">{T.home.search} <span aria-hidden>→</span></button>
          </form>
          <InstallApp variant="hero" />
          <div className="hero-links">
            <Link href="#torneos"><Icon name="trophy" size={24} /> {T.nav.tournaments}</Link>
            <Link href="/buscar"><Icon name="calendar" size={24} /> {T.nav.when}</Link>
            <Link href="/ranking"><Icon name="chart" size={24} /> {T.nav.ranking}</Link>
            <Link href="/login"><Icon name="users" size={24} /> {T.home.organizers}</Link>
          </div>
          <div className="hero-stats">
            {([["trophy", stats.tournaments, T.home.tournamentsL], ["users", stats.players, T.home.playersL], ["bolt", stats.played, T.home.playedL], ["globe", stats.circuits, T.home.circuitsL]] as const).map(([ic, n, l]) => (
              <div key={l} className="hero-stat">
                <span className="hero-stat-ic"><Icon name={ic} size={20} /></span>
                <b>{n.toLocaleString(lang === "en" ? "en-US" : "es-AR")}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="container stack" id="torneos">
        {live.length > 0 && (
          <>
            <h2 className="section-title"><span className="badge live">{T.live.on}</span> {T.home.liveNow}</h2>
            <div className="tgrid">{live.map((t) => <TournamentCard key={t.id} t={t} lang={lang} />)}</div>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <h2 className="section-title">{T.home.upcoming}</h2>
            <div className="tgrid">{upcoming.map((t) => <TournamentCard key={t.id} t={t} lang={lang} />)}</div>
          </>
        )}
        {past.length > 0 && (
          <>
            <h2 className="section-title">{T.home.finished}</h2>
            <div className="tgrid">{past.map((t) => <TournamentCard key={t.id} t={t} lang={lang} />)}</div>
          </>
        )}
        {rows.length === 0 && <div className="card empty">{T.home.empty}</div>}

        <section className="feat-sec">
          <h2 className="feat-title">{T.home.featTitle1} <span>{T.home.featTitle2}</span></h2>
          <p className="feat-lead">{T.home.featLead}</p>
          <div className="feat-grid">
            {T.home.features.map(([title, text, cta], i) => {
              const f = FEATURES[i];
              return (
                <Link key={title} href={f.href} className="feat-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.img} alt="" loading="lazy" style={{ objectPosition: f.pos }} />
                  <span className="feat-ic"><Icon name={f.icon} size={22} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <span className="feat-cta">{cta} <span aria-hidden>→</span></span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="feat-sec">
          <h2 className="feat-title">{T.home.how}</h2>
          <div className="how-grid">
            {steps.map(([n, title, text], i) => (
              <div key={n} className="how-card">
                <span className="how-num" aria-hidden>{n}</span>
                <span className="how-ic"><Icon name={HOW_ICONS[i]} size={26} /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
