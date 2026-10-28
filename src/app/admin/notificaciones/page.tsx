import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Forbidden } from "@/components/views";
import { sendNotificationAction, setAccountLinkAction, deleteAccountAction, resetPlayerPasswordAction } from "@/server/actions/jugadores";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Notificaciones" };

type Acc = { lang: string; id: string; name: string; email: string; phone: string | null; document: string | null; link_status: string; link_note: string | null; active: boolean; created_at: Date; last_seen_at: Date | null; player_id: string | null; player_name: string | null; devices: number };

const TABS: [string, string][] = [["enviar", "Enviar"], ["jugadores", "Jugadores registrados"], ["historial", "Historial"]];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const u = await requireUser();
  if (!can(u, "tournaments.manage") || (u.role !== "ADMIN" && !u.isSuperadmin)) return <Forbidden />;
  const { tab = "enviar", q = "" } = await searchParams;

  const accounts = await sql<Acc[]>`
    SELECT a.lang, a.id, a.name, a.email, a.phone, a.document, a.link_status, a.link_note, a.active, a.created_at, a.last_seen_at, a.player_id,
      CASE WHEN p.id IS NULL THEN NULL ELSE p.first_name || ' ' || p.last_name END AS player_name,
      (SELECT count(*)::int FROM push_subscriptions s WHERE s.account_id = a.id) AS devices
    FROM player_accounts a LEFT JOIN players p ON p.id = a.player_id
    WHERE a.org_id = ${u.orgId} ORDER BY lower(a.name)`;
  const pending = accounts.filter((a) => a.link_status === "PENDING");
  const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = q ? accounts.filter((a) => fold(`${a.name} ${a.email} ${a.player_name ?? ""}`).includes(fold(q))) : accounts;
  const withDevice = accounts.filter((a) => a.devices > 0).length;
  const tournaments = await sql<{ id: string; name: string }[]>`SELECT id, name FROM tournaments WHERE org_id = ${u.orgId} AND status IN ('OPEN','IN_PROGRESS','DRAFT') ORDER BY start_date DESC`;

  return (
    <div className="stack">
      <div>
        <div className="form-eyebrow">Administrador general</div>
        <h1 className="form-title" style={{ marginBottom: 6 }}>Notificaciones</h1>
        <p className="muted" style={{ margin: 0 }}>
          {accounts.length} jugador{accounts.length === 1 ? "" : "es"} con cuenta · {withDevice} con notificaciones activadas en el celular.
          Los jugadores se registran en <a href="/jugadores" target="_blank">padel-match.net/jugadores</a>.
        </p>
      </div>
      {pending.length > 0 && tab !== "jugadores" && (
        <div className="alert warn">Hay {pending.length} pedido{pending.length > 1 ? "s" : ""} de vínculo para revisar. <Link href="?tab=jugadores">Revisar</Link></div>
      )}
      <nav className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={tab === k ? "active" : ""}>{l}{k === "jugadores" && pending.length ? ` (${pending.length})` : ""}</Link>)}</nav>

      {tab === "enviar" && (
        <ActionForm action={sendNotificationAction} resetOnSuccess>
          <div className="card stack">
            <div className="fgrid">
              <div className="field span-2"><label>Título</label><input name="title" required maxLength={80} placeholder="Ej. Cambio de horario" /></div>
              <div className="field span-2"><label>Mensaje</label><textarea name="body" required maxLength={500} rows={3} placeholder="Ej. Tu partido de las 18:00 pasa a la cancha 3." /></div>
              <details className="span-2 en-box">
                <summary>🇬🇧 Versión en inglés (opcional)</summary>
                <p className="muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>Los jugadores que usan la app en inglés reciben este texto. Si lo dejás vacío, les llega en español.</p>
                <div className="field"><label>Title (inglés)</label><input name="title_en" maxLength={80} placeholder="E.g. Schedule change" /></div>
                <div className="field"><label>Message (inglés)</label><textarea name="body_en" maxLength={500} rows={3} placeholder="E.g. Your 6 pm match moves to court 3." /></div>
              </details>
              <div className="field span-2"><label>Al tocar la notificación, abrir (opcional)</label><input name="url" placeholder="/t/nombre-del-torneo  (vacío = Mi Padel Match)" maxLength={300} />
                <div className="hint">Una página de Padel Match (empieza con /) o un enlace https://</div></div>
            </div>
            <div className="field"><label>¿A quién?</label>
              <div className="send-to">
                <label className="checkbox"><input type="radio" name="to" value="ALL" defaultChecked /> Todos los registrados ({accounts.filter((a) => a.active).length})</label>
                <label className="checkbox"><input type="radio" name="to" value="TOURNAMENT" /> Los jugadores de un torneo:</label>
                <select name="tournament_id" className="sm" defaultValue={tournaments[0]?.id ?? ""}>{tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <label className="checkbox"><input type="radio" name="to" value="SELECTED" /> Solo los que marque en la lista de abajo</label>
              </div>
            </div>
            <Submit className="btn primary" pendingText="Enviando…">📣 Enviar notificación</Submit>
          </div>
          <div className="card flush" style={{ marginTop: 14 }}>
            <div className="card-head"><h3>Elegir jugadores</h3><span className="muted">Marcá y elegí «Solo los que marque»</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th></th><th>Jugador</th><th>Ficha</th><th>Idioma</th><th className="num">Celulares</th></tr></thead>
              <tbody>
                {accounts.filter((a) => a.active).map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" name="acc" value={a.id} aria-label={`Elegir a ${a.name}`} /></td>
                    <td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.email}</div></td>
                    <td>{a.link_status === "APPROVED" ? a.player_name : a.link_status === "PENDING" ? <span className="badge warn">Pendiente</span> : <span className="muted">—</span>}</td>
                    <td>{a.lang === "en" ? "🇬🇧" : "🇪🇸"}</td>
                    <td className="num">{a.devices ? `🔔 ${a.devices}` : <span className="muted">0</span>}</td>
                  </tr>
                ))}
                {accounts.length === 0 && <tr><td colSpan={5} className="empty">Todavía no hay jugadores registrados.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </ActionForm>
      )}

      {tab === "jugadores" && <Accounts orgId={u.orgId} accounts={shown} pending={pending} q={q} />}
      {tab === "historial" && <History orgId={u.orgId} />}
    </div>
  );
}

