import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { TournamentCard, type Row } from "@/components/PublicTournamentCard";
import { getT } from "@/i18n/server";

export default async function CircuitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lang, t: T } = await getT();
  if (!isUuid(id)) notFound();
  const [c] = await sql<{ id: string; name: string; description: string | null; logo: string | null; org_slug: string }[]>`
    SELECT c.id, c.name, c.description, c.logo, o.slug AS org_slug FROM circuits c JOIN organizations o ON o.id = c.org_id WHERE c.id = ${id}`;
  if (!c) notFound();
  const rows = await sql<Row[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.start_time::text AS start_time, t.entry_fee,
      (SELECT sum(COALESCE(NULLIF(tc.rules->>'maxEntries', '')::int, t.max_entries))::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS max_entries,
      t.logo, t.card_bg, t.status, v.name AS venue, o.name AS org_name, ${c.name}::text AS circuit_name, ${c.logo}::text AS circuit_logo,
      (SELECT string_agg(cat.name, ' · ' ORDER BY cat.name) FROM tournament_categories tc JOIN categories cat ON cat.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries
    FROM tournaments t JOIN organizations o ON o.id = t.org_id LEFT JOIN venues v ON v.id = t.venue_id
    WHERE t.circuit_id = ${id} AND t.is_public AND t.status <> 'DRAFT'
    ORDER BY t.start_date`;
  const upcoming = rows.filter((t) => t.status !== "FINISHED" && t.status !== "CANCELLED");
  const past = rows.filter((t) => t.status === "FINISHED");
  return (
    <>
      <section className="hero"><div className="inner row" style={{ gap: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.logo && <img src={c.logo} alt="" width={90} height={90} style={{ borderRadius: "50%", border: "3px solid rgba(255,115,0,.5)" }} />}
        <div>
          <div className="hero-kicker">{T.circuit.kicker}</div>
          <h1>{c.name}</h1>
          {c.description && <p>{c.description}</p>}
        </div>
      </div></section>
      <main className="container stack">
        <div className="row"><Link className="btn primary pill" href={`/ranking?org=${c.org_slug}&circuit=${c.id}`}>{T.circuit.ranking}</Link></div>
        {upcoming.length > 0 && <><h2 className="section-title">{T.circuit.upcoming}</h2><div className="tgrid">{upcoming.map((t) => <TournamentCard key={t.id} t={t} lang={lang} />)}</div></>}
        {past.length > 0 && <><h2 className="section-title">{T.circuit.past}</h2><div className="tgrid">{past.map((t) => <TournamentCard key={t.id} t={t} lang={lang} />)}</div></>}
        {rows.length === 0 && <div className="card empty">{T.circuit.empty}</div>}
      </main>
    </>
  );
}
