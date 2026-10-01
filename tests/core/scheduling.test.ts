import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSchedule, validateSchedule, rescheduleFrom, type CourtInput, type SchedMatch } from "../../src/core/scheduling";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 10, 12, 0); // 9:00 en Buenos Aires
const courts: CourtInput[] = [
  { id: "c1", name: "Cancha 1", windows: [{ start: T0, end: T0 + 6 * H }] },
  { id: "c2", name: "Cancha 2", windows: [{ start: T0, end: T0 + 6 * H }] },
];
const cfg = { durationMin: 60, minRestMin: 30 };

test("no superpone jugadores y respeta descanso", () => {
  const matches: SchedMatch[] = [
    { id: "m1", players: ["a", "b", "c", "d"], dependsOn: [], priority: 1 },
    { id: "m2", players: ["a", "b", "e", "f"], dependsOn: [], priority: 2 },
    { id: "m3", players: ["g", "h", "i", "j"], dependsOn: [], priority: 3 },
  ];
  const r = generateSchedule(courts, matches, cfg);
  assert.equal(r.unscheduled.length, 0);
  const m1 = r.assignments.find((a) => a.matchId === "m1")!;
  const m2 = r.assignments.find((a) => a.matchId === "m2")!;
  const m3 = r.assignments.find((a) => a.matchId === "m3")!;
  assert.equal(m1.start, T0);
  assert.equal(m3.start, T0); // en paralelo en la otra cancha
  assert.ok(m2.start >= m1.end + 30 * 60_000);
  assert.deepEqual(validateSchedule(courts, matches, r.assignments, cfg), []);
});

test("los partidos de cuadro van después de los que los alimentan", () => {
  const matches: SchedMatch[] = [
    { id: "sf1", players: ["a", "b", "c", "d"], dependsOn: [], priority: 1 },
    { id: "sf2", players: ["e", "f", "g", "h"], dependsOn: [], priority: 1 },
    { id: "final", players: [], dependsOn: ["sf1", "sf2"], priority: 2 },
  ];
  const r = generateSchedule(courts, matches, cfg);
  const fin = r.assignments.find((a) => a.matchId === "final")!;
  assert.equal(fin.start, T0 + H + 30 * 60_000);
});

test("detecta conflictos en cambios manuales", () => {
  const matches: SchedMatch[] = [
    { id: "m1", label: "A vs B", players: ["a", "b", "c", "d"], dependsOn: [], priority: 1 },
    { id: "m2", label: "A vs C", players: ["a", "b", "e", "f"], dependsOn: [], priority: 2 },
  ];
  const manual = [
    { matchId: "m1", courtId: "c1", start: T0, end: T0 + H },
    { matchId: "m2", courtId: "c2", start: T0 + 30 * 60_000, end: T0 + 90 * 60_000 },
  ];
  const c = validateSchedule(courts, matches, manual, cfg);
  assert.ok(c.some((x) => x.kind === "PLAYER_OVERLAP"));
  const manual2 = [
    { matchId: "m1", courtId: "c1", start: T0, end: T0 + H },
    { matchId: "m2", courtId: "c1", start: T0 + H, end: T0 + 2 * H },
  ];
  assert.ok(validateSchedule(courts, matches, manual2, cfg).some((x) => x.kind === "REST"));
  const manual3 = [{ matchId: "m1", courtId: "c1", start: T0 + 5.5 * H, end: T0 + 6.5 * H }];
  assert.ok(validateSchedule(courts, matches, manual3, cfg).some((x) => x.kind === "OUTSIDE_AVAILABILITY"));
});

test("sin lugar → partidos sin programar", () => {
  const small: CourtInput[] = [{ id: "c1", name: "C1", windows: [{ start: T0, end: T0 + 2 * H }] }];
  const matches: SchedMatch[] = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, players: [`p${i}`], dependsOn: [], priority: i }));
  const r = generateSchedule(small, matches, cfg);
  assert.equal(r.assignments.length, 2);
  assert.deepEqual(r.unscheduled, ["m2"]);
});

test("recalcular por retraso mantiene fijos y corre el resto", () => {
  const matches: SchedMatch[] = [
    { id: "m1", players: ["a"], dependsOn: [], priority: 1, fixed: { courtId: "c1", start: T0 } },
    { id: "m2", players: ["b"], dependsOn: [], priority: 2 },
    { id: "m3", players: ["c"], dependsOn: [], priority: 3 },
  ];
  const now = T0 + 2 * H; // hay retraso: recién ahora se puede seguir
  const r = rescheduleFrom(courts, matches, cfg, now);
  assert.equal(r.assignments.find((a) => a.matchId === "m1")!.start, T0);
  assert.ok(r.assignments.filter((a) => a.matchId !== "m1").every((a) => a.start >= now));
});

test("agenda de un torneo de 14 parejas en 3 canchas sin conflictos", () => {
  const c3: CourtInput[] = ["c1", "c2", "c3"].map((id) => ({ id, name: id, windows: [{ start: T0, end: T0 + 12 * H }] }));
  // 4 zonas (4,4,3,3) → 6+6+3+3 = 18 partidos
  const zones = [4, 4, 3, 3];
  const matches: SchedMatch[] = [];
  let pr = 0;
  zones.forEach((size, z) => {
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
      matches.push({ id: `z${z}-${i}-${j}`, players: [`z${z}p${i}a`, `z${z}p${i}b`, `z${z}p${j}a`, `z${z}p${j}b`], dependsOn: [], priority: pr++ });
    }
  });
  const r = generateSchedule(c3, matches, cfg);
  assert.equal(r.unscheduled.length, 0);
  assert.deepEqual(validateSchedule(c3, matches, r.assignments, cfg), []);
});
