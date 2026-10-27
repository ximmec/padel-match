import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can, type CurrentUser } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { loadCategory, categoryCap, entryLabel, entryFullLabel, restrictionLabel, type LoadedCategory, zoneSideLabel } from "@/server/category";
import { ActionForm, Submit } from "@/components/ActionForm";
import { ResultForm } from "@/components/ResultForm";
import { StatusBadge, StandingsTable, BracketView, SetScores, winnerSide } from "@/components/views";
import * as A from "@/server/actions/competition";
import { planZoneSizes } from "@/core/zones";
import { TIEBREAK_LABELS, DEFAULT_TIEBREAKS, type TiebreakCriterion } from "@/core/standings";
import { STAGE_LABELS, STAGE_ORDER, roundName } from "@/core/bracket";
import { FORMATS, formatLabel, scoreText, type MatchOutcome } from "@/core/scoring";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fmtMoney } from "@/lib/cardBg";
import { ResetForm } from "@/components/ResetForm";
import { PairPlayerSelects } from "@/components/PairPlayerSelects";
import { ManualZones } from "@/components/ManualZones";
import { BracketSlotMenu } from "@/components/BracketSlotMenu";
import { PLAYER_CATEGORIES } from "@/core/playerImport";

const TABS: [string, string][] = [
  ["inscripciones", "Inscripciones"],
  ["zonas", "Zonas"],
  ["partidos", "Partidos"],
  ["posiciones", "Posiciones"],
  ["cuadro", "Cuadro"],
  ["reglas", "Reglas"],
  ["historial", "Historial"],
];

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ id: string; tcId: string }>; searchParams: Promise<{ tab?: string; e?: string }> }) {
  const { id, tcId } = await params;
  const { tab = "inscripciones", e: focus } = await searchParams;
  if (!isUuid(id) || !isUuid(tcId)) notFound();
  const u = await requireUser();
  let lc: LoadedCategory;
  try { lc = await loadCategory(sql, tcId, u.orgId); } catch { notFound(); }
  if (lc.tc.tournament_id !== id) notFound();
  const active = lc.entries.filter((e) => e.status === "ACTIVE");
  const siblings = await sql<{ id: string; name: string }[]>`SELECT tc.id, c.name FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = ${id} ORDER BY c.name`;
  const isByeMatch = (code: string | null) => {
    const d = lc.tc.bracket.find((x) => x.code === code);
    const rm = lc.view.bracket.find((x) => x.code === code);
    return !!d && (d.a.t === "BYE" || d.b.t === "BYE" || !!rm?.byeAdvance || (rm?.a.kind === "BYE" && rm?.b.kind === "BYE"));
  };
  const pending = lc.matches.filter((m) => m.status !== "PLAYED" && m.status !== "ANNULLED" && !(m.phase === "BRACKET" && isByeMatch(m.bracket_code))).length;

  return (
    <div className="stack">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link className="back-link" style={{ marginBottom: 0 }} href={`/admin/tournaments/${id}`}>← Volver al torneo <b>{lc.tc.tournament_name}</b></Link>
        {siblings.length > 1 && (
          <div className="chips">{siblings.map((c) => <Link key={c.id} href={`/admin/tournaments/${id}/c/${c.id}?tab=${tab}`} className={c.id === tcId ? "active" : ""}>{c.name}</Link>)}</div>
        )}
      </div>
      <div className="page-head">
        <div>
          <h1>{lc.tc.category_name}</h1>
          <div className="row"><StatusBadge status={lc.tc.status} /><span className="muted">{active.length}{categoryCap(lc) ? `/${categoryCap(lc)}` : ""} parejas · {lc.zones.length} zonas · {pending} partidos pendientes · {formatLabel(lc.rules.format)}</span></div>
        </div>
        <div className="row">
          {can(u, "exports.download") && <a className="btn ghost sm" href={`/api/export?type=category&tc=${tcId}`}>📊 Excel</a>}
          <Link className="btn ghost sm" href={`/t/${lc.tc.tournament_slug}/c/${tcId}`} target="_blank">Vista pública ↗</Link>
        </div>
      </div>
      {lc.view.errors.length > 0 && <div className="alert err">Hay {lc.view.errors.length} resultado(s) que no son válidos con el formato actual. Revisalos en Partidos.</div>}
      <nav className="tabs">
        {TABS.map(([k, label]) => <Link key={k} href={`?tab=${k}`} className={tab === k ? "active" : ""}>{label}</Link>)}
      </nav>
      {tab === "inscripciones" && <EntriesTab lc={lc} u={u} focus={focus} />}
      {tab === "zonas" && <ZonesTab lc={lc} u={u} />}
      {tab === "partidos" && <MatchesTab lc={lc} u={u} />}
      {tab === "posiciones" && <StandingsTab lc={lc} u={u} />}
      {tab === "cuadro" && <BracketTab lc={lc} u={u} />}
      {tab === "reglas" && <RulesTab lc={lc} u={u} />}
      {tab === "historial" && <HistoryTab lc={lc} />}
      {can(u, "tournaments.manage") && (tab === "reglas" || tab === "zonas" || tab === "historial") && <ResetForm scope="category" id={lc.tc.id} />}
    </div>
  );
}

/* ---------------------------------------------------------------- */

