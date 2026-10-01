/**
 * Formatos de partido y validación de resultados.
 * Lógica pura: sin base de datos ni UI.
 */

export interface MatchFormat {
  /** Sets necesarios para ganar (1 = a un set, 2 = al mejor de tres, 3 = al mejor de cinco). */
  setsToWin: number;
  /** Games para ganar un set (normalmente 6). */
  gamesPerSet: number;
  /** Si hay tiebreak al llegar a gamesPerSet-gamesPerSet. */
  tiebreak: boolean;
  /** Si el set decisivo se reemplaza por un super tiebreak. */
  superTiebreakDecider: boolean;
  /** Puntos del super tiebreak (normalmente 10). */
  superTiebreakPoints: number;
}

export const FORMATS = {
  ONE_SET: { setsToWin: 1, gamesPerSet: 6, tiebreak: true, superTiebreakDecider: false, superTiebreakPoints: 10 },
  BEST_OF_3: { setsToWin: 2, gamesPerSet: 6, tiebreak: true, superTiebreakDecider: false, superTiebreakPoints: 10 },
  BEST_OF_3_STB: { setsToWin: 2, gamesPerSet: 6, tiebreak: true, superTiebreakDecider: true, superTiebreakPoints: 10 },
  PRO_SET_9: { setsToWin: 1, gamesPerSet: 9, tiebreak: true, superTiebreakDecider: false, superTiebreakPoints: 10 },
} satisfies Record<string, MatchFormat>;

export type FormatKey = keyof typeof FORMATS;

export function formatLabel(f: MatchFormat): string {
  if (f.setsToWin === 1) return f.gamesPerSet === 6 ? "A un set" : `Un set a ${f.gamesPerSet} games`;
  const total = f.setsToWin * 2 - 1;
  return `Al mejor de ${total} sets${f.superTiebreakDecider ? " (super tiebreak en el último)" : ""}`;
}

/** Un set: [games pareja A, games pareja B]. En super tiebreak, los puntos. */
export type SetScore = [number, number];

export type Side = "A" | "B";

export interface ScoreSummary {
  winner: Side;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
}

export type MatchOutcome =
  | { kind: "PLAYED"; sets: SetScore[] }
  /** Walkover: no se presentó/abandonó antes; gana `winner`. */
  | { kind: "WALKOVER"; winner: Side }
  /** Abandono durante el partido: se registran los sets jugados y gana `winner`. */
  | { kind: "RETIRED"; winner: Side; sets: SetScore[] };

export class ScoreError extends Error {}

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Valida un set normal. Devuelve el ganador del set. */
function validateRegularSet(f: MatchFormat, [a, b]: SetScore, idx: number): Side {
  const g = f.gamesPerSet;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const label = `Set ${idx + 1} (${a}-${b})`;
  if (hi < g) throw new ScoreError(`${label}: el set no está terminado.`);
  if (hi === g && lo <= g - 2) return a > b ? "A" : "B";
  if (hi === g + 1 && (lo === g - 1 || (lo === g && f.tiebreak))) return a > b ? "A" : "B";
  if (!f.tiebreak && hi > g && hi - lo === 2) return a > b ? "A" : "B";
  throw new ScoreError(`${label}: resultado de set inválido.`);
}

function validateSuperTiebreak(f: MatchFormat, [a, b]: SetScore, idx: number): Side {
  const p = f.superTiebreakPoints;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const label = `Super tiebreak (${a}-${b})`;
  if (hi < p) throw new ScoreError(`${label}: no está terminado.`);
  if (hi - lo < 2) throw new ScoreError(`${label}: se gana por dos puntos de diferencia.`);
  if (hi > p && hi - lo !== 2) throw new ScoreError(`${label}: resultado inválido.`);
  void idx;
  return a > b ? "A" : "B";
}

/**
 * Valida un partido completo y devuelve el resumen.
 * Convención: un super tiebreak cuenta como un set y como un game (1-0) para el ganador.
 */
