import Link from "next/link";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { getT } from "@/i18n/server";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export async function generateMetadata() { return { title: (await getT()).t.search.title }; }

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; t?: string }> }) {
  const sp = await searchParams;
  const { t: T } = await getT();
  const q = (sp.q ?? "").trim();
  const t = sp.t && isUuid(sp.t) ? sp.t : null;
  const words = fold(q).split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  // Solo se muestran jugadores que participan en torneos públicos; nunca datos de contacto.
  const rows = words.length
    ? await sql<{ id: string; first_name: string; last_name: string; code: string; tournaments: string | null }[]>`
        SELECT p.id, p.first_name, p.last_name, p.code,
          (SELECT string_agg(DISTINCT t.name, ' · ') FROM entry_players ep JOIN entries e ON e.id = ep.entry_id
             JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id
             WHERE ep.player_id = p.id AND ep.replaced_at IS NULL AND t.is_public AND t.status IN ('OPEN','IN_PROGRESS')) AS tournaments
        FROM players p
        WHERE p.deleted_at IS NULL
          ${words.reduce((acc, w) => sql`${acc} AND translate(lower(p.first_name || ' ' || p.last_name), 'áéíóúüñàèìòù', 'aeiouunaeiou') LIKE ${`%${w}%`}`, sql``)}
          AND EXISTS (SELECT 1 FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id
                      JOIN tournaments t ON t.id = tc.tournament_id WHERE ep.player_id = p.id AND t.is_public AND t.status <> 'DRAFT'
                      ${t ? sql`AND t.id = ${t}` : sql``})
        ORDER BY lower(p.last_name), lower(p.first_name) LIMIT 30`
    : [];
  return (
    <>
      <section className="hero">
        <div className="inner">
          <h1>{T.search.title}</h1>
          <p>{T.search.lead}</p>
          <form className="search-big">
            <input name="q" defaultValue={q} placeholder={T.search.ph} autoFocus aria-label={T.search.ph} />
            {t && <input type="hidden" name="t" value={t} />}
            <button className="btn primary">{T.search.button}</button>
          </form>
        </div>
      </section>
      <main className="container narrow stack" style={{ margin: "0 auto" }}>
        {q && rows.length === 0 && <div className="card empty">{T.search.none(q)}</div>}
        {rows.map((p) => (
          <Link key={p.id} href={`/jugador/${p.id}`} className="tcard">
            <div className="card row between">
              <div><b style={{ fontSize: 17 }}>{p.first_name} {p.last_name}</b><div className="muted" style={{ fontSize: 13 }}>{p.tournaments ?? T.search.noCurrent}</div></div>
              <span className="btn sm">{T.search.see}</span>
            </div>
          </Link>
        ))}
      </main>
    </>
  );
}
