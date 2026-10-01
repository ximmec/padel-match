import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { getRanking } from "@/server/ranking";
import { ActionForm, Submit } from "@/components/ActionForm";
import { rankingAdjustAction, recalcRankingAction } from "@/server/actions/competition";

export const metadata = { title: "Ranking" };

export default async function RankingAdmin({ searchParams }: { searchParams: Promise<{ category?: string; circuit?: string; season?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const f = {
    categoryId: sp.category && isUuid(sp.category) ? sp.category : undefined,
    circuitId: sp.circuit && isUuid(sp.circuit) ? sp.circuit : undefined,
    seasonId: sp.season && isUuid(sp.season) ? sp.season : undefined,
  };
  const [rows, categories, circuits, seasons, players, tcs] = await Promise.all([
    getRanking(sql, u.orgId, f),
    sql<{ id: string; name: string }[]>`SELECT id, name FROM categories WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM circuits WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM seasons WHERE org_id = ${u.orgId} ORDER BY name DESC`,
    sql<{ id: string; first_name: string; last_name: string; code: string }[]>`SELECT id, first_name, last_name, code FROM players WHERE org_id = ${u.orgId} AND deleted_at IS NULL ORDER BY lower(last_name), lower(first_name)`,
    sql<{ id: string; label: string; points_awarded_at: Date | null }[]>`
      SELECT tc.id, t.name || ' · ' || c.name AS label, tc.points_awarded_at FROM tournament_categories tc
      JOIN tournaments t ON t.id = tc.tournament_id JOIN categories c ON c.id = tc.category_id
      WHERE t.org_id = ${u.orgId} ORDER BY t.start_date DESC, c.name`,
  ]);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Ranking</h1>
        {can(u, "exports.download") && <a className="btn ghost sm" href={`/api/export?type=ranking&${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>📊 Excel</a>}
      </div>
      <form className="card row">
        <select name="category" defaultValue={f.categoryId ?? ""} className="sm"><option value="">Todas las categorías</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="circuit" defaultValue={f.circuitId ?? ""} className="sm"><option value="">Todos los circuitos</option>{circuits.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="season" defaultValue={f.seasonId ?? ""} className="sm"><option value="">Todas las temporadas</option>{seasons.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn sm">Filtrar</button>
      </form>
      <div className="grid grid-2">
        <div className="card flush">
          <div className="table-wrap"><table>
            <thead><tr><th className="num">#</th><th>Jugador</th><th className="num">Torneos</th><th className="num">Puntos</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player_id}>
                  <td className="num"><b>{r.position}</b></td>
                  <td><Link href={`/admin/players/${r.player_id}`}>{r.last_name}, {r.first_name}</Link> <span className="muted" style={{ fontSize: 12 }}>{r.code}</span></td>
                  <td className="num">{r.events}</td>
                  <td className="num"><b>{r.points}</b></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="empty">Todavía no hay puntos. Se asignan solos cuando un cuadro termina.</td></tr>}
            </tbody>
          </table></div>
        </div>
        {can(u, "ranking.adjust") && (
          <div className="stack">
            <div className="card">
              <h2>Ajuste manual</h2>
              <p className="muted" style={{ fontSize: 13 }}>Para sanciones, bonificaciones o correcciones. Queda registrado con tu usuario y el motivo.</p>
              <ActionForm action={rankingAdjustAction} resetOnSuccess>
                <div className="field"><label>Jugador</label><select name="player_id" required defaultValue=""><option value="" disabled>Elegir…</option>{players.map((p) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name} ({p.code})</option>)}</select></div>
                <div className="field"><label>Puntos (negativo para descontar)</label><input type="number" name="points" required /></div>
                <div className="field"><label>Torneo relacionado (opcional)</label><select name="tc_id" defaultValue=""><option value="">Ninguno</option>{tcs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
                <div className="field"><label>O asignar a categoría / circuito / temporada</label>
                  <div className="row">
                    <select name="category_id" className="sm" defaultValue=""><option value="">Categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    <select name="circuit_id" className="sm" defaultValue=""><option value="">Circuito</option>{circuits.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    <select name="season_id" className="sm" defaultValue=""><option value="">Temporada</option>{seasons.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  </div></div>
                <div className="field"><label>Motivo *</label><input name="reason" required minLength={5} /></div>
                <Submit className="btn primary">Registrar ajuste</Submit>
              </ActionForm>
            </div>
            <div className="card">
              <h2>Recalcular un torneo</h2>
              <p className="muted" style={{ fontSize: 13 }}>Normalmente no hace falta: los puntos se recalculan solos con cada resultado. Recalcular nunca duplica puntos.</p>
              <ActionForm action={recalcRankingAction} className="row">
                <select name="tc_id" className="sm" required>{tcs.map((t) => <option key={t.id} value={t.id}>{t.label}{t.points_awarded_at ? " ✓" : ""}</option>)}</select>
                <Submit className="btn sm">Recalcular</Submit>
              </ActionForm>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
