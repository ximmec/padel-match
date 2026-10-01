"use server";

import { sql, UserError } from "../db";
import { runAction, str, optStr, int, uuid, isConfirmed, type ActionState } from "../action";
import * as ops from "../ops";
import { generateTournamentSchedule, moveMatchSchedule } from "../schedule";
import { manualAdjustment, recalcRankingById } from "../ranking";
import { parseScoreText, ScoreError, FORMATS, type MatchOutcome, type MatchFormat } from "@/core/scoring";
import { DEFAULT_TIEBREAKS, TIEBREAK_LABELS, type TiebreakCriterion } from "@/core/standings";
import { STAGE_ORDER, type SlotRef } from "@/core/bracket";
import type { CategoryRules, CrossZoneMode, WithdrawalPolicy } from "@/core/engine";
import { DEFAULT_RULES } from "@/core/engine";
import { fromLocalInput } from "@/lib/format";

const REVAL = ["/admin", "/t", "/jugador", "/ranking"];

/* --------------------------- Inscripciones --------------------------- */

export async function registerEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const tcId = uuid(fd, "tc_id");
    const p1 = uuid(fd, "player1");
    const p2 = uuid(fd, "player2");
    const seed = int(fd, "seed");
    if (seed !== null && seed < 1) throw new UserError("La cabeza de serie debe ser 1 o más.");
    await sql.begin((tx) => ops.registerEntry(tx, user, tcId, p1, p2, seed));
    return { message: "Pareja inscripta." };
  }, REVAL);
}

export async function setSeedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const seed = int(fd, "seed");
    await sql.begin((tx) => ops.setSeed(tx, user, uuid(fd, "entry_id"), seed && seed > 0 ? seed : null));
    return { message: "Guardado." };
  }, REVAL);
}

export async function deleteEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    await sql.begin((tx) => ops.deleteEntry(tx, user, uuid(fd, "entry_id")));
    return { message: "Inscripción eliminada." };
  }, REVAL);
}

export async function withdrawEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const policy = str(fd, "policy") as WithdrawalPolicy;
    if (policy !== "WO_PENDING" && policy !== "ANNUL_ALL") throw new UserError("Elegí cómo tratar los partidos.");
    await sql.begin((tx) => ops.withdrawEntry(tx, user, uuid(fd, "entry_id"), policy, isConfirmed(fd)));
    return { message: "Pareja retirada. Posiciones y cuadro recalculados." };
  }, REVAL);
}

export async function replacePlayerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const slot = int(fd, "slot");
    if (slot !== 1 && slot !== 2) throw new UserError("Elegí a qué jugador reemplazar.");
    await sql.begin((tx) => ops.replacePlayer(tx, user, uuid(fd, "entry_id"), slot, uuid(fd, "player_id")));
    return { message: "Jugador reemplazado. Los resultados de la pareja se conservan." };
  }, REVAL);
}

/* --------------------------- Reglas --------------------------- */

export async function updateRulesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const tcId = uuid(fd, "tc_id");
    const formatKey = str(fd, "format");
    let format: MatchFormat;
    if (formatKey === "CUSTOM") {
      const setsToWin = int(fd, "setsToWin") ?? 2;
      const gamesPerSet = int(fd, "gamesPerSet") ?? 6;
      const stbPoints = int(fd, "superTiebreakPoints") ?? 10;
      if (setsToWin < 1 || setsToWin > 3 || gamesPerSet < 1 || gamesPerSet > 12 || stbPoints < 5 || stbPoints > 15) throw new UserError("Formato personalizado inválido.");
      format = { setsToWin, gamesPerSet, tiebreak: fd.get("tiebreak") === "on", superTiebreakDecider: fd.get("superTiebreakDecider") === "on", superTiebreakPoints: stbPoints };
    } else {
      const f = (FORMATS as Record<string, MatchFormat>)[formatKey];
      if (!f) throw new UserError("Elegí un formato de partido.");
      format = f;
    }
    const tiebreaks = fd.getAll("tiebreaks").map(String).filter((t): t is TiebreakCriterion => t in TIEBREAK_LABELS);
    const unique = [...new Set(tiebreaks)];
    const perZoneRaw = str(fd, "perZone");
    const perZone = perZoneRaw === "ALL" ? "ALL" : Number(perZoneRaw);
    if (perZone !== "ALL" && (!Number.isInteger(perZone) || perZone < 1 || perZone > 8)) throw new UserError("Clasificados por zona inválido.");
    const bestNext = int(fd, "bestNext", 0) ?? 0;
    if (bestNext < 0 || bestNext > 16) throw new UserError("Cantidad de mejores ubicados inválida.");
    const points = { ...DEFAULT_RULES.points };
    for (const s of STAGE_ORDER) {
      const v = int(fd, `points_${s}`);
      if (v !== null) { if (v < 0 || v > 100000) throw new UserError("Puntos inválidos."); points[s] = v; }
    }
    const crossZoneMode = (str(fd, "crossZoneMode") || "AVERAGES") as CrossZoneMode;
    const withdrawalDefault = (str(fd, "withdrawalDefault") || "WO_PENDING") as WithdrawalPolicy;
    const preferredZoneSize = int(fd, "preferredZoneSize", 3) ?? 3;
    if (preferredZoneSize < 2 || preferredZoneSize > 8) throw new UserError("Tamaño de zona inválido.");
    const rules: CategoryRules = {
      format,
      tiebreaks: unique.length ? unique : DEFAULT_TIEBREAKS,
      qualification: { perZone, bestNext },
      crossZoneMode: crossZoneMode === "DROP_VS_LAST" ? "DROP_VS_LAST" : "AVERAGES",
      points,
      withdrawalDefault: withdrawalDefault === "ANNUL_ALL" ? "ANNUL_ALL" : "WO_PENDING",
      preferredZoneSize,
    };
    await sql.begin((tx) => ops.updateRules(tx, user, tcId, rules, isConfirmed(fd)));
    return { message: "Reglas guardadas." };
  }, REVAL);
}

