/**
 * Motor de una categoría de torneo: combina zonas, posiciones, comparación entre zonas
 * y cuadro. Todo se DERIVA de los datos guardados (parejas, partidos y resultados),
 * así que cualquier corrección recalcula todo de forma consistente.
 */
import { summarize, type MatchFormat, type MatchOutcome, type ScoreSummary, FORMATS } from "./scoring";
import { computeStandings, rankAcrossZones, dropMatchesVsLast, DEFAULT_TIEBREAKS, type TiebreakCriterion, type ZoneStandings, type ZoneMatchInput } from "./standings";
import { resolveBracket, type BracketMatchDef, type ResolvedMatch, type CrossResult, type QualificationRule, stagesReached } from "./bracket";
import { DEFAULT_POINTS, type PointsTable } from "./ranking";

export type CrossZoneMode = "AVERAGES" | "DROP_VS_LAST";
export type WithdrawalPolicy = "WO_PENDING" | "ANNUL_ALL";

export interface CategoryRules {
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
  };
}

export interface ZoneData {
  id: string;
  name: string;
  entryIds: string[];
  manualOrder: string[];
  /** Parejas retiradas que siguen figurando en la zona (sus partidos jugados cuentan). */
  withdrawn?: string[];
}

export type MatchStatus = "PENDING" | "PLAYED" | "ANNULLED";

export interface ZoneMatchData {
  id: string;
  zoneId: string;
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
    standings.set(z.id, s);
  }

  // Comparación entre zonas para las posiciones que lo requieren
  const cross: CrossResult[] = [];
  const crossTies: Record<number, string[][]> = {};
  const per = rules.qualification.perZone;
  if (rules.qualification.bestNext > 0 && per !== "ALL") {
    const pos = per + 1;
    const minSize = Math.min(...st.zones.map((z) => z.entryIds.length));
    const rows = st.zones.flatMap((z) => {
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
  const entries = [...new Set(st.zones.flatMap((z) => z.entryIds))];
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
