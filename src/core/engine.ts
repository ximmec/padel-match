/**
 * Motor de una categoría de torneo: combina zonas, posiciones, comparación entre zonas
 * y cuadro. Todo se DERIVA de los datos guardados (parejas, partidos y resultados),
 * así que cualquier corrección recalcula todo de forma consistente.
 */
import { summarize, type MatchFormat, type MatchOutcome, type ScoreSummary, FORMATS } from "./scoring";
import { computeStandings, rankAcrossZones, dropMatchesVsLast, DEFAULT_TIEBREAKS, type TiebreakCriterion, type ZoneStandings, type ZoneMatchInput } from "./standings";
import { resolveBracket, qualifiersInZone, type BracketMatchDef, type ResolvedMatch, type CrossResult, type QualificationRule, stagesReached } from "./bracket";
import { DEFAULT_POINTS, type PointsTable } from "./ranking";

export type CrossZoneMode = "AVERAGES" | "DROP_VS_LAST";
export type WithdrawalPolicy = "WO_PENDING" | "ANNUL_ALL";

/** ZONES = zonas + playoffs. KNOCKOUT = eliminación directa (sin zonas). */
export type CompetitionMode = "ZONES" | "KNOCKOUT";

export interface CategoryRules {
  mode: CompetitionMode;
  /** Zonas de 4: todos contra todos (RR) o GvG/PvP (1ª ronda 1v4 y 2v3; después ganadores y perdedores). */
  fourZone: "RR" | "GVG";
  /** Cupo de parejas de esta categoría (si no se indica, se usa el cupo por categoría del torneo). */
  maxEntries?: number | null;
  format: MatchFormat;
  tiebreaks: TiebreakCriterion[];
  qualification: QualificationRule;
  crossZoneMode: CrossZoneMode;
  points: PointsTable;
  withdrawalDefault: WithdrawalPolicy;
  /** Tamaño de zona preferido para la generación automática. */
  preferredZoneSize: number;
}

export const DEFAULT_RULES: CategoryRules = {
  mode: "ZONES",
  fourZone: "RR",
  format: FORMATS.BEST_OF_3_STB,
  tiebreaks: DEFAULT_TIEBREAKS,
  qualification: { perZone: 2, bestNext: 0 },
  crossZoneMode: "AVERAGES",
  points: DEFAULT_POINTS,
  withdrawalDefault: "WO_PENDING",
  preferredZoneSize: 3,
};

export function normalizeRules(raw: Partial<CategoryRules> | null | undefined): CategoryRules {
  const r = { ...DEFAULT_RULES, ...(raw ?? {}) };
  return {
    ...r,
    format: { ...DEFAULT_RULES.format, ...(raw?.format ?? {}) },
    points: { ...DEFAULT_RULES.points, ...(raw?.points ?? {}) },
    qualification: { ...DEFAULT_RULES.qualification, ...(raw?.qualification ?? {}) },
    tiebreaks: raw?.tiebreaks?.length ? raw.tiebreaks : DEFAULT_RULES.tiebreaks,
    mode: raw?.mode === "KNOCKOUT" ? "KNOCKOUT" : "ZONES",
    fourZone: raw?.fourZone === "GVG" ? "GVG" : "RR",
  };
}

export interface ZoneData {
  id: string;
  name: string;
  entryIds: string[];
  manualOrder: string[];
  /** Parejas retiradas que siguen figurando en la zona (sus partidos jugados cuentan). */
  withdrawn?: string[];
  /** RR = todos contra todos; GVG = 1ª ronda 1v4/2v3 y 2ª ronda ganadores vs ganadores, perdedores vs perdedores. */
  format?: "RR" | "GVG";
  /** Partidos de la zona cuyas parejas todavía no se conocen (2ª ronda GvG). */
  unresolved?: number;
}

export type MatchStatus = "PENDING" | "PLAYED" | "ANNULLED";

export interface ZoneMatchData {
  id: string;
  zoneId: string;
  round?: number;
  slot?: "GVG" | "PVP" | null;
  a: string;
  b: string;
  status: MatchStatus;
  outcome: MatchOutcome | null;
}

export interface BracketResultData { code: string; entryA: string; entryB: string; outcome: MatchOutcome }

export interface CategoryState {
  zones: ZoneData[];
  zoneMatches: ZoneMatchData[];
  bracket: BracketMatchDef[];
  bracketResults: BracketResultData[];
  /** Orden manual para desempatar comparaciones entre zonas, por posición. */
  crossManualOrder: Record<number, string[]>;
}

