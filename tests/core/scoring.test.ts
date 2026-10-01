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
