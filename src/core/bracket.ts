/**
 * Cuadro eliminatorio: generación, pases libres, resolución de cruces y etapas alcanzadas.
 *
 * Cada lugar del cuadro se guarda como una REFERENCIA (p. ej. "1° de Zona A" o
 * "ganador del partido R1-3"), nunca como una pareja fija. Así, si se corrige un
 * resultado de zona o de cuadro, el cuadro se recalcula solo.
 */

export type SlotRef =
  | { t: "ZONE"; zone: string; pos: number }
  | { t: "CROSS"; pos: number; rank: number }   // n-ésimo mejor de la posición `pos` entre zonas
  | { t: "WINNER"; match: string }
  | { t: "BYE" }
  | { t: "ENTRY"; entryId: string };            // asignación manual

export interface BracketMatchDef {
  code: string;      // "R1-1"
  round: number;     // 1 = primera ronda
  index: number;     // 1..n dentro de la ronda
  a: SlotRef;
  b: SlotRef;
}

export class BracketError extends Error {}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Orden estándar de cabezas de serie por posición: tamaño 8 → [1,8,4,5,2,7,3,6]. */
export function seedPositions(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function roundName(matchesInRound: number): string {
  switch (matchesInRound) {
    case 1: return "Final";
    case 2: return "Semifinal";
    case 4: return "Cuartos de final";
    case 8: return "Octavos de final";
    case 16: return "16avos de final";
    case 32: return "32avos de final";
    default: return `Ronda de ${matchesInRound * 2}`;
  }
}

export function refLabel(r: SlotRef, zoneNames: Record<string, string> = {}): string {
  switch (r.t) {
    case "ZONE": return `${r.pos}° Zona ${zoneNames[r.zone] ?? r.zone}`;
    case "CROSS": return `${r.rank}° mejor ${r.pos}°`;
    case "WINNER": return `Ganador ${r.match}`;
    case "BYE": return "Pase libre";
    case "ENTRY": return "Asignación manual";
  }
}

export interface QualificationRule {
  /** Cuántas parejas clasifican directo por zona. "ALL" = todas. */
  perZone: number | "ALL";
  /** Cuántas parejas extra clasifican como mejores de la posición siguiente (ej. 2 mejores terceros). */
  bestNext: number;
}

export interface ZoneInfo { id: string; size: number }

/** Lista de clasificados en orden de siembra. */
export function qualifierRefs(zones: ZoneInfo[], rule: QualificationRule): { ref: SlotRef; zone: string | null }[] {
  if (zones.length === 0) throw new BracketError("No hay zonas.");
  const maxSize = Math.max(...zones.map((z) => z.size));
  const per = rule.perZone === "ALL" ? maxSize : rule.perZone;
  if (!Number.isInteger(per) || per < 1) throw new BracketError("Cantidad de clasificados por zona inválida.");
  const out: { ref: SlotRef; zone: string | null }[] = [];
  for (let pos = 1; pos <= per; pos++) {
    for (const z of zones) if (pos <= z.size) out.push({ ref: { t: "ZONE", zone: z.id, pos }, zone: z.id });
  }
  if (rule.bestNext > 0) {
    const pos = per + 1;
    const available = zones.filter((z) => z.size >= pos).length;
    if (rule.bestNext > available) throw new BracketError(`Solo hay ${available} zonas con ${pos}° puesto.`);
    for (let k = 1; k <= rule.bestNext; k++) out.push({ ref: { t: "CROSS", pos, rank: k }, zone: null });
  }
  if (out.length < 2) throw new BracketError("Se necesitan al menos 2 clasificados para armar un cuadro.");
  return out;
}

/**
 * Genera el cuadro completo.
 * - Tamaño = potencia de 2 ≥ clasificados; los pases libres van a los mejores sembrados.
 * - Los primeros de zona se ubican en posiciones de cabeza de serie.
 * - El resto se ubica evitando cruces de primera ronda entre parejas de la misma zona
 *   y separando a parejas de la misma zona en mitades distintas del cuadro.
 */
export function generateBracket(qualifiers: { ref: SlotRef; zone: string | null }[]): BracketMatchDef[] {
  const q = qualifiers.length;
  const size = nextPow2(q);
  const positions = seedPositions(size); // positions[i] = seed number at bracket line i
  const lineOfSeed = new Map<number, number>();
  positions.forEach((s, i) => lineOfSeed.set(s, i));

  const lines: ({ ref: SlotRef; zone: string | null } | null)[] = Array(size).fill(null);
  const numZoneFirsts = qualifiers.filter((x) => x.ref.t === "ZONE" && x.ref.pos === 1).length;
  const top = Math.max(1, Math.min(numZoneFirsts, q));

  // 1) cabezas de serie fijas
  for (let s = 1; s <= top; s++) lines[lineOfSeed.get(s)!] = qualifiers[s - 1];

  // 2) el resto, con penalización por choques de zona
  const pool = qualifiers.slice(top);
  const half = (line: number, parts: number) => Math.floor(line / (size / parts));
  for (let s = top + 1; s <= size; s++) {
    const line = lineOfSeed.get(s)!;
    if (s > q) { lines[line] = { ref: { t: "BYE" }, zone: null }; continue; }
    const oppLine = line % 2 === 0 ? line + 1 : line - 1;
    let best = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;
    pool.forEach((cand, i) => {
      let p = i * 0.001; // preferir respetar el orden de siembra
      if (cand.zone) {
        const opp = lines[oppLine];
        if (opp && opp.zone === cand.zone) p += 1000;
        for (let l = 0; l < size; l++) {
          const o = lines[l];
          if (!o || o.zone !== cand.zone) continue;
          if (size >= 4 && half(l, 2) === half(line, 2)) p += 10;
          if (size >= 8 && half(l, 4) === half(line, 4)) p += 1;
        }
      }
      if (p < bestPenalty) { bestPenalty = p; best = i; }
    });
    lines[line] = pool.splice(best, 1)[0];
  }

  // 2b) mejora local: intercambios entre lugares no fijos para eliminar choques restantes
  const cost = () => {
    let c = 0;
    for (let l = 0; l < size; l += 2) {
      const x = lines[l], y = lines[l + 1];
      if (x?.zone && y?.zone && x.zone === y.zone) c += 1000;
    }
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
      const x = lines[i], y = lines[j];
      if (!x?.zone || x.zone !== y?.zone) continue;
      if (size >= 4 && half(i, 2) === half(j, 2)) c += 10;
      if (size >= 8 && half(i, 4) === half(j, 4)) c += 1;
    }
    return c;
  };
  const movable = positions
    .map((s, line) => ({ s, line }))
    .filter(({ s }) => s > top && s <= q)
    .map(({ line }) => line);
  let current = cost();
  for (let iter = 0; iter < 50 && current > 0; iter++) {
    let improved = false;
    for (let i = 0; i < movable.length; i++) for (let j = i + 1; j < movable.length; j++) {
      const li = movable[i], lj = movable[j];
      // no cambiar quién recibe pase libre
      const byeI = lines[li ^ 1]?.ref.t === "BYE", byeJ = lines[lj ^ 1]?.ref.t === "BYE";
      if (byeI !== byeJ) continue;
      [lines[li], lines[lj]] = [lines[lj], lines[li]];
      const c = cost();
      if (c < current) { current = c; improved = true; }
      else [lines[li], lines[lj]] = [lines[lj], lines[li]];
    }
    if (!improved) break;
  }

  // 3) armar partidos
  const matches: BracketMatchDef[] = [];
  const rounds = Math.log2(size);
  for (let i = 0; i < size / 2; i++) {
    matches.push({ code: `R1-${i + 1}`, round: 1, index: i + 1, a: lines[2 * i]!.ref, b: lines[2 * i + 1]!.ref });
  }
  for (let r = 2; r <= rounds; r++) {
    const n = size / 2 ** r;
    for (let i = 0; i < n; i++) {
      matches.push({
        code: `R${r}-${i + 1}`, round: r, index: i + 1,
        a: { t: "WINNER", match: `R${r - 1}-${2 * i + 1}` },
        b: { t: "WINNER", match: `R${r - 1}-${2 * i + 2}` },
      });
    }
  }
  if (size === 1) throw new BracketError("Cuadro inválido.");
  return matches;
}