export interface CategoryView {
  standings: Map<string, ZoneStandings>;
  cross: CrossResult[];
  crossTies: Record<number, string[][]>;
  bracket: ResolvedMatch[];
  summaries: Map<string, ScoreSummary>;
  errors: { matchId: string; message: string }[];
}

export function zoneMatchInputs(rules: CategoryRules, matches: ZoneMatchData[], summaries: Map<string, ScoreSummary>, errors: CategoryView["errors"]): ZoneMatchInput[] {
  return matches
    .filter((m) => m.status !== "ANNULLED")
    .map((m) => {
      let s: ScoreSummary | null = null;
      if (m.status === "PLAYED" && m.outcome) {
        try { s = summarize(rules.format, m.outcome); summaries.set(m.id, s); }
        catch (e) { errors.push({ matchId: m.id, message: (e as Error).message }); }
      }
      return { id: m.id, a: m.a, b: m.b, summary: s };
    });
}

/**
 * Posiciones de una zona GvG/PvP: 1° ganador de ganadores, 2° perdedor de ganadores,
 * 3° ganador de perdedores, 4° perdedor de perdedores. Las estadísticas (sets, games) se mantienen.
 */
/**
 * Formato efectivo de las zonas de 4: si clasifican TODAS, siempre ganador vs ganador / perdedor vs perdedor
 * (así todas las parejas juegan 2 partidos, como en las zonas de 3). Si no, lo que diga la regla.
 */
export function fourZoneFormat(rules: Pick<CategoryRules, "fourZone" | "qualification">): "GVG" | "RR" {
  return rules.qualification.perZone === "ALL" ? "GVG" : rules.fourZone;
}

export function gvgStandings(base: ZoneStandings, z: ZoneData, inputs: ZoneMatchInput[], all: ZoneMatchData[]): ZoneStandings {
  const meta = new Map(all.map((m) => [m.id, m]));
  const winnerOf = (m: ZoneMatchInput) => (m.summary ? (m.summary.winner === "A" ? m.a : m.b) : null);
  const loserOf = (m: ZoneMatchInput) => (m.summary ? (m.summary.winner === "A" ? m.b : m.a) : null);
  const r1 = inputs.filter((m) => (meta.get(m.id)?.round ?? 1) === 1);
  const g = inputs.find((m) => meta.get(m.id)?.slot === "GVG");
  const p = inputs.find((m) => meta.get(m.id)?.slot === "PVP");
  const byId = new Map(base.rows.map((r) => [r.entryId, r]));
  const unresolved = z.unresolved ?? 0;
  let order: string[] | null = null;
  let final = false;
  if (g?.summary && p?.summary) {
    order = [winnerOf(g)!, loserOf(g)!, winnerOf(p)!, loserOf(p)!];
    final = unresolved === 0;
  } else if (r1.length >= 2 && r1.every((m) => m.summary)) {
    const winners = new Set(r1.map(winnerOf));
    order = [...base.rows.filter((r) => winners.has(r.entryId)), ...base.rows.filter((r) => !winners.has(r.entryId))].map((r) => r.entryId);
  }
  if (!order || order.some((id) => !byId.has(id))) {
    return { ...base, complete: base.complete && unresolved === 0, pendingMatches: base.pendingMatches + unresolved, final: base.final && unresolved === 0 };
  }
  const rows = [...order.map((id) => byId.get(id)!), ...base.rows.filter((r) => !order!.includes(r.entryId))]
    .map((r, i) => ({ ...r, position: i + 1, unresolvedTie: false, decidedBy: null }));
  return { rows, complete: final, pendingMatches: base.pendingMatches + unresolved, final };
}

