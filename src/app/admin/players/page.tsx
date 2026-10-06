import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PlayerFields } from "@/components/PlayerFields";
import { createPlayerAction, importPlayersAction } from "@/server/actions/admin";

export const metadata = { title: "Jugadores" };
const PAGE = 50;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; new?: string; deleted?: string; import?: string; cat?: string; sexo?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const showDeleted = sp.deleted === "1";
  const cat = (sp.cat ?? "").trim();
  const sexo = sp.sexo === "M" || sp.sexo === "F" || sp.sexo === "X" ? sp.sexo : "";
  const categories = (await sql<{ category: string; n: number }[]>`
    SELECT category, count(*)::int AS n FROM players WHERE org_id = ${u.orgId} AND deleted_at IS NULL AND category IS NOT NULL
    GROUP BY category ORDER BY lower(category)`);
  const like = `%${q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}%`;
  const rows = await sql<{ id: string; code: string; first_name: string; last_name: string; gender: string; category: string | null; city: string | null; document: string | null; deleted_at: Date | null; points: number; events: number; total: number }[]>`
    SELECT p.id, p.code, p.first_name, p.last_name, p.gender, p.category, p.city, p.document, p.deleted_at,
      COALESCE((SELECT sum(points)::int FROM ranking_ledger l WHERE l.player_id = p.id AND l.superseded_at IS NULL), 0) AS points,
      (SELECT count(DISTINCT ep.tc_id)::int FROM entry_players ep WHERE ep.player_id = p.id) AS events,
      count(*) OVER()::int AS total
    FROM players p
    WHERE p.org_id = ${u.orgId}
      ${showDeleted ? sql`` : sql`AND p.deleted_at IS NULL`}
      ${cat === "__none" ? sql`AND p.category IS NULL` : cat ? sql`AND lower(p.category) = lower(${cat})` : sql``}
      ${sexo ? sql`AND p.gender = ${sexo}` : sql``}
      ${q ? sql`AND (translate(lower(p.first_name || ' ' || p.last_name), 'áéíóúüñ', 'aeiouun') LIKE ${like} OR translate(lower(p.last_name || ' ' || p.first_name), 'áéíóúüñ', 'aeiouun') LIKE ${like} OR lower(p.code) LIKE ${like} OR p.document LIKE ${like})` : sql``}
    ORDER BY lower(p.last_name), lower(p.first_name)
    LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(showDeleted ? { deleted: "1" } : {}), ...(cat ? { cat } : {}), ...(sexo ? { sexo } : {}), page: String(p) })}`;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Jugadores</h1>
        <form className="row" style={{ minWidth: 280 }}>
          <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre, código o documento" style={{ flex: 1, minWidth: 200 }} />
          <select name="cat" defaultValue={cat} className="sm" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.n})</option>)}
            <option value="__none">Sin categoría</option>
          </select>
          <select name="sexo" defaultValue={sexo} className="sm" aria-label="Sexo">
            <option value="">Todos</option><option value="M">Masculino</option><option value="F">Femenino</option>
          </select>
          <button className="btn">Buscar</button>
        </form>
      </div>

      {can(u, "players.manage") && (
        <details className="card" open={sp.new === "1"}>
          <summary>+ Nuevo jugador</summary>
          <div style={{ marginTop: 12 }}>
            <ActionForm action={createPlayerAction} resetOnSuccess>
              <PlayerFields categories={categories.map((c) => c.category)} />
              <label className="checkbox" style={{ marginBottom: 12 }}><input type="checkbox" name="__force" value="1" /> Crear igual aunque exista alguien con el mismo nombre</label>
              <input type="hidden" name="__return" value="/admin/players" />
              <Submit className="btn primary">Crear jugador</Submit>
            </ActionForm>
          </div>
        </details>
      )}

      {can(u, "players.manage") && (
        <details className="card" open={sp.import === "1" || total === 0}>
          <summary>📥 Importar jugadores desde Excel</summary>
          <div style={{ marginTop: 12 }} className="stack">
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
              <li>Tu Excel tiene que tener en la <b>primera fila los títulos</b> de las columnas. Se reconocen: <b>Nombre</b>, <b>Apellido</b> (o una sola columna <b>Nombre y apellido</b>), <b>Sexo/Género</b>, <b>Categoría</b>, <b>DNI</b>, <b>Teléfono/Celular</b>, <b>Email</b> y <b>Ciudad</b>. Solo nombre y apellido son obligatorios.</li>
              <li>Elegí el archivo y tocá <b>Revisar</b>. Antes de cargar nada te muestro un resumen: cuántos son nuevos, cuáles ya existían y si alguna fila tiene problemas.</li>
              <li>Si está todo bien, tocá <b>Confirmar y aplicar</b>.</li>
            </ol>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>¿No sabés cómo armarlo? <a href="/api/export?type=players-template">Descargá esta planilla modelo</a> y completala.</p>
            <ActionForm action={importPlayersAction}>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="field"><label>Archivo (.xlsx o .csv)</label><input type="file" name="file" accept=".xlsx,.csv" required /></div>
                <div className="field"><label>Si el Excel no tiene columna de género, usar:</label>
                  <select name="default_gender" defaultValue="">
                    <option value="">— Mi Excel tiene la columna de género —</option>
                    <option value="M">Todos masculinos</option>
                    <option value="F">Todas femeninas</option>
                  </select>
                  <div className="hint">Si la columna existe pero alguna celda está vacía, también se usa esta opción.</div>
                </div>
              </div>
              <Submit className="btn primary" pendingText="Leyendo el archivo…">Revisar</Submit>
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
            <thead><tr><th>Código</th><th>Jugador</th><th>Categoría</th><th className="hide-sm">Género</th><th className="hide-sm">Ciudad</th><th className="num">Torneos</th><th className="num">Puntos</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.deleted_at ? "out" : ""}>
                  <td><code>{p.code}</code></td>
                  <td><Link href={`/admin/players/${p.id}`}><b>{p.last_name}</b>, {p.first_name}</Link></td>
                  <td>{p.category ? <span className="badge">{p.category}</span> : <span className="muted">—</span>}</td>
                  <td className="hide-sm">{p.gender === "M" ? "Masc." : p.gender === "F" ? "Fem." : "—"}</td>
                  <td className="hide-sm">{p.city ?? ""}</td>
                  <td className="num">{p.events}</td>
                  <td className="num"><b>{p.points}</b></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="empty">No hay jugadores{q ? " que coincidan con la búsqueda" : " todavía"}.</td></tr>}
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