async function EntriesTab({ lc, u, focus }: { lc: LoadedCategory; u: CurrentUser; focus?: string }) {
  const genderFilter = lc.tc.gender_rule === "MALE" ? ["M", "X"] : lc.tc.gender_rule === "FEMALE" ? ["F", "X"] : ["M", "F", "X"];
  const players = await sql<{ id: string; code: string; first_name: string; last_name: string; gender: string; category: string | null; busy: boolean }[]>`
    SELECT p.id, p.code, p.first_name, p.last_name, p.gender, p.category,
      EXISTS (SELECT 1 FROM entry_players ep WHERE ep.player_id = p.id AND ep.tc_id = ${lc.tc.id} AND ep.active) AS busy
    FROM players p WHERE p.org_id = ${u.orgId} AND p.deleted_at IS NULL AND p.gender = ANY(${genderFilter})
    ORDER BY lower(p.last_name), lower(p.first_name)`;
  const free = players.filter((p) => !p.busy);
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const level = PLAYER_CATEGORIES.find((c) => fold(lc.tc.category_name).includes(fold(c))) ?? null;
  const labelOf = (p: (typeof players)[number]) => `${p.last_name}, ${p.first_name}${p.category ? ` · ${p.category}` : ""} (${p.code})${p.gender === "X" ? " · sin definir" : lc.tc.gender_rule === "MIXED" ? ` · ${p.gender}` : ""}`;
  const optGroups = (list: (typeof players)[number][]) => level ? (
    <>
      <optgroup label={level}>{list.filter((p) => p.category === level).map(opt)}</optgroup>
      <optgroup label="Otras categorías">{list.filter((p) => p.category !== level).map(opt)}</optgroup>
    </>
  ) : list.map(opt);
  const opt = (p: (typeof players)[number]) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}{p.category ? ` · ${p.category}` : ""} ({p.code}){p.gender === "X" ? " · sin definir" : lc.tc.gender_rule === "MIXED" ? ` · ${p.gender}` : ""}</option>;
  const manage = can(u, "players.manage");
  const zoneOf = new Map(lc.zones.flatMap((z) => z.entry_ids.map((e) => [e, z.name] as const)));

  const active = lc.entries.filter((e) => e.status === "ACTIVE");
  const cap = categoryCap(lc);
  const full = !!cap && active.length >= cap;
  const [t] = await sql<{ start_date: string; start_time: string | null; entry_fee: number | null; venue: string | null }[]>`
    SELECT t.start_date::text AS start_date, to_char(t.start_time, 'HH24:MI') AS start_time, t.entry_fee, v.name AS venue
    FROM tournaments t LEFT JOIN venues v ON v.id = t.venue_id WHERE t.id = ${lc.tc.tournament_id}`;
  const ps = active.flatMap((e) => e.players);
  const paid = ps.filter((p) => p.paid_at).length;
  const collected = t?.entry_fee ? Math.round((t.entry_fee * paid) / 2) : null;
  const setsLabel: Record<string, string> = { ONE_SET: "1 set", PRO_SET_9: "Set a 9", BEST_OF_3_STB: "2 sets + STB", BEST_OF_3: "3 sets" };
  const rf = lc.rules.format;
  const fmtKey = Object.entries(FORMATS).find(([, f]) => f.setsToWin === rf.setsToWin && f.gamesPerSet === rf.gamesPerSet && f.superTiebreakDecider === rf.superTiebreakDecider)?.[0];
  const sets = (fmtKey && setsLabel[fmtKey]) ?? formatLabel(lc.rules.format);

  return (
    <div className="stack part">
      <section className="part-head">
        <div>
          <div className="part-kicker">Organizador</div>
          <h2 className="part-title">Participantes oficiales</h2>
          <div className="muted">{lc.tc.tournament_name} · {lc.tc.category_name}{t ? ` · ${fmtDate(t.start_date)}` : ""}{t?.start_time ? ` · ${t.start_time}` : ""}</div>
          {t?.venue && <div className="muted dim">{t.venue}</div>}
        </div>
        <div className="row">
          <Link className="btn lime-ghost" href={`?tab=${lc.rules.mode === "KNOCKOUT" ? "cuadro" : "zonas"}`}>Ver estructura</Link>
          <Link className="btn ghost" href={`/admin/tournaments/${lc.tc.tournament_id}`}>Volver</Link>
        </div>
      </section>

      <div className="part-stats">
        <div className="pstat"><div className="l">Formato</div><div className="v">{lc.rules.mode === "KNOCKOUT" ? "Eliminación directa" : "Grupos + playoff"}</div></div>
        <div className="pstat"><div className="l">Sets</div><div className="v">{sets}</div></div>
        <div className="pstat"><div className="l">Parejas objetivo</div><div className="v">{cap ?? "Sin cupo"}</div></div>
        <div className="pstat hi"><div className="l">Participantes</div><div className="v">{active.length}</div></div>
        <div className={`pstat ${ps.length && paid === ps.length ? "hi" : ""}`}><div className="l">Pagaron</div><div className="v">{paid}/{ps.length}<small> jug.</small></div>
          {collected !== null && <div className="sub">Cobrado {fmtMoney(collected)} de {fmtMoney((t!.entry_fee ?? 0) * active.length)}</div>}</div>
      </div>

      {manage && (
        <section className="part-manual">
          <div className="part-manual-head"><span className="part-kicker">Carga manual</span><span className="part-sub">Cargar inscripción manual</span></div>
          {full ? (
            <div className="alert err">La categoría ya alcanzó el máximo de {cap} parejas. No se pueden agregar más participantes (podés subir el cupo en Reglas).</div>
          ) : (
            <ActionForm action={A.registerEntryAction} resetOnSuccess>
              <input type="hidden" name="tc_id" value={lc.tc.id} />
              <PairPlayerSelects level={level} players={free.map((p) => ({ id: p.id, label: labelOf(p), category: p.category }))} />
              {lc.rules.mode !== "KNOCKOUT" && lc.zones.length > 0 && (
                <div className="field"><label>El torneo ya tiene zonas: ¿dónde la agrego?</label>
                  <select name="zone_id" defaultValue="AUTO">
                    <option value="AUTO">En la zona con menos parejas (recomendado)</option>
                    {lc.zones.filter((z) => z.format !== "GVG").map((z) => <option key={z.id} value={z.id}>Zona {z.name} ({z.entry_ids.length} parejas)</option>)}
                    <option value="NONE">Dejarla sin zona por ahora</option>
                  </select>
                  <div className="hint">Se le crean solo sus partidos contra las parejas de esa zona. No se reorganiza nada y los resultados cargados no se tocan.</div></div>
              )}
              {lc.rules.mode === "KNOCKOUT" && lc.tc.bracket.length > 0 && (
                <div className="alert info">El cuadro ya está armado: la pareja nueva ocupa un pase libre de la primera ronda (si queda alguno), sin tocar resultados.</div>
              )}
              <div className="fgrid fgrid-2">
                <div className="field"><label>Restricción horaria (opcional)</label>
                  <div className="row"><span className="muted">Puede desde</span><input type="time" name="not_before" className="sm" /><span className="muted">hasta</span><input type="time" name="not_after" className="sm" /></div>
                  <input name="restriction_note" placeholder="Nota (ej. no puede antes de las 20 los sábados)" maxLength={120} style={{ marginTop: 6 }} />
                  <div className="hint">El cronograma la respeta, salvo que el torneo tenga activado «No tener en cuenta restricciones».</div></div>
                <div className="field"><label>Cabeza de serie (opcional)</label><input type="number" name="seed" min={1} />
                  <div className="hint">1 = mejor sembrado. Las cabezas de serie quedan en zonas distintas.</div></div>
              </div>
              <Submit className="btn primary">Inscribir</Submit>
            </ActionForm>
          )}
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Solo se muestran jugadores compatibles con la categoría ({lc.tc.gender_rule === "MALE" ? "masculina" : lc.tc.gender_rule === "FEMALE" ? "femenina" : lc.tc.gender_rule === "MIXED" ? "mixta: cualquier combinación de hombres y mujeres" : "libre"}) que no estén ya inscriptos.
            ¿Falta alguien? <Link href="/admin/players?new=1" target="_blank">Crear jugador</Link> y recargá esta página.
          </p>
        </section>
      )}

      <div className="part-list">
        {lc.entries.length === 0 && <div className="part-empty">Todavía no hay parejas inscriptas.</div>}
        {lc.entries.map((e) => {
          const phones = e.players.map((p) => p.phone).filter(Boolean);
          return (
            <article key={e.id} id={`e-${e.id}`} className={`pcard ${e.status === "WITHDRAWN" ? "out" : ""}`}>
              <div className="pcard-top">
                <div className="pcard-main">
                  <h3>{e.players.map((p) => `${p.first_name} ${p.last_name}`).join(" / ") || entryFullLabel(e)}</h3>
                  <div className="pcard-line">Contacto: {phones.length ? phones.join(" · ") : <span className="dim">sin teléfono</span>}</div>
                  <div className="pcard-line dim">Agregado: {fmtDateTime(new Date(e.created_at))}</div>
                  <div className="pcard-tags">
                    {zoneOf.get(e.id) && <span className="badge">Zona {zoneOf.get(e.id)}</span>}
                    {e.seed && <span className="badge warn">Cabeza de serie {e.seed}</span>}
                    {restrictionLabel(e) && <span className="badge info">🕒 {restrictionLabel(e)}</span>}
                    {e.status === "WITHDRAWN" && <span className="badge err">Retirada ({e.withdrawal_policy === "ANNUL_ALL" ? "anulada" : "W.O. en pendientes"})</span>}
                    {e.former.length > 0 && <span className="badge">Reemplazó a: {e.former.map((f) => `${f.first_name} ${f.last_name}`).join(", ")}</span>}
                  </div>
                </div>
                <div className="pcard-side">
                  <div className="pay-row">
                    {e.players.map((p) => manage ? (
                      <ActionForm key={p.slot} action={A.togglePaidAction} hideSuccess>
                        <input type="hidden" name="entry_id" value={e.id} /><input type="hidden" name="slot" value={p.slot} />
                        <button className={`pay ${p.paid_at ? "on" : ""}`} title={p.paid_at ? "Pagó — tocá para quitar la marca" : "Todavía no pagó — tocá para marcar"}>{p.paid_at ? "✓ Pagó" : "$ Debe"} · {p.last_name}</button>
                      </ActionForm>
                    ) : <span key={p.slot} className={`pay ${p.paid_at ? "on" : ""}`}>{p.paid_at ? "✓ Pagó" : "$ Debe"} · {p.last_name}</span>)}
                  </div>
                  {manage && !zoneOf.has(e.id) && (
                    <ActionForm action={A.deleteEntryAction} confirmText="¿Quitar esta pareja de la categoría?">
                      <input type="hidden" name="entry_id" value={e.id} />
                      <Submit className="btn quitar sm">Quitar</Submit>
                    </ActionForm>
                  )}
                </div>
              </div>
              {manage && e.status === "ACTIVE" && (
                <details className="pcard-more" open={focus === e.id}>
                  <summary>Más acciones <span className="chev">▾</span></summary>
                  <div className="pcard-actions">
                    <ActionForm action={A.setSeedAction} hideSuccess>
                      <input type="hidden" name="entry_id" value={e.id} />
                      <label>Cabeza de serie</label>
                      <div className="row">
                        <input name="seed" type="number" min={1} className="sm" style={{ width: 80 }} defaultValue={e.seed ?? ""} aria-label="Cabeza de serie" />
                        <Submit className="btn sm" pendingText="…">Guardar</Submit>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>Vacío = sin siembra.</div>
                    </ActionForm>
                    <ActionForm action={A.replacePlayerAction}>
                      <input type="hidden" name="entry_id" value={e.id} />
                      <label>Reemplazar jugador</label>
                      <div className="row">
                        <select name="slot" className="sm">{e.players.map((p) => <option key={p.slot} value={p.slot}>Sale {p.first_name} {p.last_name}</option>)}</select>
                        <select name="player_id" className="sm" defaultValue=""><option value="">Entra (de la lista)…</option>{optGroups(free)}</select>
                      </div>
                      <div className="muted" style={{ fontSize: 12, margin: "6px 0 4px" }}>…o si no está cargado, escribí su nombre:</div>
                      <div className="row">
                        <input name="new_first" className="sm" placeholder="Nombre" maxLength={60} style={{ flex: 1, minWidth: 110 }} />
                        <input name="new_last" className="sm" placeholder="Apellido" maxLength={60} style={{ flex: 1, minWidth: 110 }} />
                        <Submit className="btn sm">Reemplazar</Submit>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>La pareja conserva sus resultados. Si escribís un nombre nuevo, el jugador se crea solo (después podés completar sus datos en Jugadores).</div>
                    </ActionForm>
                    <ActionForm action={A.swapPlayersAction}>
                      <input type="hidden" name="entry_id" value={e.id} />
                      <label>Cambiar de pareja (intercambiar con otra pareja)</label>
                      <div className="row">
                        <select name="slot" className="sm">{e.players.map((p) => <option key={p.slot} value={p.slot}>{p.first_name} {p.last_name}</option>)}</select>
                        <span className="muted" style={{ fontSize: 13 }}>por</span>
                        <select name="other" className="sm" required defaultValue="">
                          <option value="" disabled>Elegir jugador…</option>
                          {lc.entries.filter((o) => o.id !== e.id && o.status === "ACTIVE").flatMap((o) => o.players.map((p) => (
                            <option key={`${o.id}:${p.slot}`} value={`${o.id}:${p.slot}`}>{p.last_name}, {p.first_name} (pareja {entryLabel(o)}{zoneOf.get(o.id) ? ` · Zona ${zoneOf.get(o.id)}` : ""})</option>
                          )))}
                        </select>
                        <Submit className="btn sm">Intercambiar</Submit>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>Cada pareja queda en su zona y conserva sus resultados; solo cambian los jugadores.</div>
                    </ActionForm>
                    <ActionForm action={A.setRestrictionAction}>
                      <input type="hidden" name="entry_id" value={e.id} />
                      <label>Restricción horaria</label>
                      <div className="row">
                        <span className="muted" style={{ fontSize: 13 }}>Desde</span><input type="time" name="not_before" className="sm" defaultValue={e.not_before?.slice(0, 5) ?? ""} />
                        <span className="muted" style={{ fontSize: 13 }}>hasta</span><input type="time" name="not_after" className="sm" defaultValue={e.not_after?.slice(0, 5) ?? ""} />
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <input name="restriction_note" className="sm" style={{ flex: 1 }} placeholder="Nota (ej. llega del trabajo)" defaultValue={e.restriction_note ?? ""} maxLength={120} />
                        <Submit className="btn sm">Guardar</Submit>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>El cronograma solo programa a esta pareja dentro de ese horario. Dejalo vacío para quitarla.</div>
                    </ActionForm>
                    {can(u, "tournaments.manage") && (
                      <ActionForm action={A.withdrawEntryAction}>
                        <input type="hidden" name="entry_id" value={e.id} />
                        <label>Retirar pareja</label>
                        <div className="row">
                          <select name="policy" className="sm" defaultValue={lc.rules.withdrawalDefault}>
                            <option value="WO_PENDING">Mantener jugados, W.O. en pendientes</option>
                            <option value="ANNUL_ALL">Anular todos sus partidos</option>
                          </select>
                          <Submit className="btn danger sm">Retirar</Submit>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>Para parejas que ya están en una zona: conserva el historial.</div>
                      </ActionForm>
                    )}
                  </div>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function ZonesTab({ lc, u }: { lc: LoadedCategory; u: CurrentUser }) {
  if (lc.rules.mode === "KNOCKOUT") {
    return (
      <div className="card empty">
        Esta categoría es de <b>eliminación directa</b>: no tiene zonas. Inscribí las parejas (con su número de siembra si querés) y generá el cuadro en la pestaña <Link href="?tab=cuadro">Cuadro</Link>.
      </div>
    );
  }
  const manage = can(u, "tournaments.manage");
  const active = lc.entries.filter((e) => e.status === "ACTIVE");
  let suggested = "";
  try { suggested = active.length >= 2 ? planZoneSizes(active.length, { preferredSize: lc.rules.preferredZoneSize }).join(", ") : ""; } catch { suggested = ""; }
  const hasResults = lc.matches.some((m) => m.phase === "ZONE" && m.status === "PLAYED");
  const unzoned = active.filter((e) => !lc.zones.some((z) => z.entry_ids.includes(e.id)));

  return (
    <div className="stack">
      {manage && !hasResults && lc.tc.bracket.length === 0 && (
        <div className="card">
          <h2>{lc.zones.length ? "Regenerar zonas" : "Generar zonas"}</h2>
          <ActionForm action={A.generateZonesAction} confirmText={lc.zones.length ? "Se reemplazarán las zonas actuales. ¿Continuar?" : undefined}>
            <input type="hidden" name="tc_id" value={lc.tc.id} />
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div className="field"><label>Tamaños de zona</label><input name="sizes" placeholder={suggested ? `Automático: ${suggested}` : "Ej. 4,3,3"} />
                <div className="hint">Dejalo vacío para usar la propuesta automática ({suggested || "—"}), o escribí tamaños propios, por ejemplo 5,4,4.</div></div>
              <div className="field"><label>Número de sorteo (opcional)</label><input name="random_seed" type="number" min={0} />
                <div className="hint">Queda registrado; con el mismo número el sorteo se repite igual.</div></div>
            </div>
            <Submit className="btn primary">Generar zonas con {active.length} parejas</Submit>
          </ActionForm>
        </div>
      )}
      {manage && !hasResults && lc.tc.bracket.length === 0 && active.length >= 2 && (
        <details className="card mz-card" open={false}>
          <summary><h2>Armar zonas a mano</h2><span className="muted">Elegí vos qué pareja va en cada zona.</span></summary>
          <ActionForm action={A.manualZonesAction} confirmText={lc.zones.length ? "Se reemplazarán las zonas actuales. ¿Continuar?" : undefined}>
            <input type="hidden" name="tc_id" value={lc.tc.id} />
            <ManualZones pairs={active.map((e) => ({ id: e.id, label: entryLabel(e), seed: e.seed }))} suggested={suggested ? suggested.split(", ").map(Number) : [active.length]} />
          </ActionForm>
        </details>
      )}
      {manage && lc.zones.some((z) => z.entry_ids.length === 4) && (() => {
        const fours = lc.zones.filter((z) => z.entry_ids.length === 4);
        const rr = fours.filter((z) => z.format !== "GVG");
        const all = lc.rules.qualification.perZone === "ALL";
        const to = rr.length ? "GVG" : "RR";
        if (!rr.length && all) return (
          <div className="card gvg-box"><div>
            <b>Zonas de 4 ({fours.map((z) => z.name).join(", ")}): ganador vs ganador / perdedor vs perdedor</b>
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>Como clasifican todas, cada pareja juega 2 partidos: 1ª ronda A vs B y C vs D; después ganadores entre sí (1° y 2° puesto) y perdedores entre sí (3° y 4° puesto). Las posiciones salen directo de esos partidos.</div>
          </div></div>
        );
        return (
          <div className="card gvg-box">
            <div>
              <b>Zonas de 4 parejas ({(rr.length ? rr : fours).map((z) => z.name).join(", ")})</b>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                {rr.length
                  ? <>Se están jugando todos contra todos (3 partidos por pareja).{all ? " Como clasifican todas, conviene pasarlas a ganador vs ganador / perdedor vs perdedor para que todas jueguen 2 partidos." : " Podés pasarlas a ganador vs ganador / perdedor vs perdedor."} Se respetan los partidos ya jugados.</>
                  : "Se juegan ganador vs ganador y perdedor vs perdedor (2 partidos por pareja)."}
              </div>
            </div>
            <ActionForm action={A.setFourZoneFormatAction}>
              <input type="hidden" name="tc_id" value={lc.tc.id} />
              <input type="hidden" name="to" value={to} />
              <Submit className={`btn ${to === "GVG" ? "primary" : "ghost"}`}>{to === "GVG" ? "Pasar a ganador vs ganador / perdedor vs perdedor" : "Volver a todos contra todos"}</Submit>
            </ActionForm>
          </div>
        );
      })()}
      {unzoned.length > 0 && lc.zones.length > 0 && (
        <div className="alert warn">Hay {unzoned.length} pareja(s) sin zona: {unzoned.map(entryLabel).join(", ")}. Asignalas con «Mover a» desde la lista de abajo.</div>
      )}
      <div className="grid grid-3">
        {lc.zones.map((z) => (
          <div key={z.id} className="card flush">
            <div className="card-head">
              <h3>Zona {z.name}</h3>
              <span className="muted">{z.entry_ids.length} parejas</span>
            </div>
            {z.entry_ids.map((eid) => {
              const e = lc.entryMap.get(eid);
              return (
                <div key={eid} className="match">
                  <div><b>{entryLabel(e)}</b>{e?.seed ? <span className="badge" style={{ marginLeft: 6 }}>Siembra {e.seed}</span> : null}{e?.status === "WITHDRAWN" && <span className="badge err" style={{ marginLeft: 6 }}>Retirada</span>}</div>
                  <div />
                  {manage && e?.status === "ACTIVE" && (
                    <div className="meta">
                      <Link className="btn ghost sm" href={`?tab=inscripciones&e=${eid}#e-${eid}`}>Cambiar jugadores</Link>
                      {lc.zones.length > 1 && <ActionForm action={A.moveEntryAction} className="row">
                        <input type="hidden" name="entry_id" value={eid} />
                        <select name="zone_id" className="sm" required defaultValue="">
                          <option value="" disabled>Mover a…</option>
                          {lc.zones.filter((x) => x.id !== z.id).map((x) => <option key={x.id} value={x.id}>Zona {x.name}</option>)}
                        </select>
                        <Submit className="btn ghost sm" pendingText="…">Mover</Submit>
                      </ActionForm>}
                    </div>
                  )}
                </div>
              );
            })}
            {z.entry_ids.length === 0 && manage && (
              <div style={{ padding: 12 }}><ActionForm action={A.deleteZoneAction}><input type="hidden" name="zone_id" value={z.id} /><Submit className="btn ghost sm">Eliminar zona vacía</Submit></ActionForm></div>
            )}
          </div>
        ))}
      </div>
      {manage && lc.zones.length > 0 && (
        <div className="row">
          <ActionForm action={A.addZoneAction}><input type="hidden" name="tc_id" value={lc.tc.id} /><Submit className="btn ghost sm">+ Agregar zona vacía</Submit></ActionForm>
          {unzoned.length > 0 && lc.zones.length > 0 && unzoned.map((e) => (
            <ActionForm key={e.id} action={A.moveEntryAction} className="row">
              <input type="hidden" name="entry_id" value={e.id} />
              <span>{entryLabel(e)} →</span>
              <select name="zone_id" className="sm">{lc.zones.map((x) => <option key={x.id} value={x.id}>Zona {x.name}</option>)}</select>
              <Submit className="btn sm" pendingText="…">Asignar</Submit>
            </ActionForm>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>Mover una pareja de zona no borra resultados: los partidos ya jugados quedan anulados y visibles en el historial, y antes de aplicar se muestra el impacto en posiciones y cuadro.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- */

/** Orden en la lista de partidos: en juego, después pendientes, al final los ya jugados. */
const statusRank = (s: string) => (s === "IN_PLAY" ? 0 : s === "PENDING" ? 1 : 2);

function MatchesTab({ lc, u }: { lc: LoadedCategory; u: CurrentUser }) {
  const canEnter = can(u, "results.enter");
  const maxSets = lc.rules.format.setsToWin * 2 - 1;
  const perRound = new Map<number, number>();
  for (const b of lc.view.bracket) perRound.set(b.round, (perRound.get(b.round) ?? 0) + 1);
  const groups: { title: string; matches: typeof lc.matches }[] = [
    ...lc.zones.map((z) => ({ title: `Zona ${z.name}`, matches: lc.matches.filter((m) => m.zone_id === z.id && m.phase === "ZONE") })),
    ...[...perRound.keys()].sort((a, b) => a - b).map((r) => ({ title: roundName(perRound.get(r)!), matches: lc.matches.filter((m) => m.phase === "BRACKET" && m.round === r) })),
  ];
  const errors = new Map(lc.view.errors.map((e) => [e.matchId, e.message]));
  const shown = (m: (typeof lc.matches)[number]) => {
    const rm = m.phase === "BRACKET" ? lc.view.bracket.find((b) => b.code === m.bracket_code) : null;
    return !(rm && (rm.byeAdvance || rm.a.kind === "BYE" || rm.b.kind === "BYE"));
  };
  return (
    <div className="stack">
      {groups.map((g) => {
        const ms = g.matches.filter(shown);
        const played = ms.filter((m) => m.status === "PLAYED").length;
        return (
        <section key={g.title} className="mgroup">
          <div className="mgroup-head"><h3>{g.title}</h3><span className="muted">{played}/{ms.length} jugados</span></div>
          {ms.length === 0 && <div className="empty card">Sin partidos.</div>}
          <div className="mgrid">
          {ms.map((m, i) => ({ m, n: i + 1 }))
            .sort((x, y) => statusRank(x.m.status) - statusRank(y.m.status) || x.n - y.n)
            .map(({ m, n: i }) => {
            const rm = m.phase === "BRACKET" ? lc.view.bracket.find((b) => b.code === m.bracket_code) : null;
            const ready = m.phase === "ZONE" ? !!(m.entry_a && m.entry_b) : (rm && rm.a.kind === "ENTRY" && rm.b.kind === "ENTRY");
            const sideA = m.phase === "ZONE" ? zoneSideLabel(lc, m, "a") : rm?.a.kind === "ENTRY" ? entryLabel(lc.entryMap.get(rm.a.entryId)) : "A definir";
            const sideB = m.phase === "ZONE" ? zoneSideLabel(lc, m, "b") : rm?.b.kind === "ENTRY" ? entryLabel(lc.entryMap.get(rm.b.entryId)) : "A definir";
            const w = winnerSide(m.outcome, lc, m);
            const team = (side: "A" | "B", label: string) => (
              <div className={`mteam ${w === side ? "win" : w ? "lose" : ""}`}>
                <span className="mname">{label}</span>
                {m.status === "PLAYED" && <SetScores outcome={m.outcome} side={side} />}
              </div>
            );
            return (
              <article key={m.id} id={`m-${m.id}`} className={`mcard st-${m.status.toLowerCase()} ${errors.has(m.id) || rm?.staleResult ? "warn" : ""}`}>
                <div className="mcard-top">
                  <span className="mnum">{m.phase === "BRACKET" ? m.bracket_code : `Partido ${i}`}</span>
                  <StatusBadge status={m.status} />
                </div>
                <div className="mteams">
                  {team("A", sideA)}
                  <div className="mvs">vs</div>
                  {team("B", sideB)}
                </div>
                <div className="mmeta">
                  <span>🕒 {m.scheduled_at ? fmtDateTime(m.scheduled_at) : "Sin horario"}</span>
                  {m.court_name && <span>📍 {m.court_name}</span>}
                </div>
                {errors.has(m.id) && <span className="badge err">{errors.get(m.id)}</span>}
                {rm?.staleResult && <span className="badge warn">Resultado invalidado: cambiaron los participantes</span>}
                {canEnter && ready && m.status !== "ANNULLED" && (
                  <details className="mcard-load" open={m.status === "IN_PLAY"}>
                    <summary>{m.status === "PLAYED" ? "Corregir resultado" : "Cargar resultado"}</summary>
                    <div className="mcard-form">
                      <ResultForm matchId={m.id} version={m.version} sideA={sideA} sideB={sideB} maxSets={maxSets} current={m.status === "PLAYED" ? m.outcome : null} />
                      <div className="row" style={{ marginTop: 8 }}>
                        {m.status !== "PLAYED" && (
                          <ActionForm action={A.setInPlayAction} hideSuccess>
                            <input type="hidden" name="match_id" value={m.id} />
                            <input type="hidden" name="in_play" value={m.status === "IN_PLAY" ? "0" : "1"} />
                            <Submit className="btn ghost sm" pendingText="…">{m.status === "IN_PLAY" ? "Quitar «en juego»" : "Marcar en juego"}</Submit>
                          </ActionForm>
                        )}
                        {m.status === "PLAYED" && (
                          <ActionForm action={A.annulResultAction} className="row">
                            <input type="hidden" name="match_id" value={m.id} />
                            <input name="reason" className="sm" placeholder="Motivo" required minLength={3} />
                            <Submit className="btn ghost sm">Borrar resultado</Submit>
                          </ActionForm>
                        )}
                      </div>
                    </div>
                  </details>
                )}
              </article>
            );
          })}
          </div>
        </section>
        );
      })}
      {groups.length === 0 && <div className="empty card">Generá las zonas para ver los partidos.</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function StandingsTab({ lc, u }: { lc: LoadedCategory; u: CurrentUser }) {
  const manage = can(u, "tournaments.manage");
  return (
    <div className="stack">
      <div className="grid grid-zones">
        {lc.zones.map((z) => {
          const s = lc.view.standings.get(z.id);
          const tied = s?.rows.filter((r) => r.unresolvedTie) ?? [];
          return (
            <div key={z.id} className="stack">
              <StandingsTable lc={lc} zoneId={z.id} />
              {manage && s?.complete && tied.length > 0 && (
                <div className="card">
                  <h3>Resolver empate en Zona {z.name}</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Todos los criterios configurados dieron igual. Registrá el resultado del sorteo (queda en la auditoría).</p>
                  <ActionForm action={A.zoneTiebreakAction}>
                    <input type="hidden" name="zone_id" value={z.id} />
                    {s.rows.map((r, i) => (
                      <div key={i} className="row" style={{ marginBottom: 6 }}>
                        <span style={{ width: 24 }}>{i + 1}°</span>
                        <select name="order" className="sm" defaultValue={r.entryId}>{s.rows.map((x) => <option key={x.entryId} value={x.entryId}>{entryLabel(lc.entryMap.get(x.entryId))}</option>)}</select>
                      </div>
                    ))}
                    <Submit className="btn sm">Guardar orden</Submit>
                  </ActionForm>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {lc.view.cross.map((c) => (
        <div key={c.pos} className="card flush">
          <div className="card-head">
            <h3>{lc.rules.qualification.fixedTotal ? `${c.pos}° puestos (${Math.min(c.take ?? 0, c.order.length)} de ${c.order.length} pasan)` : `Comparación de ${c.pos}° puestos entre zonas`}</h3>
            {c.final ? <span className="badge ok">Definida</span> : <span className="badge">Pendiente</span>}
          </div>
          <p className="muted" style={{ padding: "8px 16px 0", fontSize: 13 }}>
            {lc.rules.qualification.fixedTotal
              ? (c.take ?? 0) >= c.order.length ? <>Pasan todos ({c.order.length}); este orden define la siembra del cuadro.</> : <>Pasan los {c.take} mejores para completar {lc.rules.qualification.fixedTotal}.</>
              : <>Clasifican los {c.take ?? lc.rules.qualification.bestNext} mejores.</>} Criterio: {lc.rules.crossZoneMode === "AVERAGES" ? "promedios por partido (% ganados, dif. de sets y de games por partido)" : "se descuentan los partidos contra el último en las zonas más grandes"}.
          </p>
          <div className="table-wrap"><table>
            <thead><tr><th className="num">#</th><th>Pareja</th></tr></thead>
            <tbody>{c.order.map((e, i) => <tr key={e} className={i < (c.take ?? lc.rules.qualification.bestNext) ? "q" : ""}><td className="num">{i + 1}</td><td>{entryLabel(lc.entryMap.get(e))}</td></tr>)}</tbody>
          </table></div>
          {manage && (lc.view.crossTies[c.pos]?.length ?? 0) > 0 && (
            <div style={{ padding: 12 }}>
              <div className="alert warn">Hay un empate exacto entre zonas. Registrá el sorteo:</div>
              <ActionForm action={A.crossTiebreakAction}>
                <input type="hidden" name="tc_id" value={lc.tc.id} />
                <input type="hidden" name="pos" value={c.pos} />
                {c.order.map((e, i) => (
                  <div key={i} className="row" style={{ marginBottom: 6 }}><span style={{ width: 24 }}>{i + 1}°</span>
                    <select name="order" className="sm" defaultValue={e}>{c.order.map((x) => <option key={x} value={x}>{entryLabel(lc.entryMap.get(x))}</option>)}</select></div>
                ))}
                <Submit className="btn sm">Guardar orden</Submit>
              </ActionForm>
            </div>
          )}
        </div>
      ))}
      {lc.zones.length === 0 && <div className="empty card">Todavía no hay zonas.</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function BracketTab({ lc, u }: { lc: LoadedCategory; u: CurrentUser }) {
  const manage = can(u, "tournaments.manage");
  const master = manage && (u.role === "ADMIN" || u.isSuperadmin);
  const canWin = can(u, "results.enter");
  const pairList = lc.entries.filter((e) => e.status === "ACTIVE").map((e) => ({ id: e.id, label: entryLabel(e) }));
  const whereInRound = new Map<string, string>();
  for (const m of lc.view.bracket) for (const [sd, r] of [["arriba", m.a], ["abajo", m.b]] as const) if (r.kind === "ENTRY") whereInRound.set(`${m.round}|${r.entryId}`, `${m.code} ${sd}`);
  const zoneNames = Object.fromEntries(lc.zones.map((z) => [z.id, z.name]));
  const hasResults = lc.matches.some((m) => m.phase === "BRACKET" && m.status === "PLAYED");
  const q = lc.rules.qualification;
  const options: { v: string; l: string }[] = [
    ...lc.zones.flatMap((z) => Array.from({ length: z.entry_ids.length }, (_, i) => ({ v: `ZONE:${z.id}:${i + 1}`, l: `${i + 1}° Zona ${z.name}` }))),
    ...(q.fixedTotal
      ? lc.view.cross.flatMap((c) => Array.from({ length: Math.min(c.take ?? 0, c.order.length) }, (_, i) => ({ v: `CROSS:${c.pos}:${i + 1}`, l: `${i + 1}° mejor ${c.pos}°` })))
      : q.bestNext > 0 && q.perZone !== "ALL" ? Array.from({ length: q.bestNext }, (_, i) => ({ v: `CROSS:${(q.perZone as number) + 1}:${i + 1}`, l: `${i + 1}° mejor ${(q.perZone as number) + 1}°` })) : []),
    ...lc.entries.filter((e) => e.status === "ACTIVE").map((e) => ({ v: `ENTRY:${e.id}`, l: `Pareja fija: ${entryLabel(e)}` })),
    { v: "BYE", l: "Pase libre" },
  ];
  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: 4 }}>Cuadro eliminatorio</h2>
            <span className="muted">{lc.rules.mode === "KNOCKOUT"
              ? `Eliminación directa: entran las ${lc.entries.filter((e) => e.status === "ACTIVE").length} parejas inscriptas. Los sembrados reciben los pases libres.`
              : q.fixedTotal
                ? <>Siempre {q.fixedTotal} al playoff: {lc.view.cross.map((c) => `${Math.min(c.take ?? 0, c.order.length)} de ${c.pos}°`).join(" + ") || "se calcula con las zonas"}. El cuadro se arma cuando terminan las zonas. Se cambia en «Reglas».</>
                : <>Clasifican {q.perZone === "ALL" ? "todas las parejas" : `${q.perZone} por zona`}{q.bestNext ? ` + ${q.bestNext} mejores ${(q.perZone as number) + 1}°` : ""}. Se cambia en «Reglas».</>}</span>
          </div>
          {manage && (
            <div className="row">
              {!hasResults && (
                <ActionForm action={A.generateBracketAction} confirmText={lc.tc.bracket.length ? "Se reemplazará el cuadro actual (no tiene resultados). ¿Continuar?" : undefined}>
                  <input type="hidden" name="tc_id" value={lc.tc.id} />
                  <Submit className="btn primary">{lc.tc.bracket.length ? "Regenerar cuadro" : "Generar cuadro"}</Submit>
                </ActionForm>
              )}
              {lc.tc.bracket.length > 0 && !hasResults && (
                <ActionForm action={A.deleteBracketAction} confirmText="¿Eliminar el cuadro?"><input type="hidden" name="tc_id" value={lc.tc.id} /><Submit className="btn ghost">Eliminar</Submit></ActionForm>
              )}
            </div>
          )}
        </div>
        {lc.rules.mode !== "KNOCKOUT" && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          El cuadro se puede generar antes de que terminen las zonas: cada lugar muestra de dónde sale (por ejemplo «1° Zona A») y se completa solo cuando la zona queda definida.
          Los pases libres van a los mejores sembrados y se evita que dos parejas de la misma zona se crucen en la primera ronda.
        </p>}
      </div>
      <div className="card">
        {(manage || canWin) && lc.tc.bracket.length > 0 && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Tocá una pareja del cuadro para <b>marcarla como ganadora</b>{master ? <> o <b>cambiarla por otra</b></> : null}. ✋ = elegida a mano.</p>}
        <BracketView lc={lc} zoneNames={zoneNames} renderSide={(rm, row, side, slot) => {
          const other = side === "a" ? rm.b : rm.a;
          const me = side === "a" ? rm.a : rm.b;
          const autoOpts = rm.round === 1
            ? options.filter((o) => !o.v.startsWith("ENTRY:"))
            : [{ v: `WINNER:R${rm.round - 1}-${side === "a" ? 2 * rm.index - 1 : 2 * rm.index}`, l: `Ganador R${rm.round - 1}-${side === "a" ? 2 * rm.index - 1 : 2 * rm.index}` }];
          return (
            <BracketSlotMenu tcId={lc.tc.id} code={rm.code} side={side}
              canWin={canWin && !!row && me.kind === "ENTRY" && other.kind === "ENTRY"}
              canChange={master} pairs={pairList.map((p) => { const w = whereInRound.get(`${rm.round}|${p.id}`); return w ? { ...p, label: `${p.label} · está en ${w} (se intercambian)` } : p; })} auto={autoOpts} current={me.kind === "ENTRY" ? me.entryId : null}
              isWinner={me.kind === "ENTRY" && rm.winner === me.entryId && !rm.staleResult && row?.status === "PLAYED"}>
              {slot}
            </BracketSlotMenu>
          );
        }} />
      </div>
      {master && lc.tc.bracket.length > 0 && <BracketFix lc={lc} zoneNames={zoneNames} options={options} />}
    </div>
  );
}

/** Corrección manual de clasificados (solo administrador general). */
function BracketFix({ lc, zoneNames, options }: { lc: LoadedCategory; zoneNames: Record<string, string>; options: { v: string; l: string }[] }) {
  const r1 = lc.view.bracket.filter((m) => m.round === 1).sort((a, b) => a.index - b.index);
  const n = r1.length;
  const def = (code: string) => lc.tc.bracket.find((d) => d.code === code)!;
  const origin = (code: string, side: "a" | "b") => {
    const r = def(code)[side];
    return r.t === "ZONE" ? `${r.pos}° Zona ${zoneNames[r.zone] ?? "?"}` : r.t === "CROSS" ? `${r.rank}° mejor ${r.pos}°` : r.t === "BYE" ? "Pase libre" : r.t === "ENTRY" ? "Elegida a mano" : "—";
  };
  const slots = r1.flatMap((m) => (["a", "b"] as const).map((side) => {
    const res = m[side];
    const who = res.kind === "ENTRY" ? entryLabel(lc.entryMap.get(res.entryId)) : res.kind === "BYE" ? "Pase libre" : "A definir";
    return { key: `${m.code}|${side}`, code: m.code, side, place: `${roundName(n)} ${m.index} · ${side === "a" ? "arriba" : "abajo"}`, origin: origin(m.code, side), who, manual: def(m.code)[side].t === "ENTRY", entryId: res.kind === "ENTRY" ? res.entryId : null };
  }));
  const inBracket = new Set(slots.map((x) => x.entryId).filter(Boolean));
  const active = lc.entries.filter((e) => e.status === "ACTIVE");
  const auto = options.filter((o) => !o.v.startsWith("ENTRY:"));
  return (
    <div className="card bfix">
      <div className="bfix-head">
        <div>
          <div className="part-kicker">Administrador general</div>
          <h2>Corregir clasificados del playoff</h2>
          <p className="muted">Si clasificó una pareja que no correspondía, elegí qué pareja va en su lugar. También podés intercambiar dos lugares del cuadro. Antes de aplicar te mostramos el cambio para que lo confirmes, y queda registrado en Auditoría.</p>
        </div>
      </div>
      <div className="bfix-list">
        {slots.map((x) => (
          <div key={x.key} className={`bfix-row ${x.manual ? "manual" : ""}`}>
            <div className="bfix-place"><b>{x.place}</b><small>Le corresponde: {x.origin}</small></div>
            <div className="bfix-who">{x.who}{x.manual && <span className="badge warn">corregido a mano</span>}</div>
            <ActionForm action={A.setBracketSlotAction} className="bfix-form" hideSuccess>
              <input type="hidden" name="tc_id" value={lc.tc.id} />
              <input type="hidden" name="code" value={x.code} />
              <input type="hidden" name="side" value={x.side} />
              <select name="ref" className="sm" required defaultValue="">
                <option value="" disabled>Poner en su lugar…</option>
                <optgroup label="Parejas que no están en el cuadro">
                  {active.filter((e) => !inBracket.has(e.id)).map((e) => <option key={e.id} value={`ENTRY:${e.id}`}>{entryLabel(e)}</option>)}
                </optgroup>
                <optgroup label="Volver a automático">
                  {auto.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </optgroup>
              </select>
              <Submit className="btn sm" pendingText="…">Cambiar</Submit>
            </ActionForm>
          </div>
        ))}
      </div>
      <ActionForm action={A.swapBracketSlotsAction} className="bfix-swap">
        <input type="hidden" name="tc_id" value={lc.tc.id} />
        <label>Intercambiar dos lugares</label>
        <div className="row">
          <select name="x" className="sm" required defaultValue=""><option value="" disabled>Lugar 1…</option>{slots.map((x) => <option key={x.key} value={x.key}>{x.place}: {x.who}</option>)}</select>
          <span className="muted">↔</span>
          <select name="y" className="sm" required defaultValue=""><option value="" disabled>Lugar 2…</option>{slots.map((x) => <option key={x.key} value={x.key}>{x.place}: {x.who}</option>)}</select>
          <Submit className="btn sm">Intercambiar</Submit>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Sirve cuando las dos parejas ya están en el cuadro y solo hay que cambiarlas de lugar (por ejemplo, para que no se crucen dos de la misma zona).</div>
      </ActionForm>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function RulesTab({ lc, u }: { lc: LoadedCategory; u: CurrentUser }) {
  const r = lc.rules;
  const disabled = !can(u, "tournaments.manage");
  const fmtKey = Object.entries(FORMATS).find(([, f]) => f.setsToWin === r.format.setsToWin && f.gamesPerSet === r.format.gamesPerSet && f.superTiebreakDecider === r.format.superTiebreakDecider && f.superTiebreakPoints === r.format.superTiebreakPoints)?.[0] ?? "CUSTOM";
  const allCriteria = Object.keys(TIEBREAK_LABELS) as TiebreakCriterion[];
  const order = [...r.tiebreaks, ...allCriteria.filter((c) => !r.tiebreaks.includes(c))];
  return (
    <div className="card">
      <ActionForm action={A.updateRulesAction}>
        <input type="hidden" name="tc_id" value={lc.tc.id} />
        <fieldset disabled={disabled}>
          <legend>Formato competitivo</legend>
          <div className="field" style={{ maxWidth: 420 }}>
            <select name="mode" defaultValue={r.mode}>
              <option value="ZONES">Zonas + playoffs</option>
              <option value="KNOCKOUT">Eliminación directa</option>
            </select>
            <div className="hint">En eliminación directa no hay zonas: todas las parejas entran al cuadro y el que pierde queda afuera. Para cambiarlo, la categoría no tiene que tener zonas ni cuadro.</div>
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Cupo de parejas</legend>
          <div className="field" style={{ maxWidth: 420 }}>
            <input type="number" name="maxEntries" min={2} max={512} defaultValue={r.maxEntries ?? ""} placeholder={lc.tc.tournament_max_entries ? `Igual que el torneo: ${lc.tc.tournament_max_entries} por categoría` : "Sin límite"} aria-label="Cupo de parejas de esta categoría" />
            <div className="hint">Máximo de parejas para esta categoría. Vacío = el cupo por categoría del torneo.</div>
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Formato de partido</legend>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field"><label>Formato</label>
              <select name="format" defaultValue={fmtKey}>
                <option value="ONE_SET">A un set (6 games)</option>
                <option value="BEST_OF_3">Al mejor de 3 sets</option>
                <option value="BEST_OF_3_STB">Al mejor de 3, super tiebreak en el 3°</option>
                <option value="PRO_SET_9">Un set a 9 games</option>
                <option value="CUSTOM">Personalizado (usar campos de abajo)</option>
              </select></div>
            <div className="field"><label>Personalizado: sets para ganar</label><input type="number" name="setsToWin" min={1} max={3} defaultValue={r.format.setsToWin} /></div>
            <div className="field"><label>Personalizado: games por set</label><input type="number" name="gamesPerSet" min={1} max={12} defaultValue={r.format.gamesPerSet} /></div>
            <div className="field"><label>Personalizado: puntos del super tiebreak</label><input type="number" name="superTiebreakPoints" min={5} max={15} defaultValue={r.format.superTiebreakPoints} /></div>
          </div>
          <div className="field" style={{ maxWidth: 420 }}><label>Tiebreak</label>
            <select name="tb" defaultValue={!r.format.tiebreak ? "NONE" : r.format.tiebreakAt === r.format.gamesPerSet - 1 ? "AT_G1" : "AT_G"}>
              <option value="AT_G">Tiebreak en {r.format.gamesPerSet}-{r.format.gamesPerSet} (el set termina {r.format.gamesPerSet + 1}-{r.format.gamesPerSet})</option>
              <option value="AT_G1">Tiebreak en {r.format.gamesPerSet - 1}-{r.format.gamesPerSet - 1} (el set termina {r.format.gamesPerSet}-{r.format.gamesPerSet - 1})</option>
              <option value="NONE">Sin tiebreak (se sigue hasta 2 games de diferencia)</option>
            </select>
            <div className="hint">Se aplica a cualquier formato elegido arriba.</div></div>
          <label className="checkbox"><input type="checkbox" name="superTiebreakDecider" defaultChecked={r.format.superTiebreakDecider} /> Super tiebreak en lugar del set decisivo</label>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Criterios de desempate (en orden)</legend>
          <p className="muted" style={{ fontSize: 13 }}>Elegí el criterio de cada lugar. El orden por defecto es: {DEFAULT_TIEBREAKS.map((c) => TIEBREAK_LABELS[c]).join(" → ")}.</p>
          {order.slice(0, 6).map((c, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <span style={{ width: 24 }}>{i + 1}.</span>
              <select name="tiebreaks" className="sm" defaultValue={i < r.tiebreaks.length ? c : ""}>
                <option value="">—</option>
                {allCriteria.map((k) => <option key={k} value={k}>{TIEBREAK_LABELS[k]}</option>)}
              </select>
            </div>
          ))}
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Zonas y clasificación</legend>
          <div className="grid grid-2" style={{ gap: 12 }}>
<label className="checkbox span-2 fixed16"><input type="checkbox" name="fixed16" defaultChecked={!!r.qualification.fixedTotal} /> <span><b>Siempre 16 al playoff</b> — pasan todos los 1°, después los 2° y después los mejores 3° (comparando entre zonas) hasta completar 16. Los primeros se siembran por rendimiento. Si está activado, no se usan «Clasifican por zona» ni «Mejores del puesto siguiente».</span></label>
            <div className="field"><label>Tamaño de zona preferido</label><input type="number" name="preferredZoneSize" min={2} max={8} defaultValue={r.preferredZoneSize} /></div>
            <div className="field"><label>Clasifican por zona</label>
              <select name="perZone" defaultValue={String(r.qualification.perZone)}>
                <option value="ALL">Todas</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></div>
            <label className="checkbox" style={{ alignSelf: "center" }}><input type="checkbox" name="fourGvg" defaultChecked={r.fourZone === "GVG"} /> Zonas de 4: GvG/PvP (A vs B y C vs D; después ganadores contra ganadores y perdedores contra perdedores). Si clasifican todas, se usa siempre.</label>
            <label className="checkbox" style={{ alignSelf: "center" }}><input type="checkbox" name="pass3of4" defaultChecked={!!r.qualification.perZoneOf4} /> En las zonas de 4 pasan 3 (las demás siguen con lo de arriba)</label>
            <label className="checkbox" style={{ alignSelf: "center" }}><input type="checkbox" name="autoBestNext" defaultChecked={!!r.qualification.autoBestNext} /> Mejores siguientes automático: se suman los que hagan falta para completar el cuadro (8, 16, 32…){r.qualification.autoBestNext ? ` — hoy: ${r.qualification.bestNext}` : ""}</label>
            <div className="field"><label>Más los mejores del puesto siguiente</label><input type="number" name="bestNext" min={0} max={16} defaultValue={r.qualification.autoBestNext ? 0 : r.qualification.bestNext} />
              <div className="hint">Ej. 2 = clasifican además los 2 mejores terceros.</div></div>
            <div className="field"><label>Comparación entre zonas de distinto tamaño</label>
              <select name="crossZoneMode" defaultValue={r.crossZoneMode}>
                <option value="AVERAGES">Promedios por partido (recomendado)</option>
                <option value="DROP_VS_LAST">Descontar partidos contra el último</option>
              </select></div>
            <div className="field"><label>Retiro de pareja (opción por defecto)</label>
              <select name="withdrawalDefault" defaultValue={r.withdrawalDefault}>
                <option value="WO_PENDING">Mantener jugados, W.O. en pendientes</option>
                <option value="ANNUL_ALL">Anular todos sus partidos</option>
              </select></div>
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Puntos de ranking por instancia</legend>
          <div className="grid grid-4" style={{ gap: 12 }}>
            {STAGE_ORDER.map((s) => (
              <div key={s} className="field"><label>{STAGE_LABELS[s]}</label><input type="number" name={`points_${s}`} min={0} defaultValue={r.points[s]} /></div>
            ))}
          </div>
        </fieldset>
        {!disabled && <Submit className="btn primary">Guardar reglas</Submit>}
      </ActionForm>
    </div>
  );
}

/* ---------------------------------------------------------------- */

async function HistoryTab({ lc }: { lc: LoadedCategory }) {
  const rows = await sql<{ id: string; match_id: string; version: number; status: string; outcome: MatchOutcome | null; reason: string | null; created_at: Date; user_name: string | null; zone_id: string | null; bracket_code: string | null; entry_a: string | null; entry_b: string | null }[]>`
    SELECT v.id, v.match_id, v.version, v.status, v.outcome, v.reason, v.created_at, u.name AS user_name, m.zone_id, m.bracket_code, v.entry_a, v.entry_b
    FROM match_result_versions v JOIN matches m ON m.id = v.match_id LEFT JOIN users u ON u.id = v.user_id
    WHERE m.tc_id = ${lc.tc.id} ORDER BY v.created_at DESC LIMIT 500`;
  return (
    <div className="card flush">
      <div className="card-head"><h2>Historial de resultados</h2><span className="muted">Cada carga o corrección queda registrada; nada se pisa.</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Partido</th><th>Resultado</th><th>Estado</th><th>Usuario</th><th>Motivo</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
              <td>{r.bracket_code ?? `Zona ${lc.zones.find((z) => z.id === r.zone_id)?.name ?? "?"}`}: {entryLabel(lc.entryMap.get(r.entry_a ?? ""))} vs {entryLabel(lc.entryMap.get(r.entry_b ?? ""))} <span className="muted">v{r.version}</span></td>
              <td>{r.outcome ? scoreText(r.outcome) : "—"}</td>
              <td><StatusBadge status={r.status} /></td>
              <td>{r.user_name ?? "—"}</td>
              <td>{r.reason ?? ""}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">Sin cambios todavía.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
