import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStandings, rankAcrossZones, type ZoneMatchInput } from "../../src/core/standings";
import { summarizePlayed, FORMATS, type SetScore } from "../../src/core/scoring";

const m = (id: string, a: string, b: string, sets: SetScore[] | null): ZoneMatchInput => ({
  id, a, b, summary: sets ? summarizePlayed(FORMATS.BEST_OF_3, sets) : null,
});

test("zona de 3 sin empates", () => {
  const s = computeStandings(["x", "y", "z"], [
    m("1", "x", "y", [[6, 1], [6, 1]]),
    m("2", "x", "z", [[6, 1], [6, 1]]),
    m("3", "y", "z", [[6, 1], [6, 1]]),
  ]);
  assert.deepEqual(s.rows.map((r) => r.entryId), ["x", "y", "z"]);
  assert.equal(s.final, true);
});

test("empate entre dos se define por resultado entre sí", () => {
  // zona de 4: a y b terminan 2-1; b le ganó a a.
  const s = computeStandings(["a", "b", "c", "d"], [
    m("1", "a", "b", [[0, 6], [0, 6]]),
    m("2", "a", "c", [[6, 0], [6, 0]]),
    m("3", "a", "d", [[6, 0], [6, 0]]),
    m("4", "b", "c", [[0, 6], [0, 6]]),
    m("5", "b", "d", [[6, 0], [6, 0]]),
    m("6", "c", "d", [[0, 6], [0, 6]]),
  ]);
  // a: 2G (sets 4-2, games 24-12); b: 2G; c: 1G; d: 1G
  const [first, second] = s.rows;
  assert.equal(first.entryId, "b");
  assert.equal(first.decidedBy, "HEAD_TO_HEAD");
  assert.equal(second.entryId, "a");
  // c y d: d le ganó a c
  assert.equal(s.rows[2].entryId, "d");
});

test("triple empate se define por diferencia de sets y games", () => {
  const s = computeStandings(["a", "b", "c"], [
    m("1", "a", "b", [[6, 0], [6, 0]]),
    m("2", "b", "c", [[6, 4], [6, 4]]),
    m("3", "c", "a", [[6, 3], [3, 6], [6, 3]]),
  ]);
  // a: sets 3-2 games 21-9  → +1 set; b: 2-2 games 12-20 → 0; c: 2-3 games 23-24 → -1
  assert.deepEqual(s.rows.map((r) => r.entryId), ["a", "b", "c"]);
  assert.equal(s.rows[0].decidedBy, "SET_DIFF");
});

test("empate perfecto queda sin resolver hasta sorteo manual", () => {
  const ms = [
    m("1", "a", "b", [[6, 4], [6, 4]]),
    m("2", "b", "c", [[6, 4], [6, 4]]),
    m("3", "c", "a", [[6, 4], [6, 4]]),
  ];
  const s = computeStandings(["a", "b", "c"], ms);
  assert.equal(s.final, false);
  assert.ok(s.rows.every((r) => r.unresolvedTie && r.position === 1));
  const s2 = computeStandings(["a", "b", "c"], ms, undefined, ["c", "a", "b"]);
  assert.equal(s2.final, true);
  assert.deepEqual(s2.rows.map((r) => r.entryId), ["c", "a", "b"]);
});

test("partidos pendientes → zona no definitiva", () => {
  const s = computeStandings(["a", "b", "c"], [m("1", "a", "b", [[6, 0], [6, 0]]), m("2", "a", "c", null), m("3", "b", "c", null)]);
  assert.equal(s.complete, false);
  assert.equal(s.final, false);
  assert.equal(s.pendingMatches, 2);
});

test("mejores segundos entre zonas de distinto tamaño usan promedios", () => {
  const row = (entryId: string, played: number, won: number, sf: number, sa: number, gf: number, ga: number) => ({
    entryId, zoneId: entryId, row: { entryId, played, won, lost: played - won, setsFor: sf, setsAgainst: sa, gamesFor: gf, gamesAgainst: ga, position: 2, unresolvedTie: false, decidedBy: null },
  });
  // Zona de 4: 2 ganados de 3 (66%); zona de 3: 1 de 2 (50%) → gana el de zona de 4 pese a jugar más
  const { ordered } = rankAcrossZones([row("z3", 2, 1, 2, 2, 20, 20), row("z4", 3, 2, 4, 2, 30, 20)]);
  assert.equal(ordered[0].entryId, "z4");
  // Mismo % → diferencia de sets por partido
  const r2 = rankAcrossZones([row("p", 2, 1, 3, 2, 20, 20), row("q", 3, 1, 3, 4, 30, 30), row("s", 4, 2, 5, 4, 40, 40)]);
  assert.deepEqual(r2.ordered.map((r) => r.entryId), ["p", "s", "q"]);
});
