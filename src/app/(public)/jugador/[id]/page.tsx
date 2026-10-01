import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { loadCategory, entryLabel, type LoadedCategory } from "@/server/category";
import { playerPointsHistory } from "@/server/ranking";
import { MatchLine, StandingsTable } from "@/components/views";
import { STAGE_LABELS, type Stage } from "@/core/bracket";
import { fmtDate } from "@/lib/format";

export default async function PublicPlayer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [p] = await sql<{ id: string; first_name: string; last_name: string; code: string; city: string | null; org_id: string }[]>`
    SELECT id, first_name, last_name, code, city, org_id FROM players WHERE id = ${id} AND deleted_at IS NULL`;
  if (!p) notFound();
  const entries = await sql<{ entry_id: string; tc_id: string; tournament: string; slug: string; status: string; start_date: string }[]>`
    SELECT DISTINCT e.id AS entry_id, tc.id AS tc_id, t.name AS tournament, t.slug, t.status, t.start_date
    FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id
    JOIN tournaments t ON t.id = tc.tournament_id
    WHERE ep.player_id = ${id} AND ep.replaced_at IS NULL AND t.is_public AND t.status <> 'DRAFT'
    ORDER BY t.start_date DESC LIMIT 20`;
  // Solo es público quien participa en algún torneo publicado
  if (entries.length === 0) notFound();
  const current = entries.filter((e) => e.status === "OPEN" || e.status === "IN_PROGRESS");
  const loaded: { e: (typeof entries)[number]; lc: LoadedCategory }[] = [];
  for (const e of current) loaded.push({ e, lc: await loadCategory(sql, e.tc_id, null) });
  const points = (await playerPointsHistory(sql, id)).filter((x) => !x.superseded_at);
  const total = points.reduce((a, b) => a + b.points, 0);

  return (
    <>
      <section className="hero">
        <div className="inner">
          <h1>{p.first_name} {p.last_name}</h1>
          <p>{p.city ? `${p.city} · ` : ""}<span className="badge lime">{total} pts de ranking</span></p>
        </div>
      </section>
      <main className="container stack">
        {loaded.map(({ e, lc }) => {
          const entry = lc.entryMap.get(e.entry_id)!;
          const zone = lc.zones.find((z) => z.entry_ids.includes(e.entry_id));
          const mine = lc.matches.filter((m) => m.status !== "ANNULLED" && (
            m.entry_a === e.entry_id || m.entry_b === e.entry_id ||
            lc.view.bracket.some((b) => b.code === m.bracket_code && !b.byeAdvance && ((b.a.kind === "ENTRY" && b.a.entryId === e.entry_id) || (b.b.kind === "ENTRY" && b.b.entryId === e.entry_id)))
          ));
          const next = mine.filter((m) => m.status !== "PLAYED").sort((a, b) => (a.scheduled_at?.getTime() ?? Infinity) - (b.scheduled_at?.getTime() ?? Infinity));
          const done = mine.filter((m) => m.status === "PLAYED");
          return (
            <div key={e.entry_id} className="stack">
              <div className="card">
                <div className="row between">
                  <div>
                    <h2 style={{ margin: 0 }}><Link href={`/t/${e.slug}`}>{e.tournament}</Link></h2>
                    <div className="muted">{lc.tc.category_name} · Pareja: <b>{entryLabel(entry)}</b>{zone ? ` · Zona ${zone.name}` : ""}</div>
                  </div>
                  <Link className="btn ghost sm" href={`/t/${e.slug}/c/${lc.tc.id}`}>Ver categoría</Link>
                </div>
                {entry.status === "WITHDRAWN" && <div className="alert warn">La pareja figura como retirada.</div>}
              </div>
              <div className="grid grid-2">
                <div className="card flush">
                  <div className="card-head"><h3>Próximos partidos</h3></div>
                  {next.map((m) => <MatchLine key={m.id} lc={lc} m={m} />)}
                  {next.length === 0 && <div className="empty">No hay partidos pendientes.</div>}
                </div>
                <div className="card flush">
                  <div className="card-head"><h3>Resultados</h3></div>
                  {done.map((m) => <MatchLine key={m.id} lc={lc} m={m} />)}
                  {done.length === 0 && <div className="empty">Todavía no jugó.</div>}
                </div>
              </div>
              {zone && <StandingsTable lc={lc} zoneId={zone.id} compact />}
            </div>
          );
        })}
        {current.length === 0 && <div className="card empty">No está inscripto en torneos en curso.</div>}

        <div className="card flush">
          <div className="card-head"><h2>Historial de puntos</h2><Link href="/ranking">Ranking completo</Link></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Torneo</th><th>Instancia</th><th className="num">Puntos</th></tr></thead>
            <tbody>
              {points.map((x) => (
                <tr key={x.id}>
                  <td>{x.tournament_slug ? <Link href={`/t/${x.tournament_slug}`}>{x.tournament_name}</Link> : x.tournament_name ?? "Ajuste"}<div className="muted" style={{ fontSize: 12 }}>{x.category_name ?? ""} {x.start_date ? `· ${fmtDate(x.start_date)}` : ""}</div></td>
                  <td>{x.kind === "AUTO" ? STAGE_LABELS[x.stage as Stage] : `Ajuste: ${x.reason}`}</td>
                  <td className="num"><b>{x.points}</b></td>
                </tr>
              ))}
              {points.length === 0 && <tr><td colSpan={3} className="empty">Sin puntos todavía.</td></tr>}
            </tbody>
          </table></div>
        </div>
        {entries.length > current.length && (
          <div className="card">
            <h3>Torneos anteriores</h3>
            <ul>{entries.filter((e) => !current.includes(e)).map((e) => <li key={e.entry_id}><Link href={`/t/${e.slug}`}>{e.tournament}</Link> · {fmtDate(e.start_date)}</li>)}</ul>
          </div>
        )}
      </main>
    </>
  );
}
