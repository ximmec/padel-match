import Link from "next/link";
import { sql } from "@/server/db";
import { getCurrentPlayer } from "@/server/playerAuth";
import { vapidKeys } from "@/server/notify";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PushSetup } from "@/components/PushSetup";
import { InstallApp } from "@/components/InstallApp";
import { playerLinkRequestAction, playerLogoutAction, markAllReadAction, playerProfileAction, playerDeleteSelfAction } from "@/server/actions/jugadores";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Mi Padel Match" };

export default async function PlayerHome({ searchParams }: { searchParams: Promise<{ instalar?: string }> }) {
  const { instalar } = await searchParams;
  const p = await getCurrentPlayer();
  if (!p) return <Landing install={instalar === "1"} />;

  const { publicKey } = await vapidKeys();
  const inbox = await sql<{ id: string; title: string; body: string; url: string | null; created_at: Date; read_at: Date | null }[]>`
    SELECT n.id, n.title, n.body, n.url, n.created_at, r.read_at FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id
    WHERE r.account_id = ${p.id} ORDER BY n.created_at DESC LIMIT 30`;
  const unread = inbox.filter((n) => !n.read_at).length;

  const linked = p.linkStatus === "APPROVED" && p.playerId;
  const [player] = linked ? await sql<{ first_name: string; last_name: string; code: string; category: string | null }[]>`SELECT first_name, last_name, code, category FROM players WHERE id = ${p.playerId}` : [];
  const myCats = linked ? await sql<{ tc_id: string; tournament: string; slug: string; category: string; start_date: string; status: string; partner: string | null }[]>`
    SELECT tc.id AS tc_id, t.name AS tournament, t.slug, c.name AS category, t.start_date::text AS start_date, t.status,
      (SELECT string_agg(p2.first_name || ' ' || p2.last_name, ' / ') FROM entry_players ep2 JOIN players p2 ON p2.id = ep2.player_id
        WHERE ep2.entry_id = e.id AND ep2.replaced_at IS NULL AND ep2.player_id <> ${p.playerId}) AS partner
    FROM entry_players ep JOIN entries e ON e.id = ep.entry_id AND e.status = 'ACTIVE'
    JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id JOIN categories c ON c.id = tc.category_id
    WHERE ep.player_id = ${p.playerId} AND ep.replaced_at IS NULL AND t.status IN ('OPEN','IN_PROGRESS')
    ORDER BY t.start_date` : [];
  const upcoming = linked ? await sql<{ id: string; scheduled_at: Date | null; court: string | null; status: string; tournament: string; slug: string; tc_id: string; category: string; stage: string; rival: string | null }[]>`
    WITH mine AS (
      SELECT DISTINCT ep.entry_id FROM entry_players ep JOIN entries e ON e.id = ep.entry_id AND e.status = 'ACTIVE'
      WHERE ep.player_id = ${p.playerId} AND ep.replaced_at IS NULL
    )
    SELECT m.id, m.scheduled_at, co.name AS court, m.status, t.name AS tournament, t.slug, tc.id AS tc_id, c.name AS category,
      COALESCE('Zona ' || z.name, 'Cuadro') AS stage,
      (SELECT string_agg(pl.last_name, ' / ' ORDER BY ep.slot) FROM entry_players ep JOIN players pl ON pl.id = ep.player_id
        WHERE ep.entry_id = CASE WHEN m.entry_a = mine.entry_id THEN m.entry_b ELSE m.entry_a END AND ep.replaced_at IS NULL) AS rival
    FROM mine JOIN matches m ON (m.entry_a = mine.entry_id OR m.entry_b = mine.entry_id) AND m.status IN ('PENDING','IN_PLAY')
    JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id AND t.status IN ('OPEN','IN_PROGRESS')
    JOIN categories c ON c.id = tc.category_id LEFT JOIN zones z ON z.id = m.zone_id LEFT JOIN courts co ON co.id = m.court_id
    ORDER BY m.status = 'IN_PLAY' DESC, m.scheduled_at NULLS LAST LIMIT 12` : [];

  return (
    <main className="container narrow stack me-page">
      <section className="me-head">
        <div>
          <div className="part-kicker">Mi Padel Match</div>
          <h1 className="me-title">Hola, {p.name.split(" ")[0]} 👋</h1>
          <div className="muted">{p.email}</div>
        </div>
        <form action={playerLogoutAction}><button className="btn ghost sm">Salir</button></form>
      </section>

      <PushSetup vapidKey={publicKey} />

      {!linked && (
        <section className="card me-card">
          <h2>Vinculá tu ficha de jugador</h2>
          {p.linkStatus === "PENDING" ? (
            <div className="alert info">⏳ Tu pedido está en revisión: la organización va a confirmar que sos vos. Mientras tanto ya podés recibir avisos generales.{p.linkNote ? <><br /><small>{p.linkNote}</small></> : null}</div>
          ) : (
            <p className="muted">Así te mostramos tus partidos y te avisamos de tus horarios, canchas y clasificaciones.</p>
          )}
          <ActionForm action={playerLinkRequestAction}>
            <div className="fgrid">
              <div className="field"><label>Tu nombre y apellido como figura en los torneos</label><input name="as_name" defaultValue={p.name} required maxLength={80} /></div>
              <div className="field"><label>DNI (opcional)</label><input name="as_document" inputMode="numeric" maxLength={15} /></div>
            </div>
            <Submit className="btn sm">{p.linkStatus === "PENDING" ? "Actualizar pedido" : "Pedir vínculo"}</Submit>
          </ActionForm>
        </section>
      )}

      {linked && player && (
        <section className="card me-card">
          <div className="row between"><h2 style={{ margin: 0 }}>Mis torneos</h2><span className="badge ok">Ficha vinculada · {player.first_name} {player.last_name}{player.category ? ` · ${player.category}` : ""}</span></div>
          {myCats.length === 0 && <p className="muted">No estás inscripto en torneos activos.</p>}
          <div className="me-list">
            {myCats.map((c) => (
              <Link key={c.tc_id} href={`/t/${c.slug}/c/${c.tc_id}`} className="me-item">
                <b>{c.tournament}</b><span>{c.category}{c.partner ? ` · con ${c.partner}` : ""}</span>
              </Link>
            ))}
          </div>
          {upcoming.length > 0 && <>
            <h3 style={{ marginTop: 18 }}>Mis próximos partidos</h3>
            <div className="me-list">
              {upcoming.map((m) => (
                <Link key={m.id} href={`/t/${m.slug}/c/${m.tc_id}`} className={`me-item ${m.status === "IN_PLAY" ? "live" : ""}`}>
                  <b>{m.scheduled_at ? fmtDateTime(m.scheduled_at) : "Horario a confirmar"}{m.court ? ` · ${m.court}` : ""}</b>
                  <span>{m.status === "IN_PLAY" ? "🔴 En juego · " : ""}vs {m.rival ?? "a definir"} · {m.category} · {m.stage}</span>
                </Link>
              ))}
            </div>
          </>}
        </section>
      )}

      <section className="card me-card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Avisos {unread > 0 && <span className="badge info">{unread} nuevo{unread > 1 ? "s" : ""}</span>}</h2>
          {unread > 0 && <form action={markAllReadAction}><button className="btn ghost sm">Marcar como leídos</button></form>}
        </div>
        {inbox.length === 0 && <p className="muted">Todavía no recibiste avisos.</p>}
        <div className="me-list">
          {inbox.map((n) => (
            <a key={n.id} href={n.url || "#"} className={`me-item ${n.read_at ? "" : "unread"}`}>
              <b>{n.title}</b><span>{n.body}</span><small>{fmtDateTime(n.created_at)}</small>
            </a>
          ))}
        </div>
      </section>

      <details className="card me-card">
        <summary><b>Mis datos</b></summary>
        <ActionForm action={playerProfileAction}>
          <div className="fgrid">
            <div className="field"><label>Nombre y apellido</label><input name="name" defaultValue={p.name} required maxLength={80} /></div>
            <div className="field"><label>Celular</label><input name="phone" type="tel" defaultValue={p.phone ?? ""} maxLength={30} /></div>
          </div>
          <Submit className="btn sm">Guardar</Submit>
        </ActionForm>
        <div className="auth-divider" />
        <ActionForm action={playerDeleteSelfAction}>
          <label>Borrar mi cuenta (escribí BORRAR)</label>
          <div className="row"><input name="confirm" className="sm" placeholder="BORRAR" /><Submit className="btn danger sm">Borrar cuenta</Submit></div>
          <div className="hint">Se borra tu cuenta de la app y tus avisos. Tus resultados en los torneos no se tocan.</div>
        </ActionForm>
      </details>
    </main>
  );
}

function Landing({ install }: { install: boolean }) {
  return (
    <main className="container narrow stack me-page">
      <section className="me-landing">
        <div className="part-kicker">Para jugadores · Bloko Padel Tour</div>
        <h1 className="me-title">Mi Padel Match</h1>
        <p className="muted" style={{ fontSize: 17 }}>Tus partidos, horarios y canchas en un solo lugar, y <b>avisos en tu celular</b>: cuándo jugás, en qué cancha, si cambió el horario y cuándo clasificás.</p>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn primary pill lg" href="/jugadores/registro">Crear cuenta gratis</Link>
          <Link className="btn ghost pill lg" href="/jugadores/ingresar">Ya tengo cuenta</Link>
        </div>
      </section>
      <InstallApp variant="card" autoOpen={install} />
    </main>
  );
}
