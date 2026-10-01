import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Torneos" };

export default async function TournamentsPage() {
  const u = await requireUser();
  const rows = await sql<{ id: string; name: string; slug: string; start_date: string; end_date: string; status: string; venue: string | null; categories: string | null; entries: number }[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.status, v.name AS venue,
      (SELECT string_agg(c.name, ', ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries
    FROM tournaments t LEFT JOIN venues v ON v.id = t.venue_id
    WHERE t.org_id = ${u.orgId}
    ORDER BY t.start_date DESC`;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Torneos</h1>
        {can(u, "tournaments.manage") && <Link className="btn primary" href="/admin/tournaments/new">+ Nuevo torneo</Link>}
      </div>
      <div className="card flush"><div className="table-wrap"><table>
        <thead><tr><th>Torneo</th><th>Fecha</th><th className="hide-sm">Sede</th><th className="hide-sm">Categorías</th><th className="num">Parejas</th><th>Estado</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><Link href={`/admin/tournaments/${t.id}`}><b>{t.name}</b></Link></td>
              <td>{fmtDate(t.start_date)}</td>
              <td className="hide-sm">{t.venue ?? "—"}</td>
              <td className="hide-sm" style={{ fontSize: 13 }}>{t.categories ?? "—"}</td>
              <td className="num">{t.entries}</td>
              <td><StatusBadge status={t.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">Todavía no hay torneos.</td></tr>}
        </tbody>
      </table></div></div>
    </div>
  );
}
