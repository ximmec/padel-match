/**
 * Generación de zonas (grupos) y fixture de todos contra todos.
 */

export class ZoneError extends Error {}

export interface ZonePlanOptions {
  /** Tamaño preferido de zona (3 o 4 normalmente). */
  preferredSize: number;
  /** Tamaño mínimo aceptado. */
  minSize?: number;
}

/**
 * Devuelve los tamaños de zona para n parejas, usando zonas del tamaño preferido
 * y absorbiendo el resto con zonas de tamaño preferido+1 (o -1 si no alcanza).
 * Ej. con zonas de 3: 8 → [4,4], 9 → [3,3,3], 10 → [4,3,3], 11 → [4,4,3], 12 → [3,3,3,3], 14 → [4,4,3,3].
 */
export function planZoneSizes(n: number, opts: ZonePlanOptions): number[] {
  const s = opts.preferredSize;
  const min = opts.minSize ?? Math.min(3, s);
  if (!Number.isInteger(n) || n < 2) throw new ZoneError("Se necesitan al menos 2 parejas.");
  if (!Number.isInteger(s) || s < 2) throw new ZoneError("Tamaño de zona inválido.");
  if (n <= s + 1) return [n];
  // Intento 1: zonas de s y s+1 (máxima cantidad de zonas de s).
  for (let big = 0; big * (s + 1) <= n; big++) {
    const rest = n - big * (s + 1);
    if (rest % s === 0) {
      return [...Array(big).fill(s + 1), ...Array(rest / s).fill(s)];
    }
  }
  // Intento 2: zonas de s y s-1.
  for (let small = 1; small * (s - 1) <= n; small++) {
    if (s - 1 < min) break;
    const rest = n - small * (s - 1);
    if (rest % s === 0) {
      return [...Array(rest / s).fill(s), ...Array(small).fill(s - 1)];
    }
  }
  return [n];
}

/** Valida tamaños elegidos manualmente. */
export function validateZoneSizes(n: number, sizes: number[]): void {
  if (sizes.some((x) => !Number.isInteger(x) || x < 2)) throw new ZoneError("Cada zona necesita al menos 2 parejas.");
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total !== n) throw new ZoneError(`Las zonas suman ${total} parejas pero hay ${n} inscriptas.`);
}

export function zoneName(i: number): string {
  let s = "";
  let x = i;
  do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s;
}

/** PRNG determinístico (mulberry32) para sorteos reproducibles y auditables. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface SeedableEntry {
  id: string;
  /** 1 = mejor cabeza de serie. null = sin sembrar. */
  seed: number | null;
}

/**
 * Reparte parejas en zonas. Las cabezas de serie se reparten en serpentina
 * (1→A, 2→B, …, luego en sentido inverso) y el resto se sortea con la semilla dada.
 */
export function distributeEntries<T extends SeedableEntry>(entries: T[], sizes: number[], randomSeed: number): T[][] {
  validateZoneSizes(entries.length, sizes);
  const zones: T[][] = sizes.map(() => []);
  const seeded = entries.filter((e) => e.seed != null).sort((a, b) => a.seed! - b.seed!);
  const unseeded = shuffle(entries.filter((e) => e.seed == null), rng(randomSeed));
  const order = [...seeded, ...unseeded];
  let z = 0;
  let dir = 1;
  for (const e of order) {
    // buscar la siguiente zona con lugar respetando la serpentina
    let guard = 0;
    while (zones[z].length >= sizes[z]) {
      z += dir;
      if (z >= zones.length) { z = zones.length - 1; dir = -1; }
      if (z < 0) { z = 0; dir = 1; }
      if (++guard > zones.length * 2 + 2) throw new ZoneError("No hay lugar en las zonas.");
    }
    zones[z].push(e);
    z += dir;
    if (z >= zones.length) { z = zones.length - 1; dir = -1; }
    else if (z < 0) { z = 0; dir = 1; }
  }
  return zones;
}

export interface Fixture {
  round: number;
  a: number; // índice dentro de la zona
  b: number;
}

/**
 * Todos contra todos (método del círculo). Devuelve índices de parejas dentro de la zona.
 * En zonas de 4 la ronda 1 enfrenta 1v4 y 2v3, etc.
 */
export function roundRobin(size: number): Fixture[] {
  if (size < 2) return [];
  const n = size % 2 === 0 ? size : size + 1;
  const ids = Array.from({ length: n }, (_, i) => i);
  const out: Fixture[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i];
      const b = ids[n - 1 - i];
      if (a < size && b < size) out.push({ round: r + 1, a: Math.min(a, b), b: Math.max(a, b) });
    }
    // rotar todos menos el primero
    ids.splice(1, 0, ids.pop()!);
  }
  return out;
}