export function evaluateCategory(rules: CategoryRules, st: CategoryState): CategoryView {
  const summaries = new Map<string, ScoreSummary>();
  const errors: CategoryView["errors"] = [];
  const standings = new Map<string, ZoneStandings>();
  const inputsByZone = new Map<string, ZoneMatchInput[]>();
  for (const z of st.zones) {
    const inputs = zoneMatchInputs(rules, st.zoneMatches.filter((m) => m.zoneId === z.id), summaries, errors);
    inputsByZone.set(z.id, inputs);
    const s = computeStandings(z.entryIds, inputs, rules.tiebreaks, z.manualOrder);
    // Las parejas retiradas nunca clasifican: van al fondo de la tabla.
    const out = z.withdrawn?.length ? s.rows.filter((r) => z.withdrawn!.includes(r.entryId)) : [];
    if (out.length) {
      const keep = s.rows.filter((r) => !z.withdrawn!.includes(r.entryId));
      const oldPos = new Map(s.rows.map((r) => [r.entryId, r.position]));
      for (const r of keep) r.position = oldPos.get(r.entryId)! - out.filter((o) => oldPos.get(o.entryId)! < oldPos.get(r.entryId)!).length;
      out.forEach((r, i) => { r.position = keep.length + i + 1; r.unresolvedTie = false; });
      s.rows = [...keep, ...out];
      s.final = s.complete && !keep.some((r) => r.unresolvedTie);
    }
    standings.set(z.id, z.format === "GVG" ? gvgStandings(s, z, inputs, st.zoneMatches) : s);
  }

  // Comparación entre zonas para las posiciones que lo requieren
  const cross: CrossResult[] = [];
  const crossTies: Record<number, string[][]> = {};
  const per = rules.qualification.perZone;
  if (rules.qualification.bestNext > 0 && per !== "ALL") {
    const pos = per + 1;
    const minSize = Math.min(...st.zones.map((z) => z.entryIds.length));
    const rows = st.zones.filter((z) => qualifiersInZone(z.entryIds.length, rules.qualification) < pos).flatMap((z) => {
      const s = standings.get(z.id)!;
      const row = s.rows.find((r) => r.position === pos && !r.unresolvedTie) ?? s.rows[pos - 1];
      if (!row) return [];
      let useRow = row;
      if (rules.crossZoneMode === "DROP_VS_LAST" && z.entryIds.length > minSize) {
        const filtered = dropMatchesVsLast(s, inputsByZone.get(z.id)!, z.entryIds.length - minSize);
        const re = computeStandings(z.entryIds, filtered, rules.tiebreaks, z.manualOrder);
        useRow = re.rows.find((r) => r.entryId === row.entryId) ?? row;
      }
      return [{ entryId: row.entryId, zoneId: z.id, row: useRow }];
    });
    const allFinal = st.zones.every((z) => standings.get(z.id)!.final);
    const { ordered, ties } = rankAcrossZones(rows, st.crossManualOrder[pos] ?? []);
    crossTies[pos] = ties;
    cross.push({ pos, final: allFinal && ties.length === 0, order: ordered.map((r) => r.entryId) });
  }

  const zoneResults = st.zones.map((z) => {
    const s = standings.get(z.id)!;
    return { zoneId: z.id, final: s.final, order: s.rows.map((r) => r.entryId) };
  });

  const bracketResults = st.bracketResults.flatMap((r) => {
    try {
      const s = summarize(rules.format, r.outcome);
      summaries.set(`B:${r.code}`, s);
      return [{ code: r.code, entryA: r.entryA, entryB: r.entryB, winnerEntryId: s.winner === "A" ? r.entryA : r.entryB }];
    } catch (e) {
      errors.push({ matchId: r.code, message: (e as Error).message });
      return [];
    }
  });

  const bracket = st.bracket.length ? resolveBracket(st.bracket, zoneResults, cross, bracketResults) : [];
  return { standings, cross, crossTies, bracket, summaries, errors };
}

/** Etapas alcanzadas por todas las parejas de la categoría. */
export function categoryStages(st: CategoryState, view: CategoryView) {
  const inBracket = view.bracket.flatMap((m) => [m.a, m.b]).flatMap((r) => (r.kind === "ENTRY" ? [r.entryId] : []));
  const entries = [...new Set([...st.zones.flatMap((z) => z.entryIds), ...inBracket])];
  if (!view.bracket.length) return { stages: new Map(entries.map((e) => [e, "ZONE" as const])), complete: false };
  return stagesReached(entries, view.bracket);
}

/**
 * Política de retiro de una pareja dentro de una zona.
 * Devuelve los cambios a aplicar a los partidos de esa pareja.
 */
export function withdrawalChanges(entryId: string, matches: ZoneMatchData[], policy: WithdrawalPolicy): { matchId: string; status: MatchStatus; outcome: MatchOutcome | null }[] {
  const mine = matches.filter((m) => m.a === entryId || m.b === entryId);
  if (policy === "ANNUL_ALL") return mine.map((m) => ({ matchId: m.id, status: "ANNULLED", outcome: m.outcome }));
  return mine
    .filter((m) => m.status === "PENDING")
    .map((m) => ({ matchId: m.id, status: "PLAYED", outcome: { kind: "WALKOVER", winner: m.a === entryId ? "B" : "A" } }));
}