export function totalRounds(defs: BracketMatchDef[]): number {
  return Math.max(...defs.map((d) => d.round));
}

/* ------------------------------------------------------------------ */
/* Resolución                                                          */
/* ------------------------------------------------------------------ */

export type Resolved = { kind: "ENTRY"; entryId: string } | { kind: "BYE" } | { kind: "PENDING"; reason: string };

export interface ZoneResult {
  zoneId: string;
  /** Posiciones definitivas (true si zona terminada y sin empates sin resolver). */
  final: boolean;
  /** entryIds ordenados por posición. */
  order: string[];
}

export interface CrossResult {
  pos: number;
  final: boolean;
  /** entryIds ordenados (mejor primero). */
  order: string[];
}

export interface BracketResultInput {
  code: string;
  /** Participantes con los que se cargó el resultado (para detectar resultados obsoletos). */
  entryA: string;
  entryB: string;
  winnerEntryId: string;
}

export interface ResolvedMatch {
  code: string;
  round: number;
  index: number;
  a: Resolved;
  b: Resolved;
  /** Ganador vigente (por resultado o por pase libre). */
  winner: string | null;
  loser: string | null;
  byeAdvance: boolean;
  /** El resultado cargado no coincide con los participantes actuales. */
  staleResult: boolean;
}

