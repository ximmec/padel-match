/**
 * Carga una categoría de torneo desde la base y la evalúa con el motor de dominio.
 */
import type { Db } from "./db";
import { UserError } from "./db";
import {
  evaluateCategory, normalizeRules, categoryStages,
  type CategoryRules, type CategoryState, type CategoryView, type ZoneMatchData, type MatchStatus,
} from "@/core/engine";
import type { BracketMatchDef, Resolved } from "@/core/bracket";
import type { MatchOutcome } from "@/core/scoring";

export interface TcRow {
  id: string;
  tournament_id: string;
  category_id: string;
  rules: Partial<CategoryRules>;
  bracket: BracketMatchDef[];
  cross_manual_order: Record<string, string[]>;
  status: string;
  version: number;
  points_awarded_at: Date | null;
  category_name: string;
  gender_rule: string;
  tournament_name: string;
  tournament_slug: string;
  org_id: string;
  circuit_id: string | null;
  season_id: string | null;
}

export interface EntryRow {
  id: string;
  seed: number | null;
  status: "ACTIVE" | "WITHDRAWN";
  withdrawal_policy: string | null;
  players: { id: string; code: string; first_name: string; last_name: string; slot: number }[];
  former: { id: string; first_name: string; last_name: string; slot: number; replaced_at: Date }[];
}

export interface MatchRow {
  id: string;
  phase: "ZONE" | "BRACKET";
  zone_id: string | null;
  bracket_code: string | null;
  round: number;
  entry_a: string | null;
  entry_b: string | null;
  status: "PENDING" | "IN_PLAY" | "PLAYED" | "ANNULLED";
  outcome: MatchOutcome | null;
  court_id: string | null;
  court_name: string | null;
  scheduled_at: Date | null;
  schedule_locked: boolean;
  version: number;
  updated_at: Date;
}

export interface ZoneRow { id: string; name: string; sort: number; manual_order: string[]; entry_ids: string[] }

export interface LoadedCategory {
  tc: TcRow;
  rules: CategoryRules;
  entries: EntryRow[];
  entryMap: Map<string, EntryRow>;
  zones: ZoneRow[];
  matches: MatchRow[];
  state: CategoryState;
  view: CategoryView;
}

export async function loadTc(db: Db, tcId: string, orgId: string | null): Promise<TcRow> {
  const [tc] = await db<TcRow[]>`
    SELECT tc.*, c.name AS category_name, c.gender_rule, t.name AS tournament_name, t.slug AS tournament_slug,
           t.org_id, t.circuit_id, t.season_id
    FROM tournament_categories tc
    JOIN tournaments t ON t.id = tc.tournament_id
    JOIN categories c ON c.id = tc.category_id
    WHERE tc.id = ${tcId} ${orgId ? db`AND t.org_id = ${orgId}` : db``}`;
  if (!tc) throw new UserError("Categoría de torneo no encontrada.");
  return tc;
}

