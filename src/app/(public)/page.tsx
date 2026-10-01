import Link from "next/link";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { fmtDate } from "@/lib/format";

export default async function Home() {
  const rows = await sql<{ id: string; name: string; slug: string; start_date: string; end_date: string; status: string; venue: string | null; org_name: string; categories: string | null; entries: number }[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.status, v.name AS venue, o.name AS org_name,
      (SELECT string_agg(c.name, ' · ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries
    FROM tournaments t JOIN organizations o ON o.id = t.org_id LEFT JOIN venues v ON v.id = t.venue_id
    WHERE t.is_public AND t.status IN ('OPEN','IN_PROGRESS','FINISHED') AND t.end_date >= (now() - interval '60 days')::date
    ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 ELSE 2 END, t.start_date`;
  const live = rows.filter((t) => t.status === "IN_PROGRESS");
  const upcoming = rows.filter((t) => t.status === "OPEN");
  const past = rows.filter((t) => t.status === "FINISHED");
  const Card = ({ t }: { t: (typeof rows)[number] }) => (
    <Link href={`/t/${t.slug}`} className="tcard">
      <div className="card">
        <div className="row between"><StatusBadge status={t.status} /><span className="muted" style={{ fontSize: 13 }}>{fmtDate(t.start_date)}</span></div>
        <h2 style={{ margin: "10px 0 4px" }}>{t.name}</h2>
        <div className="muted" style={{ fontSize: 13 }}>{t.org_name}{t.venue ? ` · ${t.venue}` : ""}</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>{t.categories ?? ""}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.entries} parejas</div>
      </div>
    </Link>
  );
  return (
    <>
      <section className="hero">
        <div className="inner">
          <h1>Torneos de pádel</h1>
          <p>Resultados, zonas, cuadros y horarios en vivo.</p>
          <form action="/buscar" className="search-big">
            <input name="q" placeholder="Buscá tu nombre para ver cuándo jugás" aria-label="Buscar jugador" />
            <button className="btn primary">Buscar</button>
          </form>
        </div>
      </section>
      <main className="container stack">
        {live.length > 0 && <><h2>🔴 En curso</h2><div className="grid grid-3">{live.map((t) => <Card key={t.id} t={t} />)}</div></>}
        {upcoming.length > 0 && <><h2>Próximos</h2><div className="grid grid-3">{upcoming.map((t) => <Card key={t.id} t={t} />)}</div></>}
        {past.length > 0 && <><h2>Finalizados</h2><div className="grid grid-3">{past.map((t) => <Card key={t.id} t={t} />)}</div></>}
        {rows.length === 0 && <div className="card empty">Todavía no hay torneos publicados.</div>}
      </main>
    </>
  );
}