export function resolveBracket(
  defs: BracketMatchDef[],
  zones: ZoneResult[],
  cross: CrossResult[],
  results: BracketResultInput[],
): ResolvedMatch[] {
  const zoneMap = new Map(zones.map((z) => [z.zoneId, z]));
  const crossMap = new Map(cross.map((c) => [c.pos, c]));
  const resultMap = new Map(results.map((r) => [r.code, r]));
  const defMap = new Map(defs.map((d) => [d.code, d]));
  const memo = new Map<string, ResolvedMatch>();

  const resolveRef = (r: SlotRef): Resolved => {
    switch (r.t) {
      case "BYE": return { kind: "BYE" };
      case "ENTRY": return { kind: "ENTRY", entryId: r.entryId };
      case "ZONE": {
        const z = zoneMap.get(r.zone);
        if (!z) return { kind: "PENDING", reason: "Zona inexistente" };
        if (!z.final) return { kind: "PENDING", reason: "Zona en juego" };
        const e = z.order[r.pos - 1];
        return e ? { kind: "ENTRY", entryId: e } : { kind: "BYE" };
      }
      case "CROSS": {
        const c = crossMap.get(r.pos);
        if (!c || !c.final) return { kind: "PENDING", reason: "Comparación entre zonas pendiente" };
        const e = c.order[r.rank - 1];
        return e ? { kind: "ENTRY", entryId: e } : { kind: "BYE" };
      }
      case "WINNER": {
        const m = resolveMatch(r.match);
        if (!m) return { kind: "PENDING", reason: "Partido inexistente" };
        if (m.a.kind === "BYE" && m.b.kind === "BYE") return { kind: "BYE" };
        if (m.winner) return { kind: "ENTRY", entryId: m.winner };
        return { kind: "PENDING", reason: `Esperando ${r.match}` };
      }
    }
  };

  const resolveMatch = (code: string): ResolvedMatch | null => {
    if (memo.has(code)) return memo.get(code)!;
    const d = defMap.get(code);
    if (!d) return null;
    const a = resolveRef(d.a);
    const b = resolveRef(d.b);
    let winner: string | null = null, loser: string | null = null, byeAdvance = false, staleResult = false;
    if (a.kind === "ENTRY" && b.kind === "BYE") { winner = a.entryId; byeAdvance = true; }
    else if (b.kind === "ENTRY" && a.kind === "BYE") { winner = b.entryId; byeAdvance = true; }
    else {
      const res = resultMap.get(code);
      if (res) {
        if (a.kind === "ENTRY" && b.kind === "ENTRY" && res.entryA === a.entryId && res.entryB === b.entryId) {
          winner = res.winnerEntryId;
          loser = winner === a.entryId ? b.entryId : a.entryId;
        } else {
          staleResult = true;
        }
      }
    }
    const rm: ResolvedMatch = { code, round: d.round, index: d.index, a, b, winner, loser, byeAdvance, staleResult };
    memo.set(code, rm);
    return rm;
  };

  return defs.map((d) => resolveMatch(d.code)!);
}