export async function loadCategory(db: Db, tcId: string, orgId: string | null, opts: { lock?: boolean } = {}): Promise<LoadedCategory> {
  if (opts.lock) await db`SELECT id FROM tournament_categories WHERE id = ${tcId} FOR UPDATE`;
  const tc = await loadTc(db, tcId, orgId);
  const rules = normalizeRules(tc.rules);

  const entries = await db<EntryRow[]>`
    SELECT e.id, e.seed, e.status, e.withdrawal_policy,
      COALESCE((SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'first_name', p.first_name, 'last_name', p.last_name, 'slot', ep.slot) ORDER BY ep.slot)
                FROM entry_players ep JOIN players p ON p.id = ep.player_id
                WHERE ep.entry_id = e.id AND ep.replaced_at IS NULL), '[]') AS players,
      COALESCE((SELECT json_agg(json_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'slot', ep.slot, 'replaced_at', ep.replaced_at) ORDER BY ep.replaced_at)
                FROM entry_players ep JOIN players p ON p.id = ep.player_id
                WHERE ep.entry_id = e.id AND ep.replaced_at IS NOT NULL), '[]') AS former
    FROM entries e WHERE e.tc_id = ${tcId}
    ORDER BY e.seed NULLS LAST, e.created_at`;

  const zones = await db<ZoneRow[]>`
    SELECT z.id, z.name, z.sort, z.manual_order,
      COALESCE((SELECT array_agg(ze.entry_id ORDER BY ze.sort, ze.entry_id) FROM zone_entries ze WHERE ze.zone_id = z.id), '{}') AS entry_ids
    FROM zones z WHERE z.tc_id = ${tcId} ORDER BY z.sort, z.name`;

  const matches = await db<MatchRow[]>`
    SELECT m.id, m.phase, m.zone_id, m.bracket_code, m.round, m.entry_a, m.entry_b, m.status, m.outcome,
           m.court_id, c.name AS court_name, m.scheduled_at, m.schedule_locked, m.version, m.updated_at
    FROM matches m LEFT JOIN courts c ON c.id = m.court_id
    WHERE m.tc_id = ${tcId}
    ORDER BY m.phase DESC, m.round, m.bracket_code, m.created_at`;

  const state = buildState(tc, zones, matches, entries);
  const view = evaluateCategory(rules, state);
  return { tc, rules, entries, entryMap: new Map(entries.map((e) => [e.id, e])), zones, matches, state, view };
}

export function buildState(tc: TcRow, zones: ZoneRow[], matches: MatchRow[], entries: EntryRow[]): CategoryState {
  const withdrawn = new Map(entries.filter((e) => e.status === "WITHDRAWN").map((e) => [e.id, e.withdrawal_policy]));
  const zoneMatches: ZoneMatchData[] = matches
    .filter((m) => m.phase === "ZONE" && m.zone_id && m.entry_a && m.entry_b)
    .map((m) => ({
      id: m.id,
      zoneId: m.zone_id!,
      a: m.entry_a!,
      b: m.entry_b!,
      status: (m.status === "PLAYED" ? "PLAYED" : m.status === "ANNULLED" ? "ANNULLED" : "PENDING") as MatchStatus,
      outcome: m.outcome,
    }));
  const bracketResults = matches
    .filter((m) => m.phase === "BRACKET" && m.status === "PLAYED" && m.outcome && m.entry_a && m.entry_b)
    .map((m) => ({ code: m.bracket_code!, entryA: m.entry_a!, entryB: m.entry_b!, outcome: m.outcome! }));
  const cross: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(tc.cross_manual_order ?? {})) cross[Number(k)] = v;
  return {
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      // Retiro con anulación total: la pareja desaparece de la tabla.
      entryIds: z.entry_ids.filter((id) => withdrawn.get(id) !== "ANNUL_ALL"),
      manualOrder: z.manual_order ?? [],
      withdrawn: z.entry_ids.filter((id) => withdrawn.get(id) === "WO_PENDING"),
    })),
    zoneMatches,
    bracket: tc.bracket ?? [],
    bracketResults,
    crossManualOrder: cross,
  };
}

export function entryLabel(e: EntryRow | undefined | null): string {
  if (!e) return "—";
  const names = e.players.map((p) => p.last_name).join(" / ");
  return names || "(sin jugadores)";
}

export function entryFullLabel(e: EntryRow | undefined | null): string {
  if (!e) return "—";
  return e.players.map((p) => `${p.first_name} ${p.last_name}`).join(" / ");
}

export function resolvedLabel(r: Resolved, entryMap: Map<string, EntryRow>, fallback = "A definir"): string {
  if (r.kind === "ENTRY") return entryLabel(entryMap.get(r.entryId));
  if (r.kind === "BYE") return "Pase libre";
  return fallback;
}

export function stagesFor(lc: LoadedCategory) {
  return categoryStages(lc.state, lc.view);
}