export function summarizePlayed(f: MatchFormat, sets: SetScore[]): ScoreSummary {
  if (!Array.isArray(sets) || sets.length === 0) throw new ScoreError("Cargá al menos un set.");
  const maxSets = f.setsToWin * 2 - 1;
  if (sets.length > maxSets) throw new ScoreError(`Este formato admite como máximo ${maxSets} sets.`);
  let setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
  sets.forEach((s, i) => {
    if (!Array.isArray(s) || s.length !== 2 || !isInt(s[0]) || !isInt(s[1])) {
      throw new ScoreError(`Set ${i + 1}: valores inválidos.`);
    }
    if (setsA === f.setsToWin || setsB === f.setsToWin) {
      throw new ScoreError("Hay sets cargados después de que el partido terminó.");
    }
    const isDecider = setsA === f.setsToWin - 1 && setsB === f.setsToWin - 1 && f.setsToWin > 1;
    let w: Side;
    if (isDecider && f.superTiebreakDecider) {
      w = validateSuperTiebreak(f, s, i);
      if (w === "A") gamesA += 1; else gamesB += 1;
    } else {
      w = validateRegularSet(f, s, i);
      gamesA += s[0];
      gamesB += s[1];
    }
    if (w === "A") setsA++; else setsB++;
  });
  if (setsA !== f.setsToWin && setsB !== f.setsToWin) throw new ScoreError("El partido no está terminado.");
  return { winner: setsA > setsB ? "A" : "B", setsA, setsB, gamesA, gamesB };
}

/** Resumen de un walkover: el ganador recibe los sets necesarios por gamesPerSet-0. */
export function summarizeWalkover(f: MatchFormat, winner: Side): ScoreSummary {
  const sets = f.setsToWin;
  const games = f.setsToWin * f.gamesPerSet;
  return winner === "A"
    ? { winner, setsA: sets, setsB: 0, gamesA: games, gamesB: 0 }
    : { winner, setsA: 0, setsB: sets, gamesA: 0, gamesB: games };
}

/**
 * Abandono: los sets terminados se cuentan como se jugaron; los que faltaban
 * (incluido el set en curso) se adjudican al ganador como si los hubiera ganado gamesPerSet-0
 * desde el marcador parcial.
 */
export function summarizeRetired(f: MatchFormat, winner: Side, sets: SetScore[]): ScoreSummary {
  let setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
  for (const [a, b] of sets) {
    if (!isInt(a) || !isInt(b)) throw new ScoreError("Valores de set inválidos.");
    gamesA += a; gamesB += b;
    const g = f.gamesPerSet;
    const done = (Math.max(a, b) >= g && Math.abs(a - b) >= 2) || Math.max(a, b) === g + 1;
    if (done) { if (a > b) setsA++; else setsB++; }
    else {
      // set en curso: se completa a favor del ganador
      if (winner === "A") { gamesA += Math.max(0, f.gamesPerSet - a); setsA++; }
      else { gamesB += Math.max(0, f.gamesPerSet - b); setsB++; }
    }
  }
  while ((winner === "A" ? setsA : setsB) < f.setsToWin) {
    if (winner === "A") { setsA++; gamesA += f.gamesPerSet; } else { setsB++; gamesB += f.gamesPerSet; }
  }
  return { winner, setsA, setsB, gamesA, gamesB };
}

export function summarize(f: MatchFormat, o: MatchOutcome): ScoreSummary {
  switch (o.kind) {
    case "PLAYED": return summarizePlayed(f, o.sets);
    case "WALKOVER": return summarizeWalkover(f, o.winner);
    case "RETIRED": return summarizeRetired(f, o.winner, o.sets);
  }
}

/** "6-4 3-6 10-8" → [[6,4],[3,6],[10,8]] */
export function parseScoreText(text: string): SetScore[] {
  const parts = text.trim().split(/[\s,;/]+/).filter(Boolean);
  return parts.map((p) => {
    const m = /^(\d{1,2})\s*[-:]\s*(\d{1,2})$/.exec(p);
    if (!m) throw new ScoreError(`No entiendo "${p}". Usá el formato 6-4 6-3.`);
    return [Number(m[1]), Number(m[2])] as SetScore;
  });
}

export function scoreText(o: MatchOutcome): string {
  if (o.kind === "WALKOVER") return `W.O. (gana ${o.winner})`;
  const s = o.sets.map(([a, b]) => `${a}-${b}`).join(" ");
  return o.kind === "RETIRED" ? `${s} ret.` : s;
}
