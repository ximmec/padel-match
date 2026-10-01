import type { ReactNode } from "react";
import type { LoadedCategory, MatchRow, EntryRow } from "@/server/category";
import { entryLabel, resolvedLabel } from "@/server/category";
import { roundName, type ResolvedMatch } from "@/core/bracket";
import type { MatchOutcome } from "@/core/scoring";
import { TIEBREAK_LABELS } from "@/core/standings";
import { fmtDateTime } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    PENDING: ["", "Pendiente"],
    IN_PLAY: ["live", "En juego"],
    PLAYED: ["ok", "Finalizado"],
    ANNULLED: ["err", "Anulado"],
    DRAFT: ["", "Borrador"],
    OPEN: ["info", "Inscripción abierta"],
    IN_PROGRESS: ["live", "En curso"],
    FINISHED: ["ok", "Finalizado"],
    CANCELLED: ["err", "Cancelado"],
    REGISTRATION: ["info", "Inscripción"],
    ZONES: ["warn", "Fase de zonas"],
    PLAYOFFS: ["lime", "Playoffs"],
    ACTIVE: ["ok", "Activa"],
    WITHDRAWN: ["err", "Retirada"],
  };
  const [cls, label] = map[status] ?? ["", status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function SetScores({ outcome, side }: { outcome: MatchOutcome | null; side: "A" | "B" }) {
  if (!outcome) return null;
  if (outcome.kind === "WALKOVER") return <span className="sets"><span>{outcome.winner === side ? "W.O." : ""}</span></span>;
  return (
    <span className="sets">
      {outcome.sets.map((s, i) => <span key={i}>{side === "A" ? s[0] : s[1]}</span>)}
      {outcome.kind === "RETIRED" && outcome.winner !== side && <span style={{ fontSize: 11 }}>ret.</span>}
    </span>
  );
}

export function winnerSide(outcome: MatchOutcome | null, lc: LoadedCategory, m: MatchRow): "A" | "B" | null {
  if (m.status !== "PLAYED" || !outcome) return null;
  const s = lc.view.summaries.get(m.phase === "ZONE" ? m.id : `B:${m.bracket_code}`);
  return s?.winner ?? null;
}

/** Tarjeta de partido de solo lectura. */
export function MatchLine({ lc, m, extra, showCategory }: { lc: LoadedCategory; m: MatchRow; extra?: ReactNode; showCategory?: boolean }) {
  let a = "", b = "";
  let stage = "";
  if (m.phase === "ZONE") {
    a = entryLabel(lc.entryMap.get(m.entry_a!));
    b = entryLabel(lc.entryMap.get(m.entry_b!));
    stage = `Zona ${lc.zones.find((z) => z.id === m.zone_id)?.name ?? "?"}`;
  } else {
    const rm = lc.view.bracket.find((x) => x.code === m.bracket_code);
    if (rm) {
      a = resolvedLabel(rm.a, lc.entryMap);
      b = resolvedLabel(rm.b, lc.entryMap);
      const n = lc.view.bracket.filter((x) => x.round === rm.round).length;
      stage = roundName(n);
    }
  }
  const w = winnerSide(m.outcome, lc, m);
  return (
    <div className="match">
      <div>
        <div className={`side ${w === "A" ? "win" : w ? "lose" : ""}`}>{a}</div>
        <div className={`side ${w === "B" ? "win" : w ? "lose" : ""}`}>{b}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        {m.status === "PLAYED" ? (
          <div>
            <SetScores outcome={m.outcome} side="A" />
            <SetScores outcome={m.outcome} side="B" />
          </div>
        ) : <StatusBadge status={m.status} />}
      </div>
      <div className="meta">
        {showCategory && <span className="badge">{lc.tc.category_name}</span>}
        <span>{stage}</span>
        {m.scheduled_at && <span>🕒 {fmtDateTime(m.scheduled_at)}</span>}
        {m.court_name && <span>📍 {m.court_name}</span>}
        {m.status === "PLAYED" && <StatusBadge status="PLAYED" />}
        {extra}
      </div>
    </div>
  );
}

export function StandingsTable({ lc, zoneId, compact = false }: { lc: LoadedCategory; zoneId: string; compact?: boolean }) {
  const s = lc.view.standings.get(zoneId);
  const zone = lc.zones.find((z) => z.id === zoneId);
  if (!s || !zone) return null;
  const per = lc.rules.qualification.perZone;
  const qualifies = (pos: number) => per === "ALL" || pos <= per;
  const crossPos = per === "ALL" ? null : per + 1;
  const crossQualified = new Set(
    lc.view.cross.flatMap((c) => (c.final ? c.order.slice(0, lc.rules.qualification.bestNext) : [])),
  );
  const withdrawn = new Set(lc.entries.filter((e) => e.status === "WITHDRAWN").map((e) => e.id));
  return (
    <div className="card flush">
      <div className="card-head">
        <h3>Zona {zone.name}</h3>
        <div className="row">
          {s.final ? <span className="badge ok">Definida</span> : s.complete ? <span className="badge warn">Empate a resolver</span> : <span className="badge">{s.pendingMatches} partido(s) pendiente(s)</span>}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th><th>Pareja</th>
              <th className="num" title="Partidos jugados">PJ</th><th className="num" title="Ganados">PG</th>
              {!compact && <th className="num hide-sm" title="Perdidos">PP</th>}
              <th className="num" title="Sets">Sets</th>
              <th className="num" title="Games">Games</th>
              {!compact && <th className="hide-sm">Definido por</th>}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => {
              const q = !withdrawn.has(r.entryId) && s.final && (qualifies(r.position) || (crossPos === r.position && crossQualified.has(r.entryId)));
              return (
                <tr key={r.entryId} className={`${q ? "q" : ""} ${withdrawn.has(r.entryId) ? "out" : ""}`}>
                  <td className="num">{r.unresolvedTie ? `${r.position}=` : r.position}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{entryLabel(lc.entryMap.get(r.entryId))}{withdrawn.has(r.entryId) && <> <span className="badge err">Retirada</span></>}</td>
                  <td className="num">{r.played}</td>
                  <td className="num"><b>{r.won}</b></td>
                  {!compact && <td className="num hide-sm">{r.lost}</td>}
                  <td className="num">{r.setsFor}-{r.setsAgainst}</td>
                  <td className="num">{r.gamesFor}-{r.gamesAgainst}</td>
                  {!compact && <td className="hide-sm muted" style={{ fontSize: 12 }}>{r.unresolvedTie ? "⚠ Empate sin resolver" : r.decidedBy ? TIEBREAK_LABELS[r.decidedBy] : ""}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function slotScore(lc: LoadedCategory, rm: ResolvedMatch, side: "A" | "B") {
  const row = lc.matches.find((m) => m.phase === "BRACKET" && m.bracket_code === rm.code);
  if (!row || row.status !== "PLAYED" || !row.outcome || rm.staleResult) return null;
  if (row.outcome.kind === "WALKOVER") return row.outcome.winner === side ? "W.O." : "";
  return row.outcome.sets.map((s) => (side === "A" ? s[0] : s[1])).join(" ");
}

export function BracketView({ lc, zoneNames, renderFoot }: { lc: LoadedCategory; zoneNames: Record<string, string>; renderFoot?: (rm: ResolvedMatch, row: MatchRow | undefined) => ReactNode }) {
  const rounds = [...new Set(lc.view.bracket.map((m) => m.round))].sort((a, b) => a - b);
  if (!rounds.length) return <div className="empty">El cuadro todavía no fue generado.</div>;
  const def = (code: string) => lc.tc.bracket.find((d) => d.code === code)!;
  const pendingLabel = (code: string, side: "a" | "b") => {
    const r = def(code)[side];
    if (r.t === "ZONE") return `${r.pos}° Zona ${zoneNames[r.zone] ?? "?"}`;
    if (r.t === "CROSS") return `${r.rank}° mejor ${r.pos}°`;
    if (r.t === "WINNER") return `Ganador ${r.match}`;
    return "A definir";
  };
  return (
    <div className="bracket">
      {rounds.map((r) => {
        const ms = lc.view.bracket.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
        return (
          <div className="round-col" key={r}>
            <div className="round-title">{roundName(ms.length)}</div>
            <div className="round">
            {ms.map((m) => {
              const row = lc.matches.find((x) => x.phase === "BRACKET" && x.bracket_code === m.code);
              const sideEl = (s: "A" | "B") => {
                const res = s === "A" ? m.a : m.b;
                const isWin = m.winner && res.kind === "ENTRY" && res.entryId === m.winner;
                return (
                  <div className={`slot ${isWin ? "win" : ""} ${res.kind === "PENDING" ? "tbd" : ""}`}>
                    <span>{res.kind === "ENTRY" ? entryLabel(lc.entryMap.get(res.entryId)) : res.kind === "BYE" ? "Pase libre" : pendingLabel(m.code, s === "A" ? "a" : "b")}</span>
                    <span className="sc">{slotScore(lc, m, s)}</span>
                  </div>
                );
              };
              const isBye = m.byeAdvance || m.a.kind === "BYE" || m.b.kind === "BYE";
              return (
                <div className={`bm ${m.staleResult ? "stale" : ""}`} key={m.code}>
                  {sideEl("A")}
                  {sideEl("B")}
                  <div className="foot">
                    <span className="code">{m.code}</span>{" "}
                    {m.staleResult && <span className="badge warn">Resultado a revisar</span>}{" "}
                    {!isBye && row?.scheduled_at && <>🕒 {fmtDateTime(row.scheduled_at)} {row.court_name ? `· ${row.court_name}` : ""}</>}
                    {renderFoot?.(m, row)}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="card narrow" style={{ margin: "24px auto" }}>
      <h2>Sin permiso</h2>
      <p>Tu usuario no tiene permiso para ver esta sección. Pedíselo a un administrador.</p>
    </div>
  );
}

export function EntryNames({ e }: { e: EntryRow }) {
  return <>{e.players.map((p) => `${p.first_name} ${p.last_name}`).join(" / ")}</>;
}
