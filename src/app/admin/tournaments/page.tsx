import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { Icon } from "@/components/Icon";
import { ActionForm } from "@/components/ActionForm";
import { setTournamentStatusAction } from "@/server/actions/admin";
import { fmtDate } from "@/lib/format";
import { cardBgUrl, fmtMoney } from "@/lib/cardBg";

export const metadata = { title: "Mis torneos" };

const FILTERS: [string, string, string[] | null][] = [
  ["todos", "Todos", null],
  ["en-curso", "En curso", ["IN_PROGRESS"]],
  ["proximos", "Próximos", ["OPEN"]],
  ["borrador", "Borrador", ["DRAFT"]],
  ["finalizados", "Finalizados", ["FINISHED"]],
  ["cancelados", "Cancelados", ["CANCELLED"]],
];

type Row = { id: string; circuit_id: string | null; circuit_logo: string | null; name: string; slug: string; start_date: string; end_date: string; start_time: string | null; entry_fee: number | null; max_entries: number | null; logo: string | null; card_bg: string; status: string; venue: string | null; categories: string | null; ncat: number; first_tc: string | null; entries: number; played: number; total: number };

function cardStyle(bg: string): React.CSSProperties {
  const url = cardBgUrl(bg);
  return { backgroundImage: `linear-gradient(90deg, rgba(8,8,10,.96) 0%, rgba(8,8,10,.82) 45%, rgba(8,8,10,.55) 100%)${url ? `, url(${url})` : ""}` };
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ f?: string; circuit?: string }> }) {
  const { f = "todos", circuit } = await searchParams;
  const u = await requireUser();
  const rows = await sql<Row[]>`
    SELECT t.id, t.circuit_id, ci.logo AS circuit_logo, t.name, t.slug, t.start_date, t.end_date, t.start_time::text AS start_time, t.entry_fee, (SELECT sum(COALESCE(NULLIF(tc.rules->>'maxEntries', '')::int, t.max_entries))::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS max_entries, t.logo, t.card_bg, t.status, v.name AS venue,
      (SELECT string_agg(c.name, ' · ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS ncat,
      (SELECT tc.id FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id ORDER BY c.name LIMIT 1) AS first_tc,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status = 'PLAYED') AS played,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status <> 'ANNULLED') AS total
    FROM tournaments t LEFT JOIN venues v ON v.id = t.venue_id LEFT JOIN circuits ci ON ci.id = t.circuit_id
    WHERE t.org_id = ${u.orgId}
    ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, t.start_date DESC`;
  const circuits = await sql<{ id: string; name: string; logo: string | null }[]>`SELECT id, name, logo FROM circuits WHERE org_id = ${u.orgId} ORDER BY name`;
  const curCircuit = circuits.find((c) => c.id === circuit) ?? null;
  const active = FILTERS.find((x) => x[0] === f) ?? FILTERS[0];
  const inCircuit = circuit === "ninguno" ? rows.filter((r) => !r.circuit_id) : curCircuit ? rows.filter((r) => r.circuit_id === curCircuit.id) : rows;
  const list = active[2] ? inCircuit.filter((r) => active[2]!.includes(r.status)) : inCircuit;
  const groups = [
    ...circuits.map((c) => ({ key: c.id, title: c.name, logo: c.logo, items: list.filter((r) => r.circuit_id === c.id) })),
    { key: "ninguno", title: "Torneos sin circuito", logo: null as string | null, items: list.filter((r) => !r.circuit_id) },
  ].filter((g) => g.items.length);
  const qs = (o: Record<string, string | undefined>) => { const q = new URLSearchParams(Object.entries({ f: f === "todos" ? undefined : f, circuit, ...o }).filter(([, v]) => v) as [string, string][]); const t = q.toString(); return t ? `?${t}` : "/admin/tournaments"; };
    const manage = can(u, "tournaments.manage");

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="form-eyebrow">Organizador</div>
          <h1 className="form-title" style={{ marginBottom: 6 }}>Mis torneos</h1>
          <p className="muted" style={{ margin: 0 }}>Hacé click en un torneo para gestionarlo, o usá el menú <b>•••</b> para más acciones.</p>
        </div>
        {manage && <Link className="btn primary pill lg" href={curCircuit ? `/admin/tournaments/new?circuit=${curCircuit.id}` : "/admin/tournaments/new"}>+ Nuevo torneo{curCircuit ? ` en ${curCircuit.name}` : ""}</Link>}
      </div>

      {circuits.length > 0 && (
        <nav className="filter-pills">
          <Link href={qs({ circuit: undefined })} className={!circuit ? "active" : ""}>Todos los circuitos</Link>
          {circuits.map((c) => <Link key={c.id} href={qs({ circuit: c.id })} className={circuit === c.id ? "active" : ""}>{c.name} <span>{rows.filter((r) => r.circuit_id === c.id).length}</span></Link>)}
          {rows.some((r) => !r.circuit_id) && <Link href={qs({ circuit: "ninguno" })} className={circuit === "ninguno" ? "active" : ""}>Sin circuito <span>{rows.filter((r) => !r.circuit_id).length}</span></Link>}
          <Link href="/admin/circuits" style={{ borderStyle: "dashed" }}>+ Circuitos</Link>
        </nav>
      )}
      <nav className="filter-pills">
        {FILTERS.map(([k, label, st]) => (
          <Link key={k} href={qs({ f: k === "todos" ? undefined : k })} className={k === active[0] ? "active" : ""}>
            {label} <span>{st ? inCircuit.filter((r) => st.includes(r.status)).length : inCircuit.length}</span>
          </Link>
        ))}
      </nav>
      {list.length === 0 && (
        <div className="card empty">
          {rows.length === 0 ? <>Todavía no hay torneos. {manage && <Link href="/admin/tournaments/new">Creá el primero</Link>}</> : "No hay torneos con este filtro."}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.key} className="stack">
          <div className="circuit-section">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {g.key !== "ninguno" && (g.logo ? <img src={g.logo} alt="" /> : <span className="ini">{g.title[0]}</span>)}
            <h2>{g.title}</h2>
            <span className="muted">{g.items.length} torneo(s)</span>
            {g.key !== "ninguno" && <Link href={`/admin/ranking?circuit=${g.key}`}>🏆 Ranking del circuito</Link>}
            {g.key !== "ninguno" && manage && <Link href={`/admin/tournaments/new?circuit=${g.key}`}>+ Nuevo torneo en este circuito</Link>}
          </div>
          <div className="tgrid">
            {g.items.map((t) => {
          const cats = (t.categories ?? "").split(" · ").filter(Boolean);
          return (
            <article key={t.id} className="tcard2" style={cardStyle(t.card_bg)}>
              <Link href={`/admin/tournaments/${t.id}`} className="tcard2-link" aria-label={`Gestionar ${t.name}`} />
              <div className="tcard2-top"><StatusBadge status={t.status} /></div>
              <div className="tcard2-body">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="tcard2-logo" src={t.logo ?? t.circuit_logo ?? "/mark.webp"} alt="" width={84} height={84} />
                <div style={{ minWidth: 0 }}>
                  <div className="tcard2-cats">{cats.length ? cats.join(" · ") : "Sin categorías"}</div>
                  <h3 className="tcard2-name">{t.name}</h3>
                  <div className="tcard2-meta"><Icon name="calendar" size={18} /> {fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` al ${fmtDate(t.end_date)}` : ""}{t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ""}</div>
                  <div className="tcard2-meta"><Icon name="pin" size={18} /> {t.venue ?? "Sin sede"}</div>
                </div>
              </div>
              <div className="tcard2-foot">
                <div className="tstat"><Icon name="users" size={20} /><span><b>{t.entries}{t.max_entries ? `/${t.max_entries}` : ""}</b><small>Parejas</small></span></div>
                {t.entry_fee != null
                  ? <div className="tstat"><Icon name="tag" size={20} /><span><b>{fmtMoney(t.entry_fee)}</b><small>Arancel</small></span></div>
                  : <div className="tstat"><Icon name="tag" size={20} /><span><b>{t.ncat}</b><small>{t.ncat === 1 ? "Categoría" : "Categorías"}</small></span></div>}
                <div className="tstat"><Icon name="bolt" size={20} /><span><b>{t.played}/{t.total}</b><small>Partidos</small></span></div>
                <details className="tmenu">
                  <summary aria-label="Más acciones">•••</summary>
                  <div className="tmenu-pop">
                    <Link href={`/admin/tournaments/${t.id}`}><Icon name="trophy" size={18} /> Gestionar</Link>
                    <Link href={t.first_tc ? `/admin/tournaments/${t.id}/c/${t.first_tc}?tab=inscripciones` : `/admin/tournaments/${t.id}`}><Icon name="users" size={18} /> Participantes</Link>
                    {manage && <Link href={`/admin/tournaments/${t.id}/edit`}><Icon name="edit" size={18} /> Editar datos</Link>}
                    <Link href={`/admin/tournaments/${t.id}/schedule`}><Icon name="calendar" size={18} /> Cronograma</Link>
                    {can(u, "results.enter") && <Link href={`/admin/results?t=${t.id}`}><Icon name="bolt" size={18} /> Cargar resultados</Link>}
                    <a href={`/t/${t.slug}`} target="_blank" rel="noreferrer"><Icon name="external" size={18} /> Vista pública</a>
                    {manage && (
                      <ActionForm action={setTournamentStatusAction} hideSuccess className="tmenu-form">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="status" value={t.status === "FINISHED" ? "IN_PROGRESS" : "FINISHED"} />
                        <button type="submit">{t.status === "FINISHED" ? <><Icon name="calendar" size={18} /> Reabrir torneo</> : <><Icon name="trophy" size={18} /> Finalizar torneo</>}</button>
                      </ActionForm>
                    )}
                    {manage && <Link href={`/admin/tournaments/${t.id}?eliminar=1#eliminar`} className="danger"><Icon name="x" size={18} /> Eliminar torneo</Link>}
                  </div>
                </details>
              </div>
            </article>
          );
        })}
          </div>
        </section>
      ))}
    </div>
  );
}
