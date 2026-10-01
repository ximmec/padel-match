import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { loadTournamentSchedule, scheduleConflicts } from "@/server/schedule";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AgendaBoard } from "@/components/AgendaBoard";
import { StatusBadge } from "@/components/views";
import { generateScheduleAction, moveMatchAction } from "@/server/actions/competition";
import { APP_TZ, fmtDateTime, toLocalInput } from "@/lib/format";

export const metadata = { title: "Cronograma" };

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const u = await requireUser();
  let s;
  try { s = await loadTournamentSchedule(sql, id, u.orgId); } catch { notFound(); }
  const conflicts = scheduleConflicts(s);
  const conflictIds = new Set(conflicts.flatMap((c) => c.matchIds));
  const edit = can(u, "schedule.manage");
  const courtName = (cid: string | null) => s.courts.find((c) => c.id === cid)?.name ?? "—";
  const sorted = [...s.items].sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || a.priority - b.priority);

  return (
    <div className="stack">
      <div className="crumbs"><Link href="/admin/tournaments">Torneos</Link> / <Link href={`/admin/tournaments/${id}`}>{s.tournament.name}</Link> /</div>
      <div className="page-head">
        <div>
          <h1>Cronograma</h1>
          <span className="muted">{s.courts.length} cancha(s) · partidos de {s.tournament.match_duration_min} min · descanso mínimo {s.tournament.min_rest_min} min</span>
        </div>
        {edit && (
          <div className="row">
            <ActionForm action={generateScheduleAction} confirmText="Se reprogramarán todos los partidos no jugados y no fijados. ¿Continuar?">
              <input type="hidden" name="tournament_id" value={id} /><input type="hidden" name="mode" value="ALL" />
              <Submit className="btn primary">Generar cronograma</Submit>
            </ActionForm>
            <ActionForm action={generateScheduleAction} confirmText="Los partidos pendientes se reprogramarán desde ahora (por retrasos, bajas o cambios). ¿Continuar?">
              <input type="hidden" name="tournament_id" value={id} /><input type="hidden" name="mode" value="FROM_NOW" />
              <Submit className="btn warn">Recalcular desde ahora</Submit>
            </ActionForm>
          </div>
        )}
      </div>
      {s.courts.length === 0 && <div className="alert warn">El torneo no tiene canchas disponibles. Asigná una sede y cargá horarios en <Link href={`/admin/tournaments/${id}`}>los datos del torneo</Link>.</div>}
      {conflicts.length > 0 && (
        <div className="alert err">
          <b>{conflicts.length} conflicto(s) en el cronograma:</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{conflicts.slice(0, 10).map((c, i) => <li key={i}>{c.message}</li>)}</ul>
        </div>
      )}

      <AgendaBoard
        courts={s.courts}
        durationMin={s.tournament.match_duration_min}
        tz={APP_TZ}
        canEdit={edit}
        items={s.items.map((i) => ({
          id: i.matchId, title: `${i.categoryName} · ${i.stage}`, sub: `${i.sideA} vs ${i.sideB}`,
          courtId: i.courtId, start: i.start ? i.start.getTime() : null, status: i.status, locked: i.locked, conflict: conflictIds.has(i.matchId),
        }))}
      />

      <div className="card flush">
        <div className="card-head"><h2>Lista de partidos</h2>{can(u, "exports.download") && <a className="btn ghost sm" href={`/api/export?type=schedule&t=${id}`}>📊 Excel</a>}</div>
        <div className="table-wrap"><table>
          <thead><tr><th>Horario</th><th>Cancha</th><th>Partido</th><th>Estado</th>{edit && <th>Cambiar</th>}</tr></thead>
          <tbody>
            {sorted.map((i) => (
              <tr key={i.matchId} style={conflictIds.has(i.matchId) ? { background: "var(--err-bg)" } : undefined}>
                <td style={{ whiteSpace: "nowrap" }}>{i.start ? fmtDateTime(i.start) : <span className="muted">Sin horario</span>}{i.locked && " 🔒"}</td>
                <td>{courtName(i.courtId)}</td>
                <td><span className="badge">{i.categoryName}</span> {i.stage}<div style={{ fontSize: 13 }}>{i.sideA} vs {i.sideB}</div></td>
                <td><StatusBadge status={i.status} /></td>
                {edit && (
                  <td>
                    {i.status !== "PLAYED" && (
                      <ActionForm action={moveMatchAction} className="row">
                        <input type="hidden" name="match_id" value={i.matchId} />
                        <select name="court_id" className="sm" defaultValue={i.courtId ?? ""}><option value="">—</option>{s.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                        <input type="datetime-local" name="start" className="sm" defaultValue={toLocalInput(i.start)} />
                        <select name="lock" className="sm" defaultValue="on"><option value="on">Fijar</option><option value="off">No fijar</option></select>
                        <Submit className="btn sm" pendingText="…">OK</Submit>
                      </ActionForm>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={5} className="empty">No hay partidos todavía.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
