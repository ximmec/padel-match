import type { ReactNode } from "react";
import type { LoadedCategory, MatchRow, EntryRow } from "@/server/category";
import { entryLabel, resolvedLabel, zoneSideLabel } from "@/server/category";
import type { ResolvedMatch } from "@/core/bracket";
import type { MatchOutcome } from "@/core/scoring";
import { fmtDateTime } from "@/lib/format";
import { dict, type Lang } from "@/i18n";

const BADGE: Record<string, string> = {
  PENDING: "", IN_PLAY: "live", PLAYED: "ok", ANNULLED: "err", DRAFT: "", OPEN: "info", IN_PROGRESS: "live", FINISHED: "ok",
  CANCELLED: "err", REGISTRATION: "info", ZONES: "warn", PLAYOFFS: "lime", ACTIVE: "ok", WITHDRAWN: "err",
};

export function StatusBadge({ status, lang = "es" }: { status: string; lang?: Lang }) {
  return <span className={`badge ${BADGE[status] ?? ""}`}>{dict(lang).status[status] ?? status}</span>;
}

export function SetScores({ outcome, side, lang = "es" }: { outcome: MatchOutcome | null; side: "A" | "B"; lang?: Lang }) {
  if (!outcome) return null;
  if (outcome.kind === "WALKOVER") return <span className="sets"><span>{outcome.winner === side ? dict(lang).g.wo : ""}</span></span>;
  if (outcome.kind === "WINNER") return <span className="sets"><span>{outcome.winner === side ? "✓" : ""}</span></span>;
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
export function MatchLine({ lc, m, extra, showCategory, lang = "es" }: { lc: LoadedCategory; m: MatchRow; extra?: ReactNode; showCategory?: boolean; lang?: Lang }) {
  const t = dict(lang);
  let a = "", b = "";
  let stage = "";
  if (m.phase === "ZONE") {
    a = zoneSideLabel(lc, m, "a", lang);
    b = zoneSideLabel(lc, m, "b", lang);
    stage = t.g.zone(lc.zones.find((z) => z.id === m.zone_id)?.name ?? "?");
  } else {
    const rm = lc.view.bracket.find((x) => x.code === m.bracket_code);
    if (rm) {
      a = resolvedLabel(rm.a, lc.entryMap, undefined, lang);
      b = resolvedLabel(rm.b, lc.entryMap, undefined, lang);
      const n = lc.view.bracket.filter((x) => x.round === rm.round).length;
      stage = t.g.round(n);
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
            <SetScores outcome={m.outcome} side="A" lang={lang} />
            <SetScores outcome={m.outcome} side="B" lang={lang} />
          </div>
        ) : <StatusBadge status={m.status} lang={lang} />}
      </div>
      <div className="meta">
        {showCategory && <span className="badge">{lc.tc.category_name}</span>}
        <span>{stage}</span>
        {m.scheduled_at && <span>🕒 {fmtDateTime(m.scheduled_at, lang)}</span>}
        {m.court_name && <span>📍 {m.court_name}</span>}
        {m.status === "PLAYED" && <StatusBadge status="PLAYED" lang={lang} />}
        {extra}
      </div>
    </div>
  );
}

