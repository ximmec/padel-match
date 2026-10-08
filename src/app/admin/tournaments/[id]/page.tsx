import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { ActionForm, Submit } from "@/components/ActionForm";
import { StatusBadge } from "@/components/views";
import { addCategoryAction, removeCategoryAction, addAvailabilityAction, removeAvailabilityAction } from "@/server/actions/admin";
import { fmtDate, fmtDateTime, toLocalInput } from "@/lib/format";
import { ResetForm } from "@/components/ResetForm";

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const u = await requireUser();
  const [t] = await sql<{ id: string; name: string; slug: string; start_date: string; end_date: string; status: string; venue_id: string | null; circuit_id: string | null; season_id: string | null; is_public: boolean; rules_text: string | null; match_duration_min: number; min_rest_min: number; venue: string | null }[]>`
    SELECT t.*, v.name AS venue FROM tournaments t LEFT JOIN venues v ON v.id = t.venue_id WHERE t.id = ${id} AND t.org_id = ${u.orgId}`;
  if (!t) notFound();
  const [cats, allCats, venues, circuits, seasons, courts, avail] = await Promise.all([
    sql<{ id: string; name: string; status: string; entries: number; zones: number; played: number; total: number }[]>`
      SELECT tc.id, c.name, tc.status,
        (SELECT count(*)::int FROM entries e WHERE e.tc_id = tc.id AND e.status = 'ACTIVE') AS entries,
        (SELECT count(*)::int FROM zones z WHERE z.tc_id = tc.id) AS zones,
        (SELECT count(*)::int FROM matches m WHERE m.tc_id = tc.id AND m.status = 'PLAYED') AS played,
        (SELECT count(*)::int FROM matches m WHERE m.tc_id = tc.id AND m.status <> 'ANNULLED') AS total
      FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = ${id} ORDER BY c.name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM categories WHERE org_id = ${u.orgId} AND id NOT IN (SELECT category_id FROM tournament_categories WHERE tournament_id = ${id}) ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM venues WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM circuits WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM seasons WHERE org_id = ${u.orgId} ORDER BY name DESC`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM courts WHERE venue_id = ${t.venue_id} AND active ORDER BY sort, name`,
    sql<{ id: string; court: string; starts_at: Date; ends_at: Date }[]>`
      SELECT a.id, c.name AS court, a.starts_at, a.ends_at FROM court_availability a JOIN courts c ON c.id = a.court_id
      WHERE a.tournament_id = ${id} ORDER BY a.starts_at, c.sort, c.name`,
  ]);
  const defaultStart = toLocalInput(new Date(`${t.start_date}T09:00:00-03:00`));
  const defaultEnd = toLocalInput(new Date(`${t.start_date}T22:00:00-03:00`));

  return (
    <div className="stack">
      <div className="crumbs"><Link href="/admin/tournaments">Torneos</Link> /</div>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
          <div className="row"><StatusBadge status={t.status} /><span className="muted">{fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` al ${fmtDate(t.end_date)}` : ""} · {t.venue ?? "Sin sede"}</span></div>
        </div>
        <div className="row">
          {can(u, "tournaments.manage") && <Link className="btn" href={`/admin/tournaments/${id}/edit`}>✏️ Editar torneo</Link>}
          <Link className="btn" href={`/admin/tournaments/${id}/schedule`}>🗓 Cronograma</Link>
          {can(u, "results.enter") && <Link className="btn primary" href={`/admin/results?t=${id}`}>⚡ Resultados</Link>}
          <Link className="btn ghost" href={`/t/${t.slug}`} target="_blank">Vista pública ↗</Link>
        </div>
      </div>

      <div className="card flush">
        <div className="card-head"><h2>Categorías</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Categoría</th><th>Fase</th><th className="num">Parejas</th><th className="num">Zonas</th><th>Partidos jugados</th><th></th></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/tournaments/${id}/c/${c.id}`}><b>{c.name}</b></Link></td>
                <td><StatusBadge status={c.status} /></td>
                <td className="num">{c.entries}</td>
                <td className="num">{c.zones}</td>
                <td>{c.total ? <><progress value={c.played} max={c.total} style={{ width: 80, verticalAlign: "middle" }} /> {c.played}/{c.total}</> : "—"}</td>
                <td className="row" style={{ justifyContent: "flex-end" }}>
                  <Link className="btn sm" href={`/admin/tournaments/${id}/c/${c.id}`}>Gestionar</Link>
                  {can(u, "tournaments.manage") && c.entries === 0 && (
                    <ActionForm action={removeCategoryAction} confirmText="¿Quitar esta categoría del torneo?"><input type="hidden" name="tc_id" value={c.id} /><Submit className="btn ghost sm">Quitar</Submit></ActionForm>
                  )}
                </td>
              </tr>
            ))}
            {cats.length === 0 && <tr><td colSpan={6} className="empty">Agregá al menos una categoría.</td></tr>}
          </tbody>
        </table></div>
        {can(u, "tournaments.manage") && allCats.length > 0 && (
          <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
            <ActionForm action={addCategoryAction} className="row">
              <input type="hidden" name="tournament_id" value={id} />
              <select name="category_id" className="sm" required>{allCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <Submit className="btn sm">+ Agregar categoría</Submit>
            </ActionForm>
          </div>
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>Datos del torneo</h2>{can(u, "tournaments.manage") && <Link className="btn sm" href={`/admin/tournaments/${id}/edit`}>✏️ Editar</Link>}</div>
          <dl className="facts">
            <dt>Fechas</dt><dd>{fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` al ${fmtDate(t.end_date)}` : ""}</dd>
            <dt>Sede</dt><dd>{t.venue ?? "Sin sede"}</dd>
            <dt>Circuito</dt><dd>{circuits.find((c) => c.id === t.circuit_id)?.name ?? "—"}</dd>
            <dt>Temporada</dt><dd>{seasons.find((c) => c.id === t.season_id)?.name ?? "—"}</dd>
            <dt>Partidos</dt><dd>{t.match_duration_min} min · descanso {t.min_rest_min} min</dd>
            <dt>Vista pública</dt><dd>{t.is_public ? "Visible" : "Oculto"}</dd>
          </dl>
          {t.rules_text && <p className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{t.rules_text}</p>}
        </div>

        <div className="stack">
          <div className="card">
            <h2>Canchas y horarios disponibles</h2>
            {!t.venue_id && <div className="alert warn">Asigná una sede al torneo para cargar canchas.</div>}
            {t.venue_id && courts.length === 0 && <div className="alert warn">La sede no tiene canchas. Agregalas en <Link href="/admin/settings">Configuración</Link>.</div>}
            {avail.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 12 }}><table>
                <thead><tr><th>Cancha</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
                <tbody>{avail.map((a) => (
                  <tr key={a.id}><td>{a.court}</td><td>{fmtDateTime(a.starts_at)}</td><td>{fmtDateTime(a.ends_at)}</td>
                    <td>{can(u, "schedule.manage") && <ActionForm action={removeAvailabilityAction}><input type="hidden" name="id" value={a.id} /><Submit className="btn ghost sm" pendingText="…">✕</Submit></ActionForm>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            {can(u, "schedule.manage") && courts.length > 0 && (
              <ActionForm action={addAvailabilityAction}>
                <input type="hidden" name="tournament_id" value={id} />
                <div className="grid grid-2" style={{ gap: 12 }}>
                  <div className="field"><label>Desde</label><input type="datetime-local" name="starts_at" defaultValue={defaultStart} required /></div>
                  <div className="field"><label>Hasta</label><input type="datetime-local" name="ends_at" defaultValue={defaultEnd} required /></div>
                </div>
                <div className="row" style={{ marginBottom: 12 }}>
                  {courts.map((c) => <label key={c.id} className="checkbox"><input type="checkbox" name="court_ids" value={c.id} defaultChecked /> {c.name}</label>)}
                </div>
                <Submit className="btn sm">+ Agregar franja horaria</Submit>
              </ActionForm>
            )}
          </div>

          {can(u, "exports.download") && (
            <div className="card">
              <h2>Exportar a Excel</h2>
              <div className="row">
                <a className="btn ghost sm" href={`/api/export?type=tournament&t=${id}`}>📊 Torneo completo (todas las hojas)</a>
                <a className="btn ghost sm" href={`/api/export?type=schedule&t=${id}`}>Cronograma</a>
                <a className="btn ghost sm" href={`/api/export?type=audit&t=${id}`}>Historial de cambios</a>
              </div>
            </div>
          )}
          {can(u, "tournaments.manage") && <ResetForm scope="tournament" id={id} />}
        </div>
      </div>
    </div>
  );
}
