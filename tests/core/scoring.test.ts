import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMATS, summarizePlayed, summarize, parseScoreText, ScoreError } from "../../src/core/scoring";

test("mejor de 3 con super tiebreak", () => {
  const s = summarizePlayed(FORMATS.BEST_OF_3_STB, [[6, 4], [3, 6], [10, 8]]);
  assert.deepEqual(s, { winner: "A", setsA: 2, setsB: 1, gamesA: 10, gamesB: 10 });
});

test("a un set con tiebreak 7-6", () => {
  assert.equal(summarizePlayed(FORMATS.ONE_SET, [[6, 7]]).winner, "B");
});

test("sets inválidos se rechazan", () => {
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3, [[6, 5]]), ScoreError);
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3, [[6, 4]]), /no está terminado/);
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3, [[6, 4], [6, 4], [6, 4]]), ScoreError);
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3_STB, [[6, 4], [4, 6], [10, 9]]), /dos puntos/);
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3, [[8, 6]]), ScoreError);
});

test("super tiebreak extendido 12-10 es válido; 13-10 no", () => {
  assert.equal(summarizePlayed(FORMATS.BEST_OF_3_STB, [[4, 6], [6, 4], [10, 12]]).winner, "B");
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3_STB, [[4, 6], [6, 4], [13, 10]]));
});

test("tercer set normal cuando no hay super tiebreak", () => {
  const s = summarizePlayed(FORMATS.BEST_OF_3, [[6, 4], [3, 6], [7, 5]]);
  assert.equal(s.gamesA, 16);
});

test("walkover y abandono", () => {
  assert.deepEqual(summarize(FORMATS.BEST_OF_3, { kind: "WALKOVER", winner: "B" }), { winner: "B", setsA: 0, setsB: 2, gamesA: 0, gamesB: 12 });
  const r = summarize(FORMATS.BEST_OF_3, { kind: "RETIRED", winner: "A", sets: [[6, 2], [2, 1]] });
  assert.equal(r.winner, "A");
  assert.equal(r.setsA, 2);
});

test("parseo de texto", () => {
  assert.deepEqual(parseScoreText("6-4 3-6 10-8"), [[6, 4], [3, 6], [10, 8]]);
  assert.throws(() => parseScoreText("6/4x"));
});

test("tiebreak en 5-5: el set termina 6-5; 7-5 y 7-6 no valen", () => {
  const f = { ...FORMATS.BEST_OF_3_STB, tiebreakAt: 5 };
  assert.equal(summarizePlayed(f, [[6, 5], [5, 6], [10, 7]]).winner, "A");
  assert.equal(summarizePlayed(f, [[6, 4], [6, 5]]).winner, "A");
  assert.throws(() => summarizePlayed(f, [[7, 5], [6, 4]]), ScoreError);
  assert.throws(() => summarizePlayed(f, [[7, 6], [6, 4]]), ScoreError);
  // con tiebreak en 6-6 (por defecto) 6-5 no termina el set
  assert.throws(() => summarizePlayed(FORMATS.BEST_OF_3_STB, [[6, 5], [6, 4]]), ScoreError);
});

import { gvgStandings, type ZoneData, type ZoneMatchData } from "../../src/core/engine";
import { computeStandings } from "../../src/core/standings";
import { summarizePlayed as sp } from "../../src/core/scoring";

test("GvG/PvP: posiciones = ganador de ganadores, perdedor de ganadores, ganador de perdedores, perdedor de perdedores", () => {
  const f = FORMATS.BEST_OF_3_STB;
  const ids = ["e1", "e2", "e3", "e4"];
  const z: ZoneData = { id: "Z", name: "A", entryIds: ids, manualOrder: [], format: "GVG", unresolved: 0 };
  // 1ª ronda: e1 le gana a e4; e3 le gana a e2. 2ª: e3 le gana a e1 (GvG); e4 le gana a e2 (PvP)
  const all: ZoneMatchData[] = [
    { id: "m1", zoneId: "Z", round: 1, a: "e1", b: "e4", status: "PLAYED", outcome: { kind: "PLAYED", sets: [[6, 0], [6, 0]] } },
    { id: "m2", zoneId: "Z", round: 1, a: "e2", b: "e3", status: "PLAYED", outcome: { kind: "PLAYED", sets: [[0, 6], [0, 6]] } },
    { id: "m3", zoneId: "Z", round: 2, slot: "GVG", a: "e1", b: "e3", status: "PLAYED", outcome: { kind: "PLAYED", sets: [[6, 7], [6, 7]] } },
    { id: "m4", zoneId: "Z", round: 2, slot: "PVP", a: "e4", b: "e2", status: "PLAYED", outcome: { kind: "PLAYED", sets: [[7, 5], [7, 5]] } },
  ];
  const inputs = all.map((m) => ({ id: m.id, a: m.a, b: m.b, summary: sp(f, (m.outcome as { sets: [number, number][] }).sets) }));
  const base = computeStandings(ids, inputs);
  const g = gvgStandings(base, z, inputs, all);
  assert.deepEqual(g.rows.map((r) => r.entryId), ["e3", "e1", "e4", "e2"]);
  assert.ok(g.final);
  // Sin la 2ª ronda: no es definitiva
  const partial = gvgStandings(computeStandings(ids, inputs.slice(0, 2)), { ...z, unresolved: 2 }, inputs.slice(0, 2), all.slice(0, 2));
  assert.equal(partial.final, false);
  assert.deepEqual(new Set(partial.rows.slice(0, 2).map((r) => r.entryId)), new Set(["e1", "e3"]), "los ganadores de la 1ª ronda arriba");
});