export function StandingsTable({ lc, zoneId, compact = false, lang = "es" }: { lc: LoadedCategory; zoneId: string; compact?: boolean; lang?: Lang }) {
  const t = dict(lang), T = t.standings;
  const s = lc.view.standings.get(zoneId);
  const zone = lc.zones.find((z) => z.id === zoneId);
  if (!s || !zone) return null;
  const per = lc.rules.qualification.perZone;
  const fixed = !!lc.rules.qualification.fixedTotal;
  const qualifies = (pos: number) => !fixed && (per === "ALL" || pos <= per);
  const crossPos = fixed ? null : per === "ALL" ? null : per + 1;
  const crossQualified = new Set(
    lc.view.cross.flatMap((c) => (c.final ? c.order.slice(0, c.take ?? lc.rules.qualification.bestNext) : [])),
  );
  const withdrawn = new Set(lc.entries.filter((e) => e.status === "WITHDRAWN").map((e) => e.id));
  return (
    <div className="card flush">
      <div className="card-head">
        <h3>{t.g.zone(zone.name)}</h3>
        <div className="row">
          {s.final ? <span className="badge ok">{T.defined}</span> : s.complete ? <span className="badge warn">{T.tie}</span> : <span className="badge">{T.pending(s.pendingMatches)}</span>}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th><th>{T.pair}</th>
              <th className="num" title={T.pjT}>{T.pj}</th><th className="num" title={T.pgT}>{T.pg}</th>
              {!compact && <th className="num hide-sm" title={T.ppT}>{T.pp}</th>}
              <th className="num" title={T.sets}>{T.sets}</th>
              <th className="num" title={T.games}>{T.games}</th>
              {!compact && <th className="hide-sm">{T.decided}</th>}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => {
              const q = !withdrawn.has(r.entryId) && s.final && (qualifies(r.position) || ((fixed || crossPos === r.position) && crossQualified.has(r.entryId)));
              return (
                <tr key={r.entryId} className={`${q ? "q" : ""} ${withdrawn.has(r.entryId) ? "out" : ""}`}>
                  <td className="num">{r.unresolvedTie ? `${r.position}=` : r.position}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{entryLabel(lc.entryMap.get(r.entryId))}{withdrawn.has(r.entryId) && <> <span className="badge err">{T.withdrawn}</span></>}</td>
                  <td className="num">{r.played}</td>
                  <td className="num"><b>{r.won}</b></td>
                  {!compact && <td className="num hide-sm">{r.lost}</td>}
                  <td className="num">{r.setsFor}-{r.setsAgainst}</td>
                  <td className="num">{r.gamesFor}-{r.gamesAgainst}</td>
                  {!compact && <td className="hide-sm muted" style={{ fontSize: 12 }}>{r.unresolvedTie ? T.unresolved : r.decidedBy ? t.g.tiebreak[r.decidedBy] : ""}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function slotScore(lc: LoadedCategory, rm: ResolvedMatch, side: "A" | "B", lang: Lang) {
  const row = lc.matches.find((m) => m.phase === "BRACKET" && m.bracket_code === rm.code);
  if (!row || row.status !== "PLAYED" || !row.outcome || rm.staleResult) return null;
  if (row.outcome.kind === "WALKOVER") return row.outcome.winner === side ? dict(lang).g.wo : "";
  if (row.outcome.kind === "WINNER") return row.outcome.winner === side ? "🏆" : "";
  return row.outcome.sets.map((s) => (side === "A" ? s[0] : s[1])).join(" ");
}

export function BracketView({ lc, zoneNames, renderFoot, renderSide, lang = "es" }: {
  lc: LoadedCategory; zoneNames: Record<string, string>; lang?: Lang;
  renderFoot?: (rm: ResolvedMatch, row: MatchRow | undefined) => ReactNode;
  /** Envuelve cada lado del partido (para el menú de acciones del organizador). */
  renderSide?: (rm: ResolvedMatch, row: MatchRow | undefined, side: "a" | "b", slot: ReactNode) => ReactNode;
}) {
  const rounds = [...new Set(lc.view.bracket.map((m) => m.round))].sort((a, b) => a - b);
  const t = dict(lang);
  if (!rounds.length) return <div className="empty">{t.bracket.none}</div>;
  const def = (code: string) => lc.tc.bracket.find((d) => d.code === code)!;
  const pendingLabel = (code: string, side: "a" | "b") => {
    const r = def(code)[side];
    if (r.t === "ZONE") return t.g.zonePos(r.pos, zoneNames[r.zone] ?? "?");
    if (r.t === "CROSS") return t.g.bestPos(r.rank, r.pos);
    if (r.t === "WINNER") return t.g.winnerOf(r.match);
    return t.g.tbd;
  };
  return (
    <div className="bracket">
      {rounds.map((r) => {
        const ms = lc.view.bracket.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
        return (
          <div className="round-col" key={r}>
            <div className="round-title">{t.g.round(ms.length)}</div>
            <div className="round">
            {ms.map((m) => {
              const row = lc.matches.find((x) => x.phase === "BRACKET" && x.bracket_code === m.code);
              const sideEl = (s: "A" | "B") => {
                const res = s === "A" ? m.a : m.b;
                const isWin = m.winner && res.kind === "ENTRY" && res.entryId === m.winner;
                const isLose = !!m.winner && res.kind === "ENTRY" && !isWin;
                const manual = def(m.code)[s === "A" ? "a" : "b"].t === "ENTRY";
                const el = (
                  <div className={`slot ${isWin ? "win" : ""} ${isLose ? "lose" : ""} ${res.kind === "PENDING" ? "tbd" : ""}`}>
                    <span>{res.kind === "ENTRY" ? entryLabel(lc.entryMap.get(res.entryId)) : res.kind === "BYE" ? t.g.bye : pendingLabel(m.code, s === "A" ? "a" : "b")}{manual && renderSide && <span className="manual-tag" title="Elegida a mano: no la cambia el cálculo automático"> ✋</span>}</span>
                    <span className="sc">{slotScore(lc, m, s, lang)}</span>
                  </div>
                );
                return renderSide ? renderSide(m, row, s === "A" ? "a" : "b", el) : el;
              };
              const isBye = m.byeAdvance || m.a.kind === "BYE" || m.b.kind === "BYE";
              return (
                <div className={`bm ${m.staleResult ? "stale" : ""}`} key={m.code}>
                  {sideEl("A")}
                  {sideEl("B")}
                  <div className="foot">
                    <span className="code">{m.code}</span>{" "}
                    {m.staleResult && <span className="badge warn">{t.bracket.review}</span>}{" "}
                    {!isBye && row?.scheduled_at && <>🕒 {fmtDateTime(row.scheduled_at, lang)} {row.court_name ? `· ${row.court_name}` : ""}</>}
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
