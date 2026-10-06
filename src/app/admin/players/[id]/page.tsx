import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PlayerFields } from "@/components/PlayerFields";
import { updatePlayerAction, deletePlayerAction, restorePlayerAction } from "@/server/actions/admin";
import { playerPointsHistory } from "@/server/ranking";
import { STAGE_LABELS, type Stage } from "@/core/bracket";
import { fmtDate, fmtDateTime } from "@/lib/format";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const u = await requireUser();
  const [p] = await sql<{ id: string; code: string; first_name: string; last_name: string; gender: string; document: string | null; phone: string | null; email: string | null; city: string | null; category: string | null; notes: string | null; deleted_at: Date | null }[]>`
    SELECT id, code, first_name, last_name, gender, document, phone, email, city, category, notes, deleted_at FROM players WHERE id = ${id} AND org_id = ${u.orgId}`;
  if (!p) notFound();

  const participations = await sql<{ entry_id: string; tc_id: string; tournament_id: string; tournament: string; start_date: string; category: string; status: string; active: boolean; replaced_at: Date | null; partner: string | null }[]>`
    SELECT e.id AS entry_id, tc.id AS tc_id, t.id AS tournament_id, t.name AS tournament, t.start_date, c.name AS category, e.status, ep.active, ep.replaced_at,
      (SELECT string_agg(p2.first_name || ' ' || p2.last_name, ', ') FROM entry_players ep2 JOIN players p2 ON p2.id = ep2.player_id
        WHERE ep2.entry_id = e.id AND ep2.player_id <> ${id} AND ep2.replaced_at IS NULL) AS partner
    FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id
    JOIN tournaments t ON t.id = tc.tournament_id JOIN categories c ON c.id = tc.category_id
    WHERE ep.player_id = ${id} ORDER BY t.start_date DESC`;
  const points = await playerPointsHistory(sql, id);
  const cats = await sql<{ category: string }[]>`SELECT DISTINCT category FROM players WHERE org_id = ${u.orgId} AND category IS NOT NULL ORDER BY category`;
  const total = points.filter((x) => !x.superseded_at).reduce((a, b) => a + b.points, 0);

  return (
    <div className="stack">
      <div className="crumbs"><Link href="/admin/players">Jugadores</Link> /</div>
      <div className="page-head">
        <div>
          <h1>{p.first_name} {p.last_name}</h1>
          <div className="row"><code>{p.code}</code>{p.category && <span className="badge">{p.category}</span>}{p.deleted_at && <span className="badge err">Dado de baja</span>}<span className="badge lime">{total} pts</span></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Datos</h2>
          {can(u, "players.manage") ? (
            <ActionForm action={updatePlayerAction}>
              <input type="hidden" name="id" value={p.id} />
              <PlayerFields p={p} categories={cats.map((c) => c.category)} />
              <Submit className="btn primary">Guardar cambios</Submit>
            </ActionForm>
          ) : <p>{p.gender} · {p.city}</p>}
          {can(u, "players.manage") && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              {p.deleted_at ? (
                <ActionForm action={restorePlayerAction}><input type="hidden" name="id" value={p.id} /><Submit className="btn ghost sm">Reactivar jugador</Submit></ActionForm>
              ) : (
                <ActionForm action={deletePlayerAction} confirmText="¿Dar de baja a este jugador? Su historial y sus puntos se conservan.">
                  <input type="hidden" name="id" value={p.id} />
                  <Submit className="btn danger sm">Dar de baja</Submit>
                  <div className="hint muted" style={{ fontSize: 12, marginTop: 4 }}>La baja es lógica: se conservan su historial y sus puntos.</div>
                </ActionForm>
              )}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card flush">
            <div className="card-head"><h2>Participaciones</h2></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Torneo</th><th>Categoría</th><th>Pareja</th><th>Estado</th></tr></thead>
              <tbody>
                {participations.map((x) => (
                  <tr key={x.entry_id + (x.replaced_at?.toString() ?? "")}>
                    <td><Link href={`/admin/tournaments/${x.tournament_id}/c/${x.tc_id}`}>{x.tournament}</Link><div className="muted" style={{ fontSize: 12 }}>{fmtDate(x.start_date)}</div></td>
                    <td>{x.category}</td>
                    <td>{x.partner ?? "—"}</td>
                    <td>{x.replaced_at ? <span className="badge warn">Reemplazado {fmtDateTime(x.replaced_at)}</span> : x.status === "WITHDRAWN" ? <span className="badge err">Retirada</span> : <span className="badge ok">Inscripto</span>}</td>
                  </tr>
                ))}
                {participations.length === 0 && <tr><td colSpan={4} className="empty">Sin participaciones.</td></tr>}
              </tbody>
            </table></div>
          </div>

          <div className="card flush">
            <div className="card-head"><h2>Historial de puntos</h2></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Torneo</th><th>Instancia / motivo</th><th className="num">Puntos</th></tr></thead>
              <tbody>
                {points.map((x) => (
                  <tr key={x.id} className={x.superseded_at ? "out" : ""}>
                    <td>{x.tournament_name ?? "Ajuste general"}<div className="muted" style={{ fontSize: 12 }}>{x.category_name ?? ""} · {fmtDateTime(x.created_at)}</div></td>
                    <td>{x.kind === "AUTO" ? STAGE_LABELS[x.stage as Stage] ?? x.stage : <>Ajuste manual: {x.reason}</>}{x.superseded_at && <div className="muted" style={{ fontSize: 12 }}>Reemplazado por un recálculo</div>}</td>
                    <td className="num"><b>{x.points > 0 ? "+" : ""}{x.points}</b></td>
                  </tr>
                ))}
                {points.length === 0 && <tr><td colSpan={3} className="empty">Sin puntos todavía.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </div>
      </div>
    </div>
  );
}
