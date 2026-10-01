import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PlayerFields } from "@/components/PlayerFields";
import { createPlayerAction } from "@/server/actions/admin";

export const metadata = { title: "Jugadores" };
const PAGE = 50;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; new?: string; deleted?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const showDeleted = sp.deleted === "1";
  const like = `%${q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}%`;
  const rows = await sql<{ id: string; code: string; first_name: string; last_name: string; gender: string; city: string | null; document: string | null; deleted_at: Date | null; points: number; events: number; total: number }[]>`
    SELECT p.id, p.code, p.first_name, p.last_name, p.gender, p.city, p.document, p.deleted_at,
      COALESCE((SELECT sum(points)::int FROM ranking_ledger l WHERE l.player_id = p.id AND l.superseded_at IS NULL), 0) AS points,
      (SELECT count(DISTINCT ep.tc_id)::int FROM entry_players ep WHERE ep.player_id = p.id) AS events,
      count(*) OVER()::int AS total
    FROM players p
    WHERE p.org_id = ${u.orgId}
      ${showDeleted ? sql`` : sql`AND p.deleted_at IS NULL`}
      ${q ? sql`AND (translate(lower(p.first_name || ' ' || p.last_name), 'áéíóúüñ', 'aeiouun') LIKE ${like} OR translate(lower(p.last_name || ' ' || p.first_name), 'áéíóúüñ', 'aeiouun') LIKE ${like} OR lower(p.code) LIKE ${like} OR p.document LIKE ${like})` : sql``}
    ORDER BY lower(p.last_name), lower(p.first_name)
    LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(showDeleted ? { deleted: "1" } : {}), page: String(p) })}`;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Jugadores</h1>
        <form className="row" style={{ minWidth: 280 }}>
          <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre, código o documento" />
          <button className="btn">Buscar</button>
        </form>
      </div>

      {can(u, "players.manage") && (
        <details className="card" open={sp.new === "1"}>
          <summary>+ Nuevo jugador</summary>
          <div style={{ marginTop: 12 }}>
            <ActionForm action={createPlayerAction} resetOnSuccess>
              <PlayerFields />
              <label className="checkbox" style={{ marginBottom: 12 }}><input type="checkbox" name="__force" value="1" /> Crear igual aunque exista alguien con el mismo nombre</label>
              <input type="hidden" name="__return" value="/admin/players" />
              <Submit className="btn primary">Crear jugador</Submit>
            </ActionForm>
          </div>
        </details>
      )}

      <div className="card flush">
        <div className="card-head">
          <span className="muted">{total} jugador(es)</span>
          <Link href={showDeleted ? "?" : "?deleted=1"} className="muted" style={{ fontSize: 13 }}>{showDeleted ? "Ocultar dados de baja" : "Mostrar dados de baja"}</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Jugador</th><th className="hide-sm">Género</th><th className="hide-sm">Ciudad</th><th className="num">Torneos</th><th className="num">Puntos</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.deleted_at ? "out" : ""}>
                  <td><code>{p.code}</code></td>
                  <td><Link href={`/admin/players/${p.id}`}><b>{p.last_name}</b>, {p.first_name}</Link></td>
                  <td className="hide-sm">{p.gender === "M" ? "Masc." : p.gender === "F" ? "Fem." : "—"}</td>
                  <td className="hide-sm">{p.city ?? ""}</td>
                  <td className="num">{p.events}</td>
                  <td className="num"><b>{p.points}</b></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="empty">No hay jugadores{q ? " que coincidan con la búsqueda" : " todavía"}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {pages > 1 && (
        <div className="row">
          {page > 1 && <Link className="btn ghost sm" href={qs(page - 1)}>← Anterior</Link>}
          <span className="muted">Página {page} de {pages}</span>
          {page < pages && <Link className="btn ghost sm" href={qs(page + 1)}>Siguiente →</Link>}
        </div>
      )}
    </div>
  );
}