/* --------------------------- Zonas --------------------------- */

export async function generateZonesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const tcId = uuid(fd, "tc_id");
    const manual = str(fd, "sizes");
    const sizes = manual ? manual.split(/[\s,;+]+/).filter(Boolean).map(Number) : null;
    if (sizes && sizes.some((x) => !Number.isInteger(x))) throw new UserError("Escribí los tamaños como números separados por comas, por ejemplo 4,3,3.");
    const seed = int(fd, "random_seed") ?? Math.floor(Math.random() * 1_000_000);
    await sql.begin((tx) => ops.generateZones(tx, user, tcId, sizes, seed));
    return { message: `Zonas generadas (sorteo #${seed}).` };
  }, REVAL);
}

export async function addZoneAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    await sql.begin((tx) => ops.addZone(tx, user, uuid(fd, "tc_id")));
    return { message: "Zona creada." };
  }, REVAL);
}

export async function deleteZoneAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    await sql.begin((tx) => ops.deleteZone(tx, user, uuid(fd, "zone_id")));
    return { message: "Zona eliminada." };
  }, REVAL);
}

export async function moveEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    await sql.begin((tx) => ops.moveEntry(tx, user, uuid(fd, "entry_id"), uuid(fd, "zone_id"), isConfirmed(fd)));
    return { message: "Pareja movida de zona." };
  }, REVAL);
}

export async function zoneTiebreakAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const order = fd.getAll("order").map(String).filter(Boolean).map((x) => uuid(x));
    if (new Set(order).size !== order.length) throw new UserError("Cada pareja debe ocupar un lugar distinto.");
    await sql.begin((tx) => ops.setZoneManualOrder(tx, user, uuid(fd, "zone_id"), order));
    return { message: "Desempate registrado." };
  }, REVAL);
}

export async function crossTiebreakAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const order = fd.getAll("order").map(String).filter(Boolean).map((x) => uuid(x));
    if (new Set(order).size !== order.length) throw new UserError("Cada pareja debe ocupar un lugar distinto.");
    const pos = int(fd, "pos") ?? 0;
    await sql.begin((tx) => ops.setCrossManualOrder(tx, user, uuid(fd, "tc_id"), pos, order));
    return { message: "Desempate entre zonas registrado." };
  }, REVAL);
}

/* --------------------------- Cuadro --------------------------- */

export async function generateBracketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    await sql.begin((tx) => ops.generateBracket(tx, user, uuid(fd, "tc_id")));
    return { message: "Cuadro generado." };
  }, REVAL);
}

export async function deleteBracketAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    await sql.begin((tx) => ops.deleteBracket(tx, user, uuid(fd, "tc_id")));
    return { message: "Cuadro eliminado." };
  }, REVAL);
}

export async function setBracketSlotAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const side = str(fd, "side");
    if (side !== "a" && side !== "b") throw new UserError("Lado inválido.");
    const v = str(fd, "ref");
    let ref: SlotRef;
    if (v === "BYE") ref = { t: "BYE" };
    else if (v.startsWith("ENTRY:")) ref = { t: "ENTRY", entryId: uuid(v.slice(6)) };
    else if (v.startsWith("ZONE:")) { const [, zone, pos] = v.split(":"); ref = { t: "ZONE", zone: uuid(zone), pos: Number(pos) }; }
    else if (v.startsWith("CROSS:")) { const [, pos, rank] = v.split(":"); ref = { t: "CROSS", pos: Number(pos), rank: Number(rank) }; }
    else if (v.startsWith("WINNER:")) ref = { t: "WINNER", match: v.slice(7) };
    else throw new UserError("Elegí a quién ubicar.");
    await sql.begin((tx) => ops.setBracketSlot(tx, user, uuid(fd, "tc_id"), str(fd, "code"), side, ref, isConfirmed(fd)));
    return { message: "Cruce modificado." };
  }, REVAL);
}

