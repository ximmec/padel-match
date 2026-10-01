import { planZoneSizes, distributeEntries, roundRobin, rng, zoneName } from "../../src/core/zones";
import type { CategoryState, ZoneMatchData } from "../../src/core/engine";
import type { SetScore } from "../../src/core/scoring";

/** Construye un estado de categoría con n parejas en zonas generadas automáticamente. */
export function buildCategory(n: number, preferredSize = 3, seed = 42): CategoryState {
  const entries = Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, seed: i < 4 ? i + 1 : null }));
  const sizes = planZoneSizes(n, { preferredSize });
  const groups = distributeEntries(entries, sizes, seed);
  const zones = groups.map((g, i) => ({ id: `Z${zoneName(i)}`, name: zoneName(i), entryIds: g.map((e) => e.id), manualOrder: [] as string[] }));
  const zoneMatches: ZoneMatchData[] = [];
  zones.forEach((z) => {
    for (const f of roundRobin(z.entryIds.length)) {
      zoneMatches.push({ id: `${z.id}-${f.a}-${f.b}`, zoneId: z.id, a: z.entryIds[f.a], b: z.entryIds[f.b], status: "PENDING", outcome: null });
    }
  });
  return { zones, zoneMatches, bracket: [], bracketResults: [], crossManualOrder: {} };
}

/** Resultado aleatorio pero válido para mejor de 3 con super tiebreak, sin empates perfectos probables. */
export function randomResult(rand: () => number): SetScore[] {
  const set = (): SetScore => {
    const lo = Math.floor(rand() * 5);
    return rand() < 0.5 ? [6, lo] : [lo, 6];
  };
  const s1 = set();
  const s2 = set();
  const a1 = s1[0] > s1[1], a2 = s2[0] > s2[1];
  if (a1 === a2) return [s1, s2];
  const stb: SetScore = rand() < 0.5 ? [10, Math.floor(rand() * 9)] : [Math.floor(rand() * 9), 10];
  return [s1, s2, stb];
}

export function playAllZones(st: CategoryState, seed = 7) {
  const rand = rng(seed);
  for (const m of st.zoneMatches) {
    m.status = "PLAYED";
    m.outcome = { kind: "PLAYED", sets: randomResult(rand) };
  }
}

/** Fuerza que una pareja le gane a todas (para resultados deterministas). */
export function setResult(st: CategoryState, winner: string, loser: string, sets: SetScore[] = [[6, 0], [6, 0]]) {
  const m = st.zoneMatches.find((x) => (x.a === winner && x.b === loser) || (x.a === loser && x.b === winner));
  if (!m) throw new Error(`No existe el partido ${winner}-${loser}`);
  m.status = "PLAYED";
  m.outcome = { kind: "PLAYED", sets: m.a === winner ? sets : sets.map(([x, y]) => [y, x] as SetScore) };
}