/* ------------------------------------------------------------------ */
/* Impacto de cambios                                                  */
/* ------------------------------------------------------------------ */

export interface BracketImpact {
  code: string;
  before: { a: string | null; b: string | null };
  after: { a: string | null; b: string | null };
  /** Ese partido ya tenía resultado cargado → quedará invalidado. */
  hadResult: boolean;
}

const idOf = (r: Resolved) => (r.kind === "ENTRY" ? r.entryId : r.kind === "BYE" ? "BYE" : null);

/** Compara dos resoluciones del cuadro y devuelve los partidos cuyos participantes cambian. */
export function diffBracket(before: ResolvedMatch[], after: ResolvedMatch[], resultCodes: Set<string>): BracketImpact[] {
  const am = new Map(after.map((m) => [m.code, m]));
  const out: BracketImpact[] = [];
  for (const b of before) {
    const a = am.get(b.code);
    if (!a) continue;
    const ba = idOf(b.a), bb = idOf(b.b), aa = idOf(a.a), ab = idOf(a.b);
    if (ba !== aa || bb !== ab) {
      out.push({ code: b.code, before: { a: ba, b: bb }, after: { a: aa, b: ab }, hadResult: resultCodes.has(b.code) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Etapa alcanzada (para el ranking)                                   */
/* ------------------------------------------------------------------ */

export type Stage = "CHAMPION" | "FINALIST" | "SEMIFINAL" | "QUARTERFINAL" | "ROUND_OF_16" | "ROUND_OF_32" | "ROUND_OF_64" | "ZONE";

export const STAGE_LABELS: Record<Stage, string> = {
  CHAMPION: "Campeón",
  FINALIST: "Subcampeón",
  SEMIFINAL: "Semifinal",
  QUARTERFINAL: "Cuartos de final",
  ROUND_OF_16: "Octavos de final",
  ROUND_OF_32: "16avos de final",
  ROUND_OF_64: "32avos de final",
  ZONE: "Fase de zonas / participación",
};

export const STAGE_ORDER: Stage[] = ["CHAMPION", "FINALIST", "SEMIFINAL", "QUARTERFINAL", "ROUND_OF_16", "ROUND_OF_32", "ROUND_OF_64", "ZONE"];

function stageForLoss(matchesInRound: number): Stage {
  switch (matchesInRound) {
    case 1: return "FINALIST";
    case 2: return "SEMIFINAL";
    case 4: return "QUARTERFINAL";
    case 8: return "ROUND_OF_16";
    case 16: return "ROUND_OF_32";
    default: return "ROUND_OF_64";
  }
}

/**
 * Etapa alcanzada por cada pareja. Solo devuelve resultado definitivo cuando
 * la final tiene ganador (`complete`); antes devuelve etapas parciales.
 */
export function stagesReached(entryIds: string[], resolved: ResolvedMatch[]): { stages: Map<string, Stage>; complete: boolean } {
  const stages = new Map<string, Stage>(entryIds.map((e) => [e, "ZONE"]));
  const perRound = new Map<number, number>();
  for (const m of resolved) perRound.set(m.round, (perRound.get(m.round) ?? 0) + 1);
  const rank = (s: Stage) => STAGE_ORDER.indexOf(s);
  const upgrade = (e: string, s: Stage) => {
    const cur = stages.get(e) ?? "ZONE";
    if (rank(s) < rank(cur)) stages.set(e, s);
  };
  for (const m of resolved) {
    const n = perRound.get(m.round)!;
    // Quien juega (o pasa) en esta ronda alcanzó al menos esta ronda.
    for (const side of [m.a, m.b]) if (side.kind === "ENTRY" && !m.byeAdvance) upgrade(side.entryId, stageForLoss(n));
    if (m.loser) upgrade(m.loser, stageForLoss(n));
  }
  const maxRound = Math.max(...resolved.map((m) => m.round));
  const final = resolved.find((m) => m.round === maxRound);
  const complete = !!final?.winner;
  if (final?.winner) upgrade(final.winner, "CHAMPION");
  return { stages, complete };
}
