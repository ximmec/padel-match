import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { Icon } from "@/components/Icon";
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

type Row = { id: string; name: string; slug: string; start_date: string; end_date: string; start_time: string | null; entry_fee: number | null; max_entries: number | null; logo: string | null; card_bg: string; status: string; venue: string | null; categories: string | null; ncat: number; entries: number; played: number; total: number };

function cardStyle(bg: string): React.CSSProperties {
  const url = cardBgUrl(bg);
  return { backgroundImage: `linear-gradient(90deg, rgba(8,8,10,.96) 0%, rgba(8,8,10,.82) 45%, rgba(8,8,10,.55) 100%)${url ? `, url(${url})` : ""}` };
}

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "todos" } = await searchParams;
  const u = await requireUser();
  const rows = await sql<Row[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.start_time::text AS start_time, t.entry_fee, t.max_entries, t.logo, t.card_bg, t.status, v.name AS venue,
      (SELECT string_agg(c.name, ' · ' ORDER BY c.name) FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = t.id) AS categories,
      (SELECT count(*)::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS ncat,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status = 'PLAYED') AS played,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status <> 'ANNULLED') AS total
    FROM tournaments t LEFT JOIN venues v ON v.id = t.venue_id
    WHERE t.org_id = ${u.orgId}
    ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'OPEN' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, t.start_date DESC`;
  const active = FILTERS.find((x) => x[0] === f) ?? FILTERS[0];
  const list = active[2] ? rows.filter((r) => active[2]!.includes(r.status)) : rows;
  const count = (st: string[] | null) => (st ? rows.filter((r) => st.includes(r.status)).length : rows.length);
  const manage = can(u, "tournaments.manage");

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="form-eyebrow">Organizador</div>
          <h1 className="form-title" style={{ marginBottom: 6 }}>Mis torneos</h1>
          <p className="muted" style={{ margin: 0 }}>Hacé click en un torneo para gestionarlo, o usá el menú <b>•••</b> para más acciones.</p>
        </div>
        {manage && <Link className="btn primary pill lg" href="/admin/tournaments/new">+ Nuevo torneo</Link>}
      </div>

      <nav className="filter-pills">
        {FILTERS.map(([k, label, st]) => (
          <Link key={k} href={k === "todos" ? "/admin/tournaments" : `?f=${k}`} className={k === active[0] ? "active" : ""}>
            {label} <span>{count(st)}</span>
          </Link>
        ))}
      </nav>

      <h2 className="tlist-title">Torneos</h2>
      {list.length === 0 && (
        <div className="card empty">
          {rows.length === 0 ? <>Todavía no hay torneos. {manage && <Link href="/admin/tournaments/new">Creá el primero</Link>}</> : "No hay torneos con este filtro."}
        </div>
      )}
      <div className="tgrid">
        {list.map((t) => {
          const cats = (t.categories ?? "").split(" · ").filter(Boolean);
          return (
            <article key={t.id} className="tcard2" style={cardStyle(t.card_bg)}>
              <Link href={`/admin/tournaments/${t.id}`} className="tcard2-link" aria-label={`Gestionar ${t.name}`} />
              <div className="tcard2-top"><StatusBadge status={t.status} /></div>
              <div className="tcard2-body">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.logo ? <img className="tcard2-logo" src={t.logo} alt="" width={84} height={84} /> : <img className="tcard2-logo" src="/mark.webp" alt="" width={84} height={84} />}
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
                    {manage && <Link href={`/admin/tournaments/${t.id}/edit`}><Icon name="edit" size={18} /> Editar datos</Link>}
                    <Link href={`/admin/tournaments/${t.id}/schedule`}><Icon name="calendar" size={18} /> Cronograma</Link>
                    {can(u, "results.enter") && <Link href={`/admin/results?t=${t.id}`}><Icon name="bolt" size={18} /> Cargar resultados</Link>}
                    <a href={`/t/${t.slug}`} target="_blank" rel="noreferrer"><Icon name="external" size={18} /> Vista pública</a>
                  </div>
                </details>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
