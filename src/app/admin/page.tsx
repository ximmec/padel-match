import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { StatusBadge } from "@/components/views";
import { fmtDate, fmtTime } from "@/lib/format";

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
      <div className="page-head">
        <div><h1>Hola, {u.name.split(" ")[0]}</h1><p className="muted" style={{ margin: 0 }}>{u.orgName}</p></div>
        <div className="row">
          {can(u, "results.enter") && <Link className="btn primary lg" href="/admin/results">⚡ Cargar resultados</Link>}
          {can(u, "tournaments.manage") && <Link className="btn ghost" href="/admin/tournaments/new">+ Nuevo torneo</Link>}
          {can(u, "players.manage") && <Link className="btn ghost" href="/admin/players?new=1">+ Jugador</Link>}
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card stat"><div className="n">{tournaments.length}</div><div className="l">Torneos activos</div></div>
        <div className="card stat"><div className="n" style={{ color: "var(--live)" }}>{totals.in_play}</div><div className="l">Partidos en juego</div></div>
        <div className="card stat"><div className="n">{totals.pending}</div><div className="l">Partidos pendientes</div></div>
        <div className="card stat"><div className="n" style={{ color: "var(--ok)" }}>{totals.played}</div><div className="l">Partidos finalizados</div></div>
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
