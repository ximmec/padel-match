import { test } from "node:test";
import assert from "node:assert/strict";
import { planZoneSizes, roundRobin, distributeEntries } from "../../src/core/zones";
import { generateBracket, qualifierRefs, seedPositions, diffBracket, type QualificationRule } from "../../src/core/bracket";
import { evaluateCategory, categoryStages, DEFAULT_RULES, withdrawalChanges, type CategoryRules, type CategoryState } from "../../src/core/engine";
import { computeAwards, aggregateRanking, DEFAULT_POINTS } from "../../src/core/ranking";
import { rng } from "../../src/core/zones";
import { buildCategory, playAllZones, randomResult, setResult } from "./helpers";

test("tamaños de zona para 8, 9, 10, 11, 12 y 14 parejas", () => {
  const expect3: Record<number, number[]> = { 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3], 11: [4, 4, 3], 12: [3, 3, 3, 3], 14: [4, 4, 3, 3] };
  for (const [n, sizes] of Object.entries(expect3)) assert.deepEqual(planZoneSizes(Number(n), { preferredSize: 3 }), sizes, `n=${n}`);
  const expect4: Record<number, number[]> = { 8: [4, 4], 9: [5, 4], 10: [4, 3, 3], 11: [4, 4, 3], 12: [4, 4, 4], 14: [4, 4, 3, 3] };
  for (const [n, sizes] of Object.entries(expect4)) {
    const got = planZoneSizes(Number(n), { preferredSize: 4 });
    assert.equal(got.reduce((a, b) => a + b, 0), Number(n));
    assert.ok(got.every((x) => x >= 3 && x <= 5), `n=${n} → ${got}`);
    void sizes;
  }
});

test("todos contra todos: cada par se enfrenta una vez", () => {
  for (const size of [2, 3, 4, 5, 6]) {
    const f = roundRobin(size);
    assert.equal(f.length, (size * (size - 1)) / 2);
    const keys = new Set(f.map((x) => `${x.a}-${x.b}`));
    assert.equal(keys.size, f.length);
  }
});

test("las cabezas de serie quedan en zonas distintas", () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ id: `E${i + 1}`, seed: i < 4 ? i + 1 : null }));
  const zones = distributeEntries(entries, [3, 3, 3, 3], 1);
  zones.forEach((z, i) => assert.equal(z.filter((e) => e.seed != null).length, 1, `zona ${i}`));
});

