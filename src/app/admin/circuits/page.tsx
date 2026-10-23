import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { LogoInput } from "@/components/LogoInput";
import { Icon } from "@/components/Icon";
import { fmtDate } from "@/lib/format";
import { createCircuitAction, updateCircuitAction, deleteCircuitAction } from "@/server/actions/admin";

export const metadata = { title: "Circuitos" };

type Row = { id: string; name: string; description: string | null; logo: string | null; tournaments: number; players: number; next_name: string | null; next_date: string | null };

export default async function CircuitsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const manage = can(u, "tournaments.manage");
  const rows = await sql<Row[]>`
    SELECT c.id, c.name, c.description, c.logo,
      (SELECT count(*)::int FROM tournaments t WHERE t.circuit_id = c.id) AS tournaments,
      (SELECT count(DISTINCT ep.player_id)::int FROM entry_players ep JOIN tournament_categories tc ON tc.id = ep.tc_id JOIN tournaments t ON t.id = tc.tournament_id WHERE t.circuit_id = c.id) AS players,
      (SELECT t.name FROM tournaments t WHERE t.circuit_id = c.id AND t.end_date >= current_date AND t.status <> 'CANCELLED' ORDER BY t.start_date LIMIT 1) AS next_name,
      (SELECT t.start_date FROM tournaments t WHERE t.circuit_id = c.id AND t.end_date >= current_date AND t.status <> 'CANCELLED' ORDER BY t.start_date LIMIT 1)::text AS next_date
    FROM circuits c WHERE c.org_id = ${u.orgId} ORDER BY c.name`;
  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="form-eyebrow">Organizador</div>
          <h1 className="form-title" style={{ marginBottom: 6 }}>Circuitos</h1>
          <p className="muted" style={{ margin: 0 }}>Un circuito (ej. BLOKO PADEL TOUR) agrupa varios torneos o fechas (ej. Italia, Miami) y tiene su propio ranking.</p>
        </div>
      </div>

      <div className="tgrid">
        {rows.map((c) => (
          <article key={c.id} className="circuit-card">
            <div className="row" style={{ gap: 16, alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.logo ? <img className="tcard2-logo" src={c.logo} alt="" /> : <span className="tcard2-logo initial">{c.name[0]?.toUpperCase()}</span>}
              <div style={{ minWidth: 0 }}>
                <h3 className="tcard2-name" style={{ margin: 0 }}>{c.name}</h3>
                {c.description && <div className="muted" style={{ fontSize: 14 }}>{c.description}</div>}
              </div>
            </div>
            <div className="tcard2-foot">
              <div className="tstat"><Icon name="trophy" size={20} /><span><b>{c.tournaments}</b><small>Torneos</small></span></div>
              <div className="tstat"><Icon name="users" size={20} /><span><b>{c.players}</b><small>Jugadores</small></span></div>
              {c.next_name && <div className="tstat"><Icon name="calendar" size={20} /><span><b style={{ fontSize: 15 }}>{c.next_name}</b><small>Próximo · {fmtDate(c.next_date!)}</small></span></div>}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <Link className="btn ghost sm" href={`/admin/tournaments?circuit=${c.id}`}>Ver torneos</Link>
              {manage && <Link className="btn primary sm" href={`/admin/tournaments/new?circuit=${c.id}`}>+ Nuevo torneo en este circuito</Link>}
              <Link className="btn ghost sm" href={`/admin/ranking?circuit=${c.id}`}>🏆 Ranking</Link>
              {manage && <Link className="btn ghost sm" href={`?edit=${c.id}#c-${c.id}`}>Editar</Link>}
            </div>
            {manage && sp.edit === c.id && (
              <div id={`c-${c.id}`} className="venue-box" style={{ marginTop: 14 }}>
                <ActionForm action={updateCircuitAction}>
                  <input type="hidden" name="circuit_id" value={c.id} />
                  <div className="field"><label>Nombre</label><input name="name" defaultValue={c.name} required /></div>
                  <div className="field"><label>Descripción</label><input name="description" defaultValue={c.description ?? ""} placeholder="Ej. Tour internacional 2026" /></div>
                  <div className="field"><label>Logo del circuito</label><LogoInput value={c.logo} /></div>
                  <Submit className="btn sm">Guardar</Submit>
                </ActionForm>
                <ActionForm action={deleteCircuitAction}>
                  <input type="hidden" name="circuit_id" value={c.id} />
                  <Submit className="btn danger sm" pendingText="Revisando…">Eliminar circuito</Submit>
                </ActionForm>
              </div>
            )}
          </article>
        ))}
        {rows.length === 0 && <div className="card empty">Todavía no hay circuitos. Creá el primero acá abajo.</div>}
      </div>

      {manage && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2>Nuevo circuito</h2>
          <ActionForm action={createCircuitAction} resetOnSuccess>
            <div className="field"><label>Nombre *</label><input name="name" required placeholder="Ej. BLOKO PADEL TOUR" /></div>
            <div className="field"><label>Descripción</label><input name="description" placeholder="Ej. Tour internacional 2026" /></div>
            <div className="field"><label>Logo</label><LogoInput /><div className="hint">Lo usan las tarjetas de los torneos del circuito que no tengan logo propio.</div></div>
            <Submit className="btn primary">Crear circuito</Submit>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