/* --------------------------- Resultados --------------------------- */

function parseOutcome(fd: FormData): MatchOutcome {
  const kind = str(fd, "kind") || "PLAYED";
  try {
    if (kind === "WALKOVER") {
      const w = str(fd, "winner");
      if (w !== "A" && w !== "B") throw new UserError("Indicá quién gana por W.O.");
      return { kind: "WALKOVER", winner: w };
    }
    // Se acepta texto libre ("6-4 3-6 10-8") o casillas por set
    const text = str(fd, "score");
    let sets = text ? parseScoreText(text) : [];
    if (!text) {
      for (let i = 1; i <= 5; i++) {
        const a = str(fd, `s${i}a`), b = str(fd, `s${i}b`);
        if (a === "" && b === "") continue;
        if (a === "" || b === "") throw new UserError(`Completá ambos valores del set ${i}.`);
        sets.push([Number(a), Number(b)]);
      }
    }
    if (kind === "RETIRED") {
      const w = str(fd, "winner");
      if (w !== "A" && w !== "B") throw new UserError("Indicá quién gana por abandono.");
      return { kind: "RETIRED", winner: w, sets };
    }
    if (!sets.length) throw new UserError("Cargá el resultado.");
    sets = sets.map(([a, b]) => [a, b]);
    return { kind: "PLAYED", sets };
  } catch (e) {
    if (e instanceof ScoreError) throw new UserError(e.message);
    throw e;
  }
}

export async function recordResultAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("results.enter", async (user) => {
    const outcome = parseOutcome(fd);
    const version = int(fd, "version");
    await sql.begin((tx) => ops.recordResult(tx, user, uuid(fd, "match_id"), outcome, version, optStr(fd, "reason"), isConfirmed(fd)));
    return { message: "Resultado guardado. Posiciones actualizadas." };
  }, REVAL);
}

export async function annulResultAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("results.enter", async (user) => {
    await sql.begin((tx) => ops.annulResult(tx, user, uuid(fd, "match_id"), str(fd, "reason")));
    return { message: "Resultado borrado (queda en el historial)." };
  }, REVAL);
}

export async function setInPlayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("results.enter", async (user) => {
    await sql.begin((tx) => ops.setInPlay(tx, user, uuid(fd, "match_id"), str(fd, "in_play") === "1"));
    return { message: "Estado actualizado." };
  }, REVAL);
}

/* --------------------------- Cronograma --------------------------- */

export async function generateScheduleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("schedule.manage", async (user) => {
    const mode = str(fd, "mode") === "FROM_NOW" ? "FROM_NOW" : "ALL";
    const r = await sql.begin((tx) => generateTournamentSchedule(tx, user, uuid(fd, "tournament_id"), mode));
    return { message: `${r.scheduled} partidos programados${r.unscheduled ? `, ${r.unscheduled} sin lugar (agregá canchas u horarios)` : ""}.` };
  }, REVAL);
}

export async function moveMatchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("schedule.manage", async (user) => {
    const courtId = optStr(fd, "court_id");
    const start = fromLocalInput(str(fd, "start"));
    if ((courtId && !start) || (!courtId && start)) throw new UserError("Elegí cancha y horario, o dejá ambos vacíos para desprogramar.");
    await sql.begin((tx) => moveMatchSchedule(tx, user, uuid(fd, "match_id"), courtId ? uuid(courtId) : null, start, fd.get("lock") !== "off", isConfirmed(fd)));
    return { message: "Horario actualizado." };
  }, REVAL);
}

/* --------------------------- Ranking --------------------------- */

export async function rankingAdjustAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("ranking.adjust", async (user) => {
    const points = int(fd, "points");
    if (points === null) throw new UserError("Indicá los puntos.");
    await sql.begin((tx) => manualAdjustment(tx, user, {
      playerId: uuid(fd, "player_id"), points, reason: str(fd, "reason"),
      tcId: optStr(fd, "tc_id"), categoryId: optStr(fd, "category_id"), circuitId: optStr(fd, "circuit_id"), seasonId: optStr(fd, "season_id"),
    }));
    return { message: "Ajuste registrado." };
  }, REVAL);
}

export async function recalcRankingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("ranking.adjust", async (user) => {
    const r = await sql.begin((tx) => recalcRankingById(tx, user, uuid(fd, "tc_id"), user.orgId));
    return { message: r.changed ? `Ranking recalculado (${r.awarded} jugadores).` : "El ranking ya estaba al día: no hubo cambios." };
  }, REVAL);
}
