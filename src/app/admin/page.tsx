import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { fmtDate, fmtTime } from "@/lib/format";
import { Icon } from "@/components/Icon";

export default async function Dashboard() {
  const u = await requireUser();
  const tournaments = await sql<{ id: string; name: string; slug: string; start_date: string; end_date: string; status: string;
    pending: number; in_play: number; played: number; entries: number; categories: number }[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.status,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status = 'PENDING'
        AND NOT (m.phase = 'BRACKET' AND EXISTS (SELECT 1 FROM jsonb_array_elements(tc.bracket) d
                 WHERE d->>'code' = m.bracket_code AND (d->'a'->>'t' = 'BYE' OR d->'b'->>'t' = 'BYE')))) AS pending,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status = 'IN_PLAY') AS in_play,
      (SELECT count(*)::int FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = t.id AND m.status = 'PLAYED') AS played,
      (SELECT count(*)::int FROM entries e JOIN tournament_categories tc ON tc.id = e.tc_id WHERE tc.tournament_id = t.id AND e.status = 'ACTIVE') AS entries,
      (SELECT count(*)::int FROM tournament_categories tc WHERE tc.tournament_id = t.id) AS categories
    FROM tournaments t
    WHERE t.org_id = ${u.orgId} AND t.status IN ('DRAFT','OPEN','IN_PROGRESS')
    ORDER BY t.start_date`;

  const live = await sql<{ id: string; tournament_id: string; tournament: string; category: string; court: string | null; scheduled_at: Date | null; tc_id: string }[]>`
    SELECT m.id, t.id AS tournament_id, t.name AS tournament, c.name AS category, co.name AS court, m.scheduled_at, tc.id AS tc_id
    FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    JOIN categories c ON c.id = tc.category_id LEFT JOIN courts co ON co.id = m.court_id
    WHERE t.org_id = ${u.orgId} AND m.status = 'IN_PLAY' ORDER BY m.scheduled_at NULLS LAST LIMIT 20`;

  const next = await sql<{ id: string; tournament: string; category: string; court: string | null; scheduled_at: Date; tc_id: string; tournament_id: string }[]>`
    SELECT m.id, t.name AS tournament, c.name AS category, co.name AS court, m.scheduled_at, tc.id AS tc_id, t.id AS tournament_id
    FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    JOIN categories c ON c.id = tc.category_id LEFT JOIN courts co ON co.id = m.court_id
    WHERE t.org_id = ${u.orgId} AND m.status = 'PENDING' AND m.scheduled_at IS NOT NULL AND m.scheduled_at > now() - interval '3 hours'
    ORDER BY m.scheduled_at LIMIT 10`;

  const totals = tournaments.reduce((a, t) => ({ pending: a.pending + t.pending, in_play: a.in_play + t.in_play, played: a.played + t.played }), { pending: 0, in_play: 0, played: 0 });

  return (
    <div className="stack">
      <div className="dash-head">
        <div>
          <div className="dash-eyebrow">Hola, {u.name.split(" ")[0]} 👋</div>
          <h1 className="dash-org">{u.orgName}</h1>
          <div className="muted">{u.email}</div>
        </div>
        <div className="row dash-actions">
          {can(u, "results.enter") && <Link className="btn primary pill lg" href="/admin/results">Cargar resultados <span className="pill-ico"><Icon name="arrow" size={16} /></span></Link>}
          {can(u, "tournaments.manage") && <Link className="btn ghost pill lg" href="/admin/tournaments/new">Crear torneo</Link>}
          <Link className="btn ghost pill lg" href="/admin/tournaments">Mis torneos</Link>
        </div>
      </div>

      <div className="grid grid-4 dash-stats">
        <div className="card stat center"><div className="l">Torneos activos</div><div className="n">{tournaments.length}</div></div>
        <div className="card stat center"><div className="l">En juego</div><div className="n" style={{ color: "var(--live)" }}>{totals.in_play}</div></div>
        <div className="card stat center"><div className="l">Pendientes</div><div className="n">{totals.pending}</div></div>
        <div className="card stat center"><div className="l">Finalizados</div><div className="n" style={{ color: "var(--lime)" }}>{totals.played}</div></div>
      </div>

      <div>
        <div className="dash-eyebrow" style={{ marginTop: 18 }}>Accesos rápidos</div>
        <h2 className="dash-q">¿Qué querés hacer?</h2>
        <div className="grid quick-grid">
          {([
            [can(u, "results.enter"), "/admin/results", "bolt", "Cargar resultados", "Partidos en juego y pendientes"],
            [can(u, "tournaments.manage"), "/admin/tournaments/new", "plus", "Crear torneo", "Fechas, sede y categorías"],
            [true, "/admin/tournaments", "trophy", "Mis torneos", "Zonas, cuadros y cronograma"],
            [can(u, "players.manage"), "/admin/players?new=1", "users", "Agregar jugador", "Alta manual o desde Excel"],
            [true, "/admin/ranking", "chart", "Ranking", "Puntos acumulados por circuito"],
            [true, "/", "globe", "Vista pública", "Lo que ven los jugadores"],
          ] as [boolean, string, string, string, string][]).filter((q) => q[0]).map(([, href, icon, title, text]) => (
            <Link key={href} href={href} className="quick" target={href === "/" ? "_blank" : undefined}>
              <span className="quick-ico"><Icon name={icon} size={22} /></span>
              <span><b>{title}</b><small>{text}</small></span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card flush">
          <div className="card-head"><h2>Torneos activos</h2><Link href="/admin/tournaments">Ver todos</Link></div>
          {tournaments.length === 0 && <div className="empty">No hay torneos activos. <Link href="/admin/tournaments/new">Creá el primero</Link>.</div>}
          {tournaments.map((t) => (
            <div key={t.id} className="match">
              <div>
                <Link href={`/admin/tournaments/${t.id}`}><b>{t.name}</b></Link>
                <div className="muted" style={{ fontSize: 13 }}>{fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` al ${fmtDate(t.end_date)}` : ""} · {t.categories} categoría(s) · {t.entries} parejas</div>
              </div>
              <StatusBadge status={t.status} />
              <div className="meta">
                <span className="badge live" style={{ display: t.in_play ? undefined : "none" }}>{t.in_play} en juego</span>
                <span className="badge">{t.pending} pendientes</span>
                <span className="badge ok">{t.played} finalizados</span>
                <Link href={`/admin/tournaments/${t.id}/schedule`}>Cronograma</Link>
                <Link href={`/t/${t.slug}`} target="_blank">Vista pública ↗</Link>
              </div>
            </div>
          ))}
        </div>
        <div className="stack">
          <div className="card flush">
            <div className="card-head"><h2>En juego ahora</h2></div>
            {live.length === 0 && <div className="empty">No hay partidos marcados en juego.</div>}
            {live.map((m) => (
              <div key={m.id} className="match">
                <div><b>{m.category}</b> <span className="muted">· {m.tournament}</span></div>
                <span className="badge live">En juego</span>
                <div className="meta">{m.court && <span>📍 {m.court}</span>}<Link href={`/admin/results?t=${m.tournament_id}#m-${m.id}`}>Cargar resultado</Link></div>
              </div>
            ))}
          </div>
          <div className="card flush">
            <div className="card-head"><h2>Próximos partidos</h2></div>
            {next.length === 0 && <div className="empty">No hay partidos programados próximamente.</div>}
            {next.map((m) => (
              <div key={m.id} className="match">
                <div><b>{fmtTime(m.scheduled_at)}</b> · {m.category} <span className="muted">· {m.tournament}</span></div>
                <span className="muted">{m.court ?? ""}</span>
                <div className="meta"><Link href={`/admin/results?t=${m.tournament_id}#m-${m.id}`}>Cargar resultado</Link> · <Link href={`/admin/tournaments/${m.tournament_id}/schedule`}>Cambiar horario</Link></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