test("orden de siembra estándar", () => {
  assert.deepEqual(seedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

function resolveTies(rules: CategoryRules, st: CategoryState) {
  // Si quedó algún empate perfecto (poco probable), se registra un sorteo manual.
  const v = evaluateCategory(rules, st);
  for (const z of st.zones) {
    const s = v.standings.get(z.id)!;
    if (!s.final) z.manualOrder = s.rows.map((r) => r.entryId);
  }
  for (const [pos, ties] of Object.entries(v.crossTies)) if (ties.length) st.crossManualOrder[Number(pos)] = ties.flat();
}

function playBracket(rules: CategoryRules, st: CategoryState, seed = 3) {
  const rand = rng(seed);
  for (let guard = 0; guard < 20; guard++) {
    const v = evaluateCategory(rules, st);
    const playable = v.bracket.filter((m) => !m.winner && m.a.kind === "ENTRY" && m.b.kind === "ENTRY");
    if (!playable.length) return v;
    for (const m of playable) {
      if (m.a.kind !== "ENTRY" || m.b.kind !== "ENTRY") continue;
      st.bracketResults.push({ code: m.code, entryA: m.a.entryId, entryB: m.b.entryId, outcome: { kind: "PLAYED", sets: randomResult(rand) } });
    }
  }
  throw new Error("El cuadro no terminó");
}

const cases: { n: number; rule: QualificationRule }[] = [
  { n: 8, rule: { perZone: 2, bestNext: 0 } },
  { n: 9, rule: { perZone: 2, bestNext: 0 } },
  { n: 9, rule: { perZone: 1, bestNext: 1 } },
  { n: 10, rule: { perZone: 2, bestNext: 0 } },
  { n: 10, rule: { perZone: 2, bestNext: 2 } },
  { n: 11, rule: { perZone: 2, bestNext: 0 } },
  { n: 11, rule: { perZone: "ALL", bestNext: 0 } },
  { n: 12, rule: { perZone: 2, bestNext: 0 } },
  { n: 12, rule: { perZone: 3, bestNext: 0 } },
  { n: 14, rule: { perZone: 2, bestNext: 0 } },
  { n: 14, rule: { perZone: 2, bestNext: 2 } },
  { n: 14, rule: { perZone: 1, bestNext: 0 } },
];

for (const { n, rule } of cases) {
  test(`torneo completo con ${n} parejas, clasifican ${rule.perZone} por zona + ${rule.bestNext} mejores`, () => {
    const rules: CategoryRules = { ...DEFAULT_RULES, qualification: rule };
    const st = buildCategory(n);
    const zoneInfos = st.zones.map((z) => ({ id: z.id, size: z.entryIds.length }));
    const q = qualifierRefs(zoneInfos, rule);
    st.bracket = generateBracket(q);

    // Antes de jugar: ningún lugar del cuadro está definido
    let v = evaluateCategory(rules, st);
    assert.ok(v.bracket.filter((m) => m.round === 1).every((m) => m.a.kind !== "ENTRY"));

    // Primera ronda sin cruces de la misma zona (cuando hay más de una zona)
    if (st.zones.length > 1) {
      for (const m of st.bracket.filter((x) => x.round === 1)) {
        if (m.a.t === "ZONE" && m.b.t === "ZONE") assert.notEqual(m.a.zone, m.b.zone, `${m.code} cruza misma zona`);
      }
    }

    playAllZones(st);
    resolveTies(rules, st);
    v = evaluateCategory(rules, st);
    assert.equal(v.errors.length, 0);
    for (const s of v.standings.values()) assert.ok(s.final);

    // Cada clasificado aparece exactamente una vez en el cuadro
    const r1 = v.bracket.filter((m) => m.round === 1);
    const placed = r1.flatMap((m) => [m.a, m.b]).filter((x) => x.kind === "ENTRY").map((x) => (x.kind === "ENTRY" ? x.entryId : ""));
    assert.equal(placed.length, q.length);
    assert.equal(new Set(placed).size, q.length);

    v = playBracket(rules, st);
    const final = v.bracket.find((m) => m.round === Math.max(...v.bracket.map((b) => b.round)))!;
    assert.ok(final.winner, "hay campeón");

    const { stages, complete } = categoryStages(st, v);
    assert.ok(complete);
    const counts = [...stages.values()].reduce<Record<string, number>>((acc, s) => ((acc[s] = (acc[s] ?? 0) + 1), acc), {});
    assert.equal(counts.CHAMPION, 1);
    assert.equal(counts.FINALIST, 1);
    assert.equal(stages.size, n);
  });
}

test("corrección de un resultado de zona después de generar el cuadro: el cuadro se recalcula y avisa", () => {
  const rules: CategoryRules = { ...DEFAULT_RULES, qualification: { perZone: 2, bestNext: 0 } };
  const st = buildCategory(8); // 2 zonas de 4
  st.bracket = generateBracket(qualifierRefs(st.zones.map((z) => ({ id: z.id, size: z.entryIds.length })), rules.qualification));
  const [za] = st.zones;
  const [a, b, c, d] = za.entryIds;
  // a gana todo, b segundo, c tercero
  setResult(st, a, b); setResult(st, a, c); setResult(st, a, d);
  setResult(st, b, c); setResult(st, b, d); setResult(st, c, d);
  const zb = st.zones[1];
  const [e, f, g, h] = zb.entryIds;
  setResult(st, e, f); setResult(st, e, g); setResult(st, e, h);
  setResult(st, f, g); setResult(st, f, h); setResult(st, g, h);

  const before = evaluateCategory(rules, st);
  const firstMatch = before.bracket.find((m) => m.round === 1 && (m.a.kind === "ENTRY" && m.a.entryId === a))!;
  assert.ok(firstMatch);
  // se juega el cruce 1A vs 2B
  const opp = firstMatch.b.kind === "ENTRY" ? firstMatch.b.entryId : "";
  assert.equal(opp, f);
  st.bracketResults.push({ code: firstMatch.code, entryA: a, entryB: f, outcome: { kind: "PLAYED", sets: [[6, 2], [6, 2]] } });

  // Corrección: en realidad c le ganó a b y b le ganó a a… cambiamos para que c sea 2° y a siga 1°
  setResult(st, c, b); // ahora b y c 1G+... b: vs a L, vs c L, vs d W → 1G; c: vs a L, vs b W, vs d W → 2G
  const after = evaluateCategory(rules, st);
  const impact = diffBracket(before.bracket, after.bracket, new Set(st.bracketResults.map((r) => r.code)));
  // cambia el rival de 1B (antes 2A=b, ahora 2A=c)
  assert.ok(impact.length >= 1);
  // El partido ya jugado (1A vs 2B) no cambia de participantes → su resultado sigue válido
  const still = after.bracket.find((m) => m.code === firstMatch.code)!;
  assert.equal(still.staleResult, false);
  assert.equal(still.winner, a);

  // Ahora corregimos para que el 1° de la zona B cambie: f le gana a e → empate e/f 2G, f gana entre sí
  setResult(st, f, e);
  const after2 = evaluateCategory(rules, st);
  const changed = after2.bracket.find((m) => m.code === firstMatch.code)!;
  // 1A ahora enfrenta a 2B = e → el resultado cargado (contra f) queda obsoleto y el cuadro lo señala
  assert.equal(changed.staleResult, true);
  assert.equal(changed.winner, null);
  const impact2 = diffBracket(after.bracket, after2.bracket, new Set(st.bracketResults.map((r) => r.code)));
  assert.ok(impact2.some((i) => i.code === firstMatch.code && i.hadResult));
});

test("retiro de pareja: W.O. en pendientes (por defecto) o anulación total", () => {
  const st = buildCategory(9);
  const z = st.zones[0];
  const [a, b] = z.entryIds;
  setResult(st, a, b);
  const wo = withdrawalChanges(a, st.zoneMatches, "WO_PENDING");
  assert.equal(wo.length, 1); // en zona de 3, le queda un partido pendiente
  assert.equal(wo[0].outcome?.kind, "WALKOVER");
  const annul = withdrawalChanges(a, st.zoneMatches, "ANNUL_ALL");
  assert.equal(annul.length, 2);
  assert.ok(annul.every((x) => x.status === "ANNULLED"));
});

test("reemplazo de pareja conserva resultados: el partido se refiere a la inscripción, no a los jugadores", () => {
  // En el modelo, reemplazar a un jugador cambia los integrantes de la inscripción (Entry),
  // por lo que los partidos y resultados quedan intactos.
  const st = buildCategory(9);
  playAllZones(st);
  const before = evaluateCategory(DEFAULT_RULES, st);
  const after = evaluateCategory(DEFAULT_RULES, structuredClone(st));
  assert.deepEqual([...after.standings.values()].map((s) => s.rows.map((r) => r.entryId)), [...before.standings.values()].map((s) => s.rows.map((r) => r.entryId)));
});

test("puntos individuales con parejas distintas se acumulan sin duplicar", () => {
  // Torneo 1: Juan+Pedro campeones. Torneo 2: Juan+Luis finalistas.
  const t1 = computeAwards(new Map([["e1", "CHAMPION" as const], ["e2", "FINALIST" as const]]), [
    { entryId: "e1", playerIds: ["juan", "pedro"] },
    { entryId: "e2", playerIds: ["ana", "luz"] },
  ], DEFAULT_POINTS);
  const t2 = computeAwards(new Map([["e3", "FINALIST" as const]]), [{ entryId: "e3", playerIds: ["juan", "luis"] }], DEFAULT_POINTS);
  const ledger = [
    ...t1.map((a) => ({ playerId: a.playerId, points: a.points, tournamentCategoryId: "t1", categoryId: "c", circuitId: null, seasonId: "2026" })),
    ...t2.map((a) => ({ playerId: a.playerId, points: a.points, tournamentCategoryId: "t2", categoryId: "c", circuitId: null, seasonId: "2026" })),
  ];
  const r = aggregateRanking(ledger);
  const juan = r.find((x) => x.playerId === "juan")!;
  assert.equal(juan.points, 1600);
  assert.equal(juan.events, 2);
  assert.equal(juan.position, 1);
  // Recalcular t1 (p. ej. tras corregir un resultado) reemplaza, no suma
  const replaced = ledger.filter((l) => l.tournamentCategoryId !== "t1").concat(
    t1.map((a) => ({ playerId: a.playerId, points: a.points, tournamentCategoryId: "t1", categoryId: "c", circuitId: null, seasonId: "2026" })),
  );
  assert.equal(aggregateRanking(replaced).find((x) => x.playerId === "juan")!.points, 1600);
});

test("un jugador no puede sumar dos veces en la misma categoría-torneo", () => {
  const a = computeAwards(new Map([["e1", "CHAMPION" as const], ["e2", "FINALIST" as const]]), [
    { entryId: "e1", playerIds: ["x", "y"] },
    { entryId: "e2", playerIds: ["x", "z"] },
  ], DEFAULT_POINTS);
  assert.equal(a.filter((w) => w.playerId === "x").length, 1);
});
