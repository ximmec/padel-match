import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { queryAudit } from "@/server/auditQuery";
import { ACTION_LABELS } from "@/server/audit";
import { Forbidden } from "@/components/views";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Auditoría" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ t?: string; u?: string; from?: string; to?: string }> }) {
  const u = await requireUser();
  if (!can(u, "audit.view")) return <Forbidden />;
  const sp = await searchParams;
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const f = { orgId: u.orgId, tournamentId: sp.t && isUuid(sp.t) ? sp.t : null, userId: sp.u && isUuid(sp.u) ? sp.u : null, from: date(sp.from), to: date(sp.to) };
  const [rows, tournaments, users] = await Promise.all([
    queryAudit(sql, f),
    sql<{ id: string; name: string }[]>`SELECT id, name FROM tournaments WHERE org_id = ${u.orgId} ORDER BY start_date DESC`,
    sql<{ id: string; name: string }[]>`SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.org_id = ${u.orgId} ORDER BY u.name`,
  ]);
  const qs = new URLSearchParams(Object.entries({ t: f.tournamentId, u: f.userId, from: f.from, to: f.to }).filter(([, v]) => v) as [string, string][]);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Auditoría</h1>
        {can(u, "exports.download") && <a className="btn ghost sm" href={`/api/export?type=audit&${qs}`}>📊 Excel</a>}
      </div>
      <form className="card row">
        <select name="t" defaultValue={f.tournamentId ?? ""} className="sm"><option value="">Todos los torneos</option>{tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select name="u" defaultValue={f.userId ?? ""} className="sm"><option value="">Todos los usuarios</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <label className="row" style={{ margin: 0 }}>Desde <input type="date" name="from" defaultValue={f.from ?? ""} className="sm" /></label>
        <label className="row" style={{ margin: 0 }}>Hasta <input type="date" name="to" defaultValue={f.to ?? ""} className="sm" /></label>
        <button className="btn sm">Filtrar</button>
      </form>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Este registro no se puede modificar ni borrar. Se muestran los últimos 300 movimientos del filtro; el Excel incluye hasta 10.000.</p>
      <div className="card flush"><div className="table-wrap"><table>
        <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Torneo</th><th>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
              <td>{r.user_name ?? "—"}</td>
              <td>{r.tournament_name ?? "—"}</td>
              <td><span className="badge">{ACTION_LABELS[r.action] ?? r.action}</span></td>
              <td>
                {r.summary}
                {(r.before != null || r.after != null) && (
                  <details style={{ fontSize: 12 }}>
                    <summary className="muted">Valores anteriores y nuevos</summary>
                    <div className="grid grid-2" style={{ gap: 8 }}>
                      <pre style={{ whiteSpace: "pre-wrap", background: "#fef2f2", padding: 6, borderRadius: 6, margin: 0 }}>{JSON.stringify(r.before, null, 1)}</pre>
                      <pre style={{ whiteSpace: "pre-wrap", background: "#f0fdf4", padding: 6, borderRadius: 6, margin: 0 }}>{JSON.stringify(r.after, null, 1)}</pre>
                    </div>
                  </details>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="empty">Sin movimientos para este filtro.</td></tr>}
        </tbody>
      </table></div></div>
    </div>
  );
}