async function Accounts({ orgId, accounts: list, pending, q }: { orgId: string; accounts: Acc[]; pending: Acc[]; q: string }) {
  const players = await sql<{ id: string; label: string }[]>`
    SELECT id, last_name || ', ' || first_name || coalesce(' · ' || category, '') || ' (' || code || ')' AS label
    FROM players WHERE org_id = ${orgId} AND deleted_at IS NULL ORDER BY lower(last_name), lower(first_name)`;
  return (
    <div className="stack">
      {pending.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Pedidos de vínculo</h2>
          <p className="muted" style={{ margin: 0 }}>Confirmá qué ficha de jugador corresponde a cada cuenta. Así le llegan los avisos de sus partidos.</p>
          {pending.map((a) => (
            <ActionForm key={a.id} action={setAccountLinkAction} className="link-row">
              <input type="hidden" name="account_id" value={a.id} />
              <div><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.email}{a.document ? ` · DNI ${a.document}` : ""}{a.link_note ? ` · ${a.link_note}` : ""}</div></div>
              <select name="player_id" className="sm" defaultValue={a.player_id ?? ""}>
                <option value="">Elegir ficha…</option>
                {players.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <div className="row">
                <button className="btn primary sm" type="submit" name="op" value="APPROVE">✓ Vincular</button>
                <button className="btn ghost sm" type="submit" name="op" value="REJECT">Rechazar</button>
              </div>
            </ActionForm>
          ))}
        </div>
      )}
      <div className="card flush">
        <div className="card-head">
          <h3>Jugadores registrados ({list.length})</h3>
          <form className="row"><input type="hidden" name="tab" value="jugadores" /><input name="q" className="sm" defaultValue={q} placeholder="Buscar…" /><button className="btn sm">Buscar</button></form>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Jugador</th><th>Ficha vinculada</th><th className="num">Celulares</th><th>Alta</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className={a.active ? "" : "out"}>
                <td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.email}{a.phone ? ` · ${a.phone}` : ""}</div></td>
                <td>{a.link_status === "APPROVED" ? <span className="badge ok">{a.player_name}</span> : a.link_status === "PENDING" ? <span className="badge warn">Pendiente</span> : <span className="muted">Sin vincular</span>}{!a.active && <> <span className="badge err">Bloqueada</span></>}</td>
                <td className="num">{a.devices ? `🔔 ${a.devices}` : "0"}</td>
                <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</td>
                <td>
                  <details>
                    <summary className="muted" style={{ fontSize: 13 }}>Acciones</summary>
                    <div className="stack" style={{ marginTop: 8, minWidth: 260 }}>
                      <ActionForm action={setAccountLinkAction} className="row">
                        <input type="hidden" name="account_id" value={a.id} />
                        <select name="player_id" className="sm" defaultValue=""><option value="">Vincular con ficha…</option>{players.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                        <button className="btn sm" type="submit" name="op" value="APPROVE">Vincular</button>
                      </ActionForm>
                      <ActionForm action={setAccountLinkAction} className="row">
                        <input type="hidden" name="account_id" value={a.id} />
                        {a.link_status === "APPROVED" && <button className="btn ghost sm" type="submit" name="op" value="UNLINK">Desvincular</button>}
                        <button className="btn ghost sm" type="submit" name="op" value={a.active ? "DISABLE" : "ENABLE"}>{a.active ? "Bloquear" : "Habilitar"}</button>
                      </ActionForm>
                      <ActionForm action={resetPlayerPasswordAction}>
                        <input type="hidden" name="account_id" value={a.id} />
                        <Submit className="btn ghost sm">Darle una contraseña nueva</Submit>
                      </ActionForm>
                      <ActionForm action={deleteAccountAction}>
                        <input type="hidden" name="account_id" value={a.id} />
                        <Submit className="btn danger sm">Eliminar cuenta</Submit>
                      </ActionForm>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="empty">{q ? "No hay jugadores con ese nombre." : "Todavía no hay jugadores registrados."}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

async function History({ orgId }: { orgId: string }) {
  const rows = await sql<{ id: string; kind: string; title: string; body: string; has_en: boolean; audience: string | null; created_at: Date; sender: string | null; total: number; sent: number; no_device: number; failed: number; pending: number; read: number }[]>`
    SELECT n.id, n.kind, n.title, n.body, (n.title_en IS NOT NULL OR n.body_en IS NOT NULL) AS has_en, n.audience, n.created_at, u.name AS sender,
      count(r.*)::int AS total,
      count(*) FILTER (WHERE r.push_status = 'SENT')::int AS sent,
      count(*) FILTER (WHERE r.push_status = 'NO_DEVICE')::int AS no_device,
      count(*) FILTER (WHERE r.push_status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE r.push_status IN ('PENDING','SENDING'))::int AS pending,
      count(r.read_at)::int AS read
    FROM notifications n LEFT JOIN notification_recipients r ON r.notification_id = n.id LEFT JOIN users u ON u.id = n.sent_by
    WHERE n.org_id = ${orgId} AND coalesce(n.audience, '') <> 'Prueba'
    GROUP BY n.id, u.name ORDER BY n.created_at DESC LIMIT 100`;
  return (
    <div className="card flush">
      <div className="card-head"><h3>Notificaciones enviadas</h3><span className="muted">Las automáticas también figuran acá.</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Notificación</th><th>A quién</th><th className="num">Llegó al celular</th><th className="num">Sin celular</th><th className="num">Leídas</th></tr></thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id}>
              <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDateTime(n.created_at)}</td>
              <td><b>{n.title}</b> {n.kind === "AUTO" && <span className="badge">Automática</span>} {n.has_en && <span className="badge info">🇬🇧 EN</span>}<div className="muted" style={{ fontSize: 13 }}>{n.body}</div></td>
              <td style={{ fontSize: 13 }}>{n.audience ?? "—"}{n.sender ? <div className="muted" style={{ fontSize: 12 }}>por {n.sender}</div> : null}</td>
              <td className="num">{n.sent}/{n.total}{n.pending ? <div className="muted" style={{ fontSize: 11 }}>{n.pending} enviando</div> : null}{n.failed ? <div className="muted" style={{ fontSize: 11 }}>{n.failed} con error</div> : null}</td>
              <td className="num">{n.no_device}</td>
              <td className="num">{n.read}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">Todavía no se enviaron notificaciones.</td></tr>}
        </tbody>
      </table></div>
      <p className="muted" style={{ fontSize: 12, padding: "8px 16px" }}>«Sin celular»: el jugador no activó las notificaciones en ningún dispositivo; igual lo ve en su bandeja dentro de Mi Padel Match.</p>
    </div>
  );
}
