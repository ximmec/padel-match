import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { publicTournamentBySlug, publicTournamentCategories } from "@/server/publicData";
import { loadCategory } from "@/server/category";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StandingsTable, BracketView, MatchLine, StatusBadge } from "@/components/views";
import { tiebreakAt } from "@/core/scoring";
import { getT } from "@/i18n/server";

export default async function PublicCategory({ params, searchParams }: { params: Promise<{ slug: string; tcId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug, tcId } = await params;
  const sp = await searchParams;
  const { lang, t: T } = await getT();
  if (!isUuid(tcId)) notFound();
  const t = await publicTournamentBySlug(slug);
  if (!t) notFound();
  const lc = await loadCategory(sql, tcId, t.org_id).catch(() => null);
  if (!lc || lc.tc.tournament_id !== t.id) notFound();
  const cats = await publicTournamentCategories(t.id);
  const zoneNames = Object.fromEntries(lc.zones.map((z) => [z.id, z.name]));
  const q = lc.rules.qualification;
  const ko = lc.rules.mode === "KNOCKOUT";
  const tab = sp.tab ?? (ko ? "cuadro" : "zonas");

  return (
    <main className="container stack">
      <div className="crumbs"><Link href={`/t/${slug}`}>{t.name}</Link> /</div>
      <div className="page-head">
        <div>
          <h1>{lc.tc.category_name}</h1>
          <div className="row"><StatusBadge status={lc.tc.status} lang={lang} /><span className="muted" style={{ fontSize: 13 }}>{T.g.format({ ...lc.rules.format, tb: tiebreakAt(lc.rules.format) })} · {ko ? T.category.knockout : q.fixedTotal ? T.category.fixed(q.fixedTotal) : T.category.qualify(q.perZone === "ALL" ? T.category.all : T.category.perZone(q.perZone), q.bestNext && q.perZone !== "ALL" ? T.category.best(q.bestNext, q.perZone + 1) : "")}</span></div>
        </div>
        <AutoRefresh tournamentId={t.id} />
      </div>
      {cats.length > 1 && <div className="chips">{cats.map((c) => <Link key={c.id} href={`/t/${slug}/c/${c.id}?tab=${tab}`} className={c.id === tcId ? "active" : ""}>{c.name}</Link>)}</div>}
      <nav className="tabs">
        {(ko ? ["cuadro", "partidos", "parejas"] : ["zonas", "partidos", "cuadro", "parejas"]).map((k) => [k, T.category.tabs[k as keyof typeof T.category.tabs]]).map(([k, l]) => (
          <Link key={k} href={`?tab=${k}`} className={tab === k ? "active" : ""}>{l}</Link>
        ))}
      </nav>
      {tab === "zonas" && (
        <div className="grid grid-zones">
          {lc.zones.map((z) => <StandingsTable key={z.id} lc={lc} zoneId={z.id} compact lang={lang} />)}
          {lc.zones.length === 0 && <div className="card empty">{T.category.noZones}</div>}
        </div>
      )}
      {tab === "partidos" && (
        <div className="grid grid-2">
          {lc.zones.map((z) => (
            <div key={z.id} className="card flush">
              <div className="card-head"><h3>{T.g.zone(z.name)}</h3></div>
              {lc.matches.filter((m) => m.zone_id === z.id && m.phase === "ZONE" && m.status !== "ANNULLED").map((m) => <MatchLine key={m.id} lc={lc} m={m} lang={lang} />)}
            </div>
          ))}
          {lc.matches.some((m) => m.phase === "BRACKET") && (
            <div className="card flush">
              <div className="card-head"><h3>{T.category.playoffs}</h3></div>
              {lc.matches.filter((m) => m.phase === "BRACKET").filter((m) => {
                const rm = lc.view.bracket.find((b) => b.code === m.bracket_code);
                return rm && !rm.byeAdvance && !(rm.a.kind === "BYE" && rm.b.kind === "BYE");
              }).map((m) => <MatchLine key={m.id} lc={lc} m={m} lang={lang} />)}
            </div>
          )}
        </div>
      )}
      {tab === "cuadro" && <div className="card"><BracketView lc={lc} zoneNames={zoneNames} lang={lang} /></div>}
      {tab === "parejas" && (
        <div className="card flush"><div className="table-wrap"><table>
          <thead><tr><th>{T.category.pair}</th><th>{ko ? T.category.seed : T.category.zone}</th></tr></thead>
          <tbody>{lc.entries.filter((e) => e.status === "ACTIVE").map((e) => (
            <tr key={e.id}>
              <td>{e.players.map((p, i) => <span key={p.id}>{i > 0 && " / "}<Link href={`/jugador/${p.id}`}>{p.first_name} {p.last_name}</Link></span>)}</td>
              <td>{ko ? (e.seed ?? "—") : (lc.zones.find((z) => z.entry_ids.includes(e.id))?.name ?? "—")}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </main>
  );
}
