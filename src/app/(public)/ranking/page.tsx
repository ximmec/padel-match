import Link from "next/link";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { getRanking } from "@/server/ranking";

export const metadata = { title: "Ranking" };

export default async function PublicRanking({ searchParams }: { searchParams: Promise<{ org?: string; category?: string; circuit?: string; season?: string }> }) {
  const sp = await searchParams;
  const orgs = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT o.id, o.name, o.slug FROM organizations o WHERE EXISTS (SELECT 1 FROM tournaments t WHERE t.org_id = o.id AND t.is_public) ORDER BY o.name`;
  const org = orgs.find((o) => o.slug === sp.org) ?? orgs[0];
  if (!org) return <main className="container"><div className="card empty">Todavía no hay rankings publicados.</div></main>;
  const f = {
    categoryId: sp.category && isUuid(sp.category) ? sp.category : undefined,
    circuitId: sp.circuit && isUuid(sp.circuit) ? sp.circuit : undefined,
    seasonId: sp.season && isUuid(sp.season) ? sp.season : undefined,
  };
  const [rows, categories, circuits, seasons] = await Promise.all([
    getRanking(sql, org.id, f),
    sql<{ id: string; name: string }[]>`SELECT id, name FROM categories WHERE org_id = ${org.id} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM circuits WHERE org_id = ${org.id} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM seasons WHERE org_id = ${org.id} ORDER BY name DESC`,
  ]);
  return (
    <>
      <section className="hero"><div className="inner"><h1>Ranking</h1><p>{org.name} · puntos individuales acumulados</p></div></section>
      <main className="container stack">
        <form className="card row">
          {orgs.length > 1 && <select name="org" defaultValue={org.slug} className="sm">{orgs.map((o) => <option key={o.id} value={o.slug}>{o.name}</option>)}</select>}
          {orgs.length === 1 && <input type="hidden" name="org" value={org.slug} />}
          <select name="category" defaultValue={f.categoryId ?? ""} className="sm"><option value="">General (todas las categorías)</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {circuits.length > 0 && <select name="circuit" defaultValue={f.circuitId ?? ""} className="sm"><option value="">Todos los circuitos</option>{circuits.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          {seasons.length > 0 && <select name="season" defaultValue={f.seasonId ?? ""} className="sm"><option value="">Todas las temporadas</option>{seasons.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <button className="btn sm">Ver</button>
        </form>
        <div className="card flush"><div className="table-wrap"><table>
          <thead><tr><th className="num">#</th><th>Jugador</th><th className="num">Torneos</th><th className="num">Puntos</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.player_id}>
                <td className="num"><b>{r.position}</b></td>
                <td><Link href={`/jugador/${r.player_id}`}>{r.first_name} {r.last_name}</Link></td>
                <td className="num">{r.events}</td>
                <td className="num"><b>{r.points}</b></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="empty">Sin puntos para este filtro.</td></tr>}
          </tbody>
        </table></div></div>
      </main>
    </>
  );
}
