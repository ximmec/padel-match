"use server";

import { z } from "zod";
import { sql, UserError, type Tx } from "../db";
import type { CurrentUser } from "../auth";
import { audit } from "../audit";
import { NeedsConfirmation } from "../errors";
import { runAction, str, optStr, int, req, uuid, isConfirmed, type ActionState } from "../action";
import { importPlayers } from "../importPlayers";
import { generateTournamentSchedule } from "../schedule";
import { PLAYER_CATEGORIES } from "@/core/playerImport";
import { hashPassword, passwordProblems } from "../password";
import { uniqueSlug, addCategory, slugify } from "../ops";
import { DEFAULT_RULES, type CategoryRules } from "@/core/engine";
import { FORMATS, type FormatKey } from "@/core/scoring";
import { fromLocalInput } from "@/lib/format";
import { PERMISSIONS, type Permission, type Role } from "../permissions";

/* --------------------------- Jugadores --------------------------- */

const playerSchema = z.object({
  first_name: z.string().trim().min(1, "Completá el nombre").max(60),
  last_name: z.string().trim().min(1, "Completá el apellido").max(60),
  gender: z.preprocess((v) => (v === "" || v == null ? "X" : v), z.enum(["M", "F", "X"], { message: "Sexo / género inválido" })),
  document: z.string().trim().max(20).optional().transform((v) => (v ? v.replace(/\D/g, "") || v : null)),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  email: z.string().trim().max(120).optional().transform((v) => v || null).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), "Email inválido"),
  city: z.string().trim().max(60).optional().transform((v) => v || null),
  category: z.string().trim().optional().transform((v) => v || null).refine((v) => v === null || (PLAYER_CATEGORIES as readonly string[]).includes(v), "Categoría inválida"),
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
});

function parsePlayer(fd: FormData) {
  const r = playerSchema.safeParse(Object.fromEntries(["first_name", "last_name", "gender", "document", "phone", "email", "city", "category", "notes"].map((k) => [k, str(fd, k)])));
  if (!r.success) throw new UserError(r.error.issues[0].message);
  return r.data;
}

export async function createPlayerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const d = parsePlayer(fd);
    const id = await sql.begin(async (tx) => {
      // Aviso de posible duplicado por nombre
      if (str(fd, "__force") !== "1") {
        const dup = await tx<{ code: string }[]>`SELECT code FROM players WHERE org_id = ${user.orgId} AND deleted_at IS NULL
          AND lower(first_name) = lower(${d.first_name}) AND lower(last_name) = lower(${d.last_name})`;
        if (dup.length) throw new UserError(`Ya existe un jugador con ese nombre (${dup.map((x) => x.code).join(", ")}). Si es otra persona, agregá el documento para diferenciarlo o marcá «Crear igual».`);
      }
      const [{ n }] = await tx<{ n: string }[]>`SELECT nextval('player_code_seq')::text AS n`;
      const code = `PM-${n.padStart(5, "0")}`;
      const [p] = await tx<{ id: string }[]>`
        INSERT INTO players (org_id, code, first_name, last_name, gender, document, phone, email, city, category, notes)
        VALUES (${user.orgId}, ${code}, ${d.first_name}, ${d.last_name}, ${d.gender}, ${d.document}, ${d.phone}, ${d.email}, ${d.city}, ${d.category}, ${d.notes})
        RETURNING id`;
      await audit(tx, user, { entity: "player", entityId: p.id, action: "create", summary: `Jugador ${d.first_name} ${d.last_name} (${code})`, after: d });
      return p.id;
    });
    return { message: "Jugador creado.", redirectTo: str(fd, "__return") || `/admin/players/${id}` };
  }, ["/admin/players"]);
}

export async function updatePlayerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const id = uuid(fd, "id");
    const d = parsePlayer(fd);
    await sql.begin(async (tx) => {
      const [before] = await tx`SELECT first_name, last_name, gender, document, phone, email, city, category, notes FROM players WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!before) throw new UserError("Jugador no encontrado.");
      await tx`UPDATE players SET first_name = ${d.first_name}, last_name = ${d.last_name}, gender = ${d.gender}, document = ${d.document},
               phone = ${d.phone}, email = ${d.email}, city = ${d.city}, category = ${d.category}, notes = ${d.notes}, updated_at = now() WHERE id = ${id}`;
      await audit(tx, user, { entity: "player", entityId: id, action: "update", summary: `Jugador ${d.first_name} ${d.last_name} modificado`, before, after: d });
    });
    return { message: "Cambios guardados." };
  }, ["/admin/players"]);
}

/** Jugadores inscriptos en una categoría que todavía no terminó (no se pueden eliminar). */
const BUSY = (orgId: string) => sql`
  SELECT DISTINCT ep.player_id FROM entry_players ep JOIN entries e ON e.id = ep.entry_id
  JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id
  WHERE t.org_id = ${orgId} AND ep.active AND e.status = 'ACTIVE' AND tc.status <> 'FINISHED' AND t.status NOT IN ('FINISHED','CANCELLED')`;

/**
 * Elimina un jugador. Si nunca jugó (sin inscripciones ni puntos) se borra del todo;
 * si tiene historial se da de baja y se conservan sus resultados y puntos.
 */
export async function deletePlayerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const id = uuid(fd, "id");
    const msg = await sql.begin(async (tx) => {
      const [p] = await tx<{ first_name: string; last_name: string }[]>`SELECT first_name, last_name FROM players WHERE id = ${id} AND org_id = ${user.orgId} AND deleted_at IS NULL`;
      if (!p) throw new UserError("Jugador no encontrado.");
      const [act] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id JOIN tournaments t ON t.id = tc.tournament_id
        WHERE ep.player_id = ${id} AND ep.active AND e.status = 'ACTIVE' AND tc.status <> 'FINISHED' AND t.status NOT IN ('FINISHED','CANCELLED')`;
      if (act.n > 0) throw new UserError(`${p.first_name} ${p.last_name} está inscripto en un torneo en curso. Retirá o reemplazá la inscripción primero.`);
      const [h] = await tx<{ n: number }[]>`SELECT (SELECT count(*) FROM entry_players WHERE player_id = ${id}) + (SELECT count(*) FROM ranking_ledger WHERE player_id = ${id}) AS n`;
      const name = `${p.first_name} ${p.last_name}`;
      if (Number(h.n) === 0) {
        await tx`DELETE FROM players WHERE id = ${id}`;
        await audit(tx, user, { entity: "player", entityId: id, action: "delete", summary: `Jugador ${name} eliminado` });
        return `${name} eliminado.`;
      }
      await tx`UPDATE players SET deleted_at = now() WHERE id = ${id}`;
      await audit(tx, user, { entity: "player", entityId: id, action: "delete", summary: `Baja del jugador ${name} (se conserva su historial)` });
      return `${name} dado de baja (tenía torneos jugados: se conservan sus resultados y puntos).`;
    });
    return { message: msg, redirectTo: `/admin/players?aviso=${encodeURIComponent(msg)}` };
  }, ["/admin/players", "/ranking"]);
}

/** Eliminar TODOS los jugadores (los que tienen historial se dan de baja; los inscriptos en torneos en curso se saltean). */
export async function deleteAllPlayersAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    if (str(fd, "confirm_text").toUpperCase() !== "ELIMINAR") throw new UserError("Para confirmar escribí ELIMINAR en el casillero.");
    const out = await sql.begin(async (tx) => {
      const [c] = await tx<{ total: number; busy: number; hist: number }[]>`
        WITH busy AS (${BUSY(user.orgId)}),
        live AS (SELECT id FROM players WHERE org_id = ${user.orgId} AND deleted_at IS NULL),
        hist AS (SELECT l.id FROM live l WHERE l.id NOT IN (SELECT player_id FROM busy)
                 AND (EXISTS (SELECT 1 FROM entry_players ep WHERE ep.player_id = l.id) OR EXISTS (SELECT 1 FROM ranking_ledger r WHERE r.player_id = l.id)))
        SELECT (SELECT count(*)::int FROM live) AS total,
               (SELECT count(*)::int FROM live WHERE id IN (SELECT player_id FROM busy)) AS busy,
               (SELECT count(*)::int FROM hist) AS hist`;
      const clean = c.total - c.busy - c.hist;
      if (c.total === 0) throw new UserError("No hay jugadores para eliminar.");
      if (!isConfirmed(fd)) {
        const items = [`Hay ${c.total} jugador(es) activos.`];
        if (clean) items.push(`${clean} nunca jugaron: se borran definitivamente.`);
        if (c.hist) items.push(`${c.hist} tienen torneos jugados: se dan de baja y se conservan sus resultados y puntos.`);
        if (c.busy) items.push(`${c.busy} están inscriptos en torneos en curso: NO se eliminan.`);
        items.push("Esta acción no se puede deshacer (los dados de baja se pueden reactivar uno por uno).");
        throw new NeedsConfirmation("Eliminar todos los jugadores", items);
      }
      await tx`
        WITH busy AS (${BUSY(user.orgId)})
        UPDATE players p SET deleted_at = now()
        WHERE p.org_id = ${user.orgId} AND p.deleted_at IS NULL AND p.id NOT IN (SELECT player_id FROM busy)
          AND (EXISTS (SELECT 1 FROM entry_players ep WHERE ep.player_id = p.id) OR EXISTS (SELECT 1 FROM ranking_ledger r WHERE r.player_id = p.id))`;
      await tx`
        WITH busy AS (${BUSY(user.orgId)})
        DELETE FROM players p
        WHERE p.org_id = ${user.orgId} AND p.deleted_at IS NULL AND p.id NOT IN (SELECT player_id FROM busy)
          AND NOT EXISTS (SELECT 1 FROM entry_players ep WHERE ep.player_id = p.id) AND NOT EXISTS (SELECT 1 FROM ranking_ledger r WHERE r.player_id = p.id)`;
      await audit(tx, user, { entity: "player", action: "delete", summary: `Eliminación masiva: ${clean} borrados, ${c.hist} dados de baja, ${c.busy} sin cambios (en torneos en curso)` });
      return { clean, hist: c.hist, busy: c.busy };
    });
    const parts = [`${out.clean} eliminados`];
    if (out.hist) parts.push(`${out.hist} dados de baja (conservan su historial)`);
    if (out.busy) parts.push(`${out.busy} no se tocaron porque están en torneos en curso`);
    const m = `Listo: ${parts.join(", ")}.`;
    return { message: m, redirectTo: `/admin/players?aviso=${encodeURIComponent(m)}` };
  }, ["/admin/players", "/ranking"]);
}

export async function restorePlayerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const id = uuid(fd, "id");
    await sql.begin(async (tx) => {
      await tx`UPDATE players SET deleted_at = NULL WHERE id = ${id} AND org_id = ${user.orgId}`;
      await audit(tx, user, { entity: "player", entityId: id, action: "update", summary: "Jugador reactivado" });
    });
    return { message: "Jugador reactivado." };
  }, ["/admin/players"]);
}

/* --------------------------- Torneos --------------------------- */

const tournamentSchema = z.object({
  name: z.string().trim().min(3, "El nombre debe tener al menos 3 caracteres").max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de inicio inválida"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de fin inválida"),
  match_duration_min: z.coerce.number().int().min(10).max(300),
  min_rest_min: z.coerce.number().int().min(0).max(600),
}).refine((d) => d.end_date >= d.start_date, "La fecha de fin no puede ser anterior al inicio");

async function orgRef(table: "venues" | "circuits" | "seasons", id: string | null, orgId: string) {
  if (!id) return null;
  uuid(id);
  const rows = await sql`SELECT id FROM ${sql(table)} WHERE id = ${id} AND org_id = ${orgId}`;
  if (!rows.length) throw new UserError("Referencia inválida.");
  return id;
}

/** Sede elegida, o crea una nueva si se eligió «+ Agregar nueva sede…». */
async function resolveVenue(tx: Tx, fd: FormData, user: CurrentUser): Promise<string | null> {
  if (str(fd, "venue_id") !== "__new__") return orgRef("venues", optStr(fd, "venue_id"), user.orgId);
  const name = str(fd, "new_venue_name").trim();
  if (name.length < 2) throw new UserError("Escribí el nombre de la nueva sede.");
  const [dup] = await tx<{ id: string }[]>`SELECT id FROM venues WHERE org_id = ${user.orgId} AND lower(name) = lower(${name})`;
  if (dup) return dup.id;
  const courts = Math.max(0, Math.min(40, int(fd, "new_venue_courts", 0) ?? 0));
  const [v] = await tx<{ id: string }[]>`INSERT INTO venues (org_id, name, address) VALUES (${user.orgId}, ${name}, ${optStr(fd, "new_venue_address")}) RETURNING id`;
  for (let i = 1; i <= courts; i++) await tx`INSERT INTO courts (venue_id, name, sort) VALUES (${v.id}, ${`Cancha ${i}`}, ${i})`;
  await audit(tx, user, { entity: "venue", entityId: v.id, action: "create", summary: `Sede ${name} con ${courts} cancha(s)` });
  return v.id;
}

/**
 * Usa N canchas de la sede (crea las que falten) y las habilita para el torneo
 * todos los días, desde el horario de inicio (o 9:00) hasta las 23:59.
 */
async function setupCourts(tx: Tx, tournamentId: string, venueId: string, n: number, start: string, end: string, time: string | null) {
  const have = await tx<{ id: string }[]>`SELECT id FROM courts WHERE venue_id = ${venueId} AND active ORDER BY sort, name`;
  const ids = have.slice(0, n).map((c) => c.id);
  for (let k = have.length + 1; ids.length < n; k++) {
    const [c] = await tx<{ id: string }[]>`INSERT INTO courts (venue_id, name, sort) VALUES (${venueId}, ${`Cancha ${k}`}, ${k}) RETURNING id`;
    ids.push(c.id);
  }
  const days: string[] = [];
  for (let d = new Date(`${start}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`) && days.length < 31; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  for (const day of days) {
    const from = new Date(`${day}T${time ?? "09:00"}:00-03:00`), to = new Date(`${day}T23:59:00-03:00`);
    if (from >= to) continue;
    for (const c of ids) await tx`INSERT INTO court_availability (tournament_id, court_id, starts_at, ends_at) VALUES (${tournamentId}, ${c}, ${from}, ${to})`;
  }
}

/** Campos extra de la tarjeta: horario, inscripción, cupo, logo y fondo. */
function cardFields(fd: FormData) {
  const time = str(fd, "start_time");
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new UserError("Horario de inicio inválido.");
  const feeRaw = str(fd, "entry_fee").replace(/[^\d]/g, "");
  const fee = feeRaw ? Number(feeRaw) : null;
  if (fee !== null && (!Number.isSafeInteger(fee) || fee > 100_000_000)) throw new UserError("Inscripción inválida.");
  const cupo = int(fd, "max_entries");
  if (cupo !== null && (cupo < 2 || cupo > 512)) throw new UserError("El cupo debe estar entre 2 y 512 parejas.");
  const logo = str(fd, "logo");
  if (logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 400_000)) throw new UserError("El logo no es válido o es demasiado grande.");
  const bg = ["cancha", "mapa", "ninguno"].includes(str(fd, "card_bg")) ? str(fd, "card_bg") : "cancha";
  return { time: time || null, fee, cupo, logo: logo || null, bg };
}

/** Crea (o reutiliza) la categoría armada en el formulario: nivel o suma + género + veteranos. */
async function builtCategory(tx: Tx, fd: FormData, user: CurrentUser): Promise<string | null> {
  if (str(fd, "newcat_on") !== "1") return null;
  const suma = fd.get("newcat_suma_on") === "on" ? str(fd, "newcat_suma") : "";
  const level = str(fd, "newcat_level");
  const gender = str(fd, "newcat_gender");
  const vet = str(fd, "newcat_vet");
  if (!suma && !level) throw new UserError("Elegí la categoría nueva (nivel o suma).");
  if (!["MALE", "FEMALE", "MIXED", "OPEN"].includes(gender)) throw new UserError("Elegí el género de la categoría nueva.");
  if (suma && !/^\d{1,2}$/.test(suma)) throw new UserError("Suma inválida.");
  if (vet && !/^\+\d{2}$/.test(vet)) throw new UserError("Categoría de veteranos inválida.");
  const g = ({ MALE: "Caballeros", FEMALE: "Damas", MIXED: "Mixto", OPEN: "" } as Record<string, string>)[gender];
  const name = [suma ? `Suma ${suma}` : level, g, vet].filter(Boolean).join(" ").slice(0, 80);
  const [existing] = await tx<{ id: string }[]>`SELECT id FROM categories WHERE org_id = ${user.orgId} AND lower(name) = lower(${name})`;
  if (existing) return existing.id;
  const [c] = await tx<{ id: string }[]>`INSERT INTO categories (org_id, name, gender_rule) VALUES (${user.orgId}, ${name}, ${gender}) RETURNING id`;
  await audit(tx, user, { entity: "category", entityId: c.id, action: "create", summary: `Categoría ${name} creada` });
  return c.id;
}

/** Reglas iniciales de las categorías a partir de «Estructura deportiva». */
function structureRules(fd: FormData): CategoryRules {
  const fk = str(fd, "format") as FormatKey;
  const format = fk && fk in FORMATS ? FORMATS[fk] : DEFAULT_RULES.format;
  const size = int(fd, "zone_size", DEFAULT_RULES.preferredZoneSize) ?? DEFAULT_RULES.preferredZoneSize;
  if (size < 2 || size > 8) throw new UserError("Parejas por zona inválido.");
  const pz = str(fd, "per_zone");
  const perZone: number | "ALL" = pz === "ALL" ? "ALL" : pz ? Number(pz) : DEFAULT_RULES.qualification.perZone;
  if (perZone !== "ALL" && (!Number.isInteger(perZone) || perZone < 1 || perZone > 8)) throw new UserError("Clasificados por zona inválido.");
  const autoBest = str(fd, "best_next") === "AUTO" && perZone !== "ALL";
  const bestNext = perZone === "ALL" || autoBest ? 0 : Math.max(0, Math.min(8, int(fd, "best_next", 0) ?? 0));
  const tb = str(fd, "tb");
  const fmt = { ...format, tiebreak: tb !== "NONE", ...(tb === "AT_G1" ? { tiebreakAt: format.gamesPerSet - 1 } : {}) };
  return {
    ...DEFAULT_RULES, mode: str(fd, "mode") === "KNOCKOUT" ? "KNOCKOUT" : "ZONES", format: fmt, preferredZoneSize: size,
    fourZone: fd.get("four_gvg") === "on" ? "GVG" : "RR",
    qualification: { perZone, bestNext, perZoneOf4: fd.get("four_pass3") === "on" ? 3 : null, autoBestNext: autoBest },
  };
}

export async function createTournamentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const r = tournamentSchema.safeParse({
      name: str(fd, "name"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date") || str(fd, "start_date"),
      match_duration_min: str(fd, "match_duration_min") || 60, min_rest_min: str(fd, "min_rest_min") || 30,
    });
    if (!r.success) throw new UserError(r.error.issues[0].message);
    const circuit = await orgRef("circuits", optStr(fd, "circuit_id"), user.orgId);
    const season = await orgRef("seasons", optStr(fd, "season_id"), user.orgId);
    const categoryIds = fd.getAll("category_ids").map(String).filter(Boolean);
    const card = cardFields(fd);
    const id = await sql.begin(async (tx) => {
      const venue = await resolveVenue(tx, fd, user);
      const slug = await uniqueSlug(tx, `${r.data.name} ${r.data.start_date.slice(0, 4)}`);
      const [t] = await tx<{ id: string }[]>`
        INSERT INTO tournaments (org_id, name, slug, venue_id, circuit_id, season_id, start_date, end_date, status, is_public, rules_text, match_duration_min, min_rest_min,
                                 start_time, entry_fee, max_entries, logo, card_bg, no_schedule, ignore_restrictions)
        VALUES (${user.orgId}, ${r.data.name}, ${slug}, ${venue}, ${circuit}, ${season}, ${r.data.start_date}, ${r.data.end_date}, 'OPEN',
                ${fd.get("is_public") === "on"}, ${optStr(fd, "rules_text")}, ${r.data.match_duration_min}, ${r.data.min_rest_min},
                ${card.time}, ${card.fee}, ${card.cupo}, ${card.logo}, ${card.bg}, ${fd.get("no_schedule") === "on"}, ${fd.get("ignore_restrictions") === "on"})
        RETURNING id`;
      const nCourts = int(fd, "courts_count");
      if (venue && nCourts) await setupCourts(tx, t.id, venue, Math.max(1, Math.min(40, nCourts)), r.data.start_date, r.data.end_date, card.time);
      await audit(tx, user, { entity: "tournament", entityId: t.id, action: "create", tournamentId: t.id, summary: `Torneo ${r.data.name} creado`, after: r.data });
      const rules = structureRules(fd);
      const built = await builtCategory(tx, fd, user);
      const all = [...new Set([...categoryIds.map((c) => uuid(c)), ...(built ? [built] : [])])];
      if (!all.length) throw new UserError("Elegí al menos una categoría o creá una nueva.");
      for (const c of all) await addCategory(tx, user, t.id, c, rules);
      return t.id;
    });
    return { message: "Torneo creado.", redirectTo: `/admin/tournaments/${id}` };
  }, ["/admin"]);
}

export async function updateTournamentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const id = uuid(fd, "id");
    const r = tournamentSchema.safeParse({
      name: str(fd, "name"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date") || str(fd, "start_date"),
      match_duration_min: str(fd, "match_duration_min"), min_rest_min: str(fd, "min_rest_min"),
    });
    if (!r.success) throw new UserError(r.error.issues[0].message);
    const status = str(fd, "status");
    if (!["DRAFT", "OPEN", "IN_PROGRESS", "FINISHED", "CANCELLED"].includes(status)) throw new UserError("Estado inválido.");
    const card = cardFields(fd);
    const circuit = await orgRef("circuits", optStr(fd, "circuit_id"), user.orgId);
    const season = await orgRef("seasons", optStr(fd, "season_id"), user.orgId);
    await sql.begin(async (tx) => {
      const venue = await resolveVenue(tx, fd, user);
      const [before] = await tx`SELECT name, start_date, end_date, status, venue_id, circuit_id, season_id, is_public, match_duration_min, min_rest_min FROM tournaments WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!before) throw new UserError("Torneo no encontrado.");
      await tx`UPDATE tournaments SET no_schedule = ${fd.get("no_schedule") === "on"}, ignore_restrictions = ${fd.get("ignore_restrictions") === "on"} WHERE id = ${id}`;
      await tx`UPDATE tournaments SET start_time = ${card.time}, entry_fee = ${card.fee}, max_entries = ${card.cupo}, logo = ${card.logo}, card_bg = ${card.bg} WHERE id = ${id}`;
      await tx`UPDATE tournaments SET name = ${r.data.name}, start_date = ${r.data.start_date}, end_date = ${r.data.end_date}, status = ${status},
        venue_id = ${venue}, circuit_id = ${circuit}, season_id = ${season}, is_public = ${fd.get("is_public") === "on"},
        rules_text = ${optStr(fd, "rules_text")}, match_duration_min = ${r.data.match_duration_min}, min_rest_min = ${r.data.min_rest_min}, updated_at = now()
        WHERE id = ${id}`;
      // Mantener circuito/temporada del ranking alineados con el torneo
      await tx`UPDATE ranking_ledger SET circuit_id = ${circuit}, season_id = ${season}
               WHERE tc_id IN (SELECT id FROM tournament_categories WHERE tournament_id = ${id}) AND kind = 'AUTO'`;
      await audit(tx, user, { entity: "tournament", entityId: id, action: "update", tournamentId: id, summary: `Torneo ${r.data.name} modificado`, before, after: { ...r.data, status, venue, circuit, season } });
    });
    return { message: "Torneo actualizado." };
  }, ["/admin", "/"]);
}

export async function addCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const tId = uuid(fd, "tournament_id");
    const cId = uuid(fd, "category_id");
    await sql.begin((tx) => addCategory(tx, user, tId, cId, DEFAULT_RULES));
    return { message: "Categoría agregada." };
  }, ["/admin"]);
}

export async function removeCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const tcId = uuid(fd, "tc_id");
    await sql.begin(async (tx) => {
      const [tc] = await tx<{ tournament_id: string; name: string }[]>`SELECT tc.tournament_id, c.name FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id JOIN tournaments t ON t.id = tc.tournament_id WHERE tc.id = ${tcId} AND t.org_id = ${user.orgId}`;
      if (!tc) throw new UserError("Categoría no encontrada.");
      const [n] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM entries WHERE tc_id = ${tcId}`;
      if (n.n > 0) throw new UserError("La categoría tiene inscripciones. No se puede quitar.");
      await tx`DELETE FROM tournament_categories WHERE id = ${tcId}`;
      await audit(tx, user, { entity: "tournament_category", entityId: tcId, action: "delete", tournamentId: tc.tournament_id, summary: `Categoría ${tc.name} quitada del torneo` });
    });
    return { message: "Categoría quitada." };
  }, ["/admin"]);
}

export async function addAvailabilityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("schedule.manage", async (user) => {
    const tId = uuid(fd, "tournament_id");
    const start = fromLocalInput(str(fd, "starts_at"));
    const end = fromLocalInput(str(fd, "ends_at"));
    if (!start || !end || end <= start) throw new UserError("Indicá un horario de inicio y fin válido.");
    const courtIds = fd.getAll("court_ids").map(String);
    if (!courtIds.length) throw new UserError("Elegí al menos una cancha.");
    await sql.begin(async (tx) => {
      const [t] = await tx<{ venue_id: string | null }[]>`SELECT venue_id FROM tournaments WHERE id = ${tId} AND org_id = ${user.orgId}`;
      if (!t) throw new UserError("Torneo no encontrado.");
      for (const c of courtIds) {
        const [ok] = await tx`SELECT 1 FROM courts WHERE id = ${uuid(c)} AND venue_id = ${t.venue_id}`;
        if (!ok) throw new UserError("Cancha inválida.");
        await tx`INSERT INTO court_availability (tournament_id, court_id, starts_at, ends_at) VALUES (${tId}, ${c}, ${start}, ${end})`;
      }
      await audit(tx, user, { entity: "schedule", entityId: tId, action: "update", tournamentId: tId, summary: `Disponibilidad agregada para ${courtIds.length} cancha(s)`, after: { start, end, courtIds } });
    });
    return { message: "Disponibilidad agregada." };
  }, ["/admin"]);
}

export async function removeAvailabilityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("schedule.manage", async (user) => {
    const id = uuid(fd, "id");
    await sql.begin(async (tx) => {
      const [a] = await tx<{ tournament_id: string }[]>`SELECT a.tournament_id FROM court_availability a JOIN tournaments t ON t.id = a.tournament_id WHERE a.id = ${id} AND t.org_id = ${user.orgId}`;
      if (!a) throw new UserError("No encontrado.");
      await tx`DELETE FROM court_availability WHERE id = ${id}`;
      await audit(tx, user, { entity: "schedule", entityId: id, action: "delete", tournamentId: a.tournament_id, summary: "Franja de disponibilidad eliminada" });
    });
    return { message: "Franja eliminada." };
  }, ["/admin"]);
}

/* --------------------------- Configuración --------------------------- */

export async function createCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const name = req(fd, "name", "el nombre");
    const rule = str(fd, "gender_rule");
    if (!["MALE", "FEMALE", "MIXED", "OPEN"].includes(rule)) throw new UserError("Tipo de categoría inválido.");
    await sql.begin(async (tx) => {
      const [c] = await tx<{ id: string }[]>`INSERT INTO categories (org_id, name, gender_rule) VALUES (${user.orgId}, ${name}, ${rule}) RETURNING id`;
      await audit(tx, user, { entity: "category", entityId: c.id, action: "create", summary: `Categoría ${name}` });
    });
    return { message: "Categoría creada." };
  }, ["/admin"]);
}

/* --------------------------- Circuitos --------------------------- */

function circuitFields(fd: FormData) {
  const name = req(fd, "name", "el nombre del circuito").slice(0, 80);
  const logo = str(fd, "logo");
  if (logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 400_000)) throw new UserError("El logo no es válido o es demasiado grande.");
  return { name, description: optStr(fd, "description")?.slice(0, 500) ?? null, logo: logo || null };
}

export async function createCircuitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const c = circuitFields(fd);
    await sql.begin(async (tx) => {
      const [dup] = await tx`SELECT 1 FROM circuits WHERE org_id = ${user.orgId} AND lower(name) = lower(${c.name})`;
      if (dup) throw new UserError("Ya existe un circuito con ese nombre.");
      const [r] = await tx<{ id: string }[]>`INSERT INTO circuits (org_id, name, description, logo) VALUES (${user.orgId}, ${c.name}, ${c.description}, ${c.logo}) RETURNING id`;
      await audit(tx, user, { entity: "circuit", entityId: r.id, action: "create", summary: `Circuito ${c.name}` });
    });
    return { message: `Circuito «${c.name}» creado. Ya podés crear torneos dentro de él.` };
  }, ["/admin", "/"]);
}

export async function updateCircuitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const id = uuid(fd, "circuit_id");
    const c = circuitFields(fd);
    await sql.begin(async (tx) => {
      const [r] = await tx`UPDATE circuits SET name = ${c.name}, description = ${c.description}, logo = ${c.logo} WHERE id = ${id} AND org_id = ${user.orgId} RETURNING id`;
      if (!r) throw new UserError("Circuito no encontrado.");
      await audit(tx, user, { entity: "circuit", entityId: id, action: "update", summary: `Circuito ${c.name} modificado` });
    });
    return { message: "Circuito guardado." };
  }, ["/admin", "/"]);
}

export async function deleteCircuitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const id = uuid(fd, "circuit_id");
    const msg = await sql.begin(async (tx) => {
      const [c] = await tx<{ name: string }[]>`SELECT name FROM circuits WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!c) throw new UserError("Circuito no encontrado.");
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM tournaments WHERE circuit_id = ${id}`;
      if (!isConfirmed(fd)) {
        throw new NeedsConfirmation(`Eliminar el circuito «${c.name}»`, [
          n ? `Sus ${n} torneo(s) NO se borran: quedan como torneos sin circuito.` : "No tiene torneos.",
          "El ranking del circuito deja de existir; los puntos siguen contando en el ranking general.",
          "Esta acción no se puede deshacer.",
        ]);
      }
      await tx`DELETE FROM circuits WHERE id = ${id}`;
      await audit(tx, user, { entity: "circuit", entityId: id, action: "delete", summary: `Circuito ${c.name} eliminado (${n} torneos quedaron sin circuito)` });
      return `Circuito «${c.name}» eliminado.`;
    });
    return { message: msg, redirectTo: "/admin/circuits" };
  }, ["/admin", "/"]);
}

export async function createSimpleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const kind = str(fd, "kind");
    const name = req(fd, "name", "el nombre");
    if (kind !== "circuits" && kind !== "seasons") throw new UserError("Tipo inválido.");
    await sql.begin(async (tx) => {
      await tx`INSERT INTO ${tx(kind)} (org_id, name) VALUES (${user.orgId}, ${name})`;
      await audit(tx, user, { entity: kind === "circuits" ? "circuit" : "season", action: "create", summary: `${kind === "circuits" ? "Circuito" : "Temporada"} ${name}` });
    });
    return { message: "Creado." };
  }, ["/admin"]);
}

export async function createVenueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const name = req(fd, "name", "el nombre de la sede");
    const courts = Math.max(0, Math.min(40, int(fd, "courts", 0) ?? 0));
    await sql.begin(async (tx) => {
      const [v] = await tx<{ id: string }[]>`INSERT INTO venues (org_id, name, address) VALUES (${user.orgId}, ${name}, ${optStr(fd, "address")}) RETURNING id`;
      for (let i = 1; i <= courts; i++) await tx`INSERT INTO courts (venue_id, name, sort) VALUES (${v.id}, ${`Cancha ${i}`}, ${i})`;
      await audit(tx, user, { entity: "venue", entityId: v.id, action: "create", summary: `Sede ${name} con ${courts} cancha(s)` });
    });
    return { message: "Sede creada." };
  }, ["/admin"]);
}

/**
 * Editar una sede: nombre, dirección y cantidad de canchas activas.
 * Si se suben las canchas se reactivan las desactivadas y se crean las que falten;
 * si se bajan se desactivan las últimas (los partidos ya jugados conservan su cancha).
 */
export async function updateVenueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const id = uuid(fd, "venue_id");
    const name = req(fd, "name", "el nombre de la sede");
    const n = int(fd, "courts");
    if (n === null || n < 0 || n > 40) throw new UserError("La cantidad de canchas tiene que ser entre 0 y 40.");
    const msg = await sql.begin(async (tx) => {
      const [v] = await tx<{ name: string }[]>`SELECT name FROM venues WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!v) throw new UserError("Sede no encontrada.");
      const all = await tx<{ id: string; name: string; active: boolean; sort: number }[]>`SELECT id, name, active, sort FROM courts WHERE venue_id = ${id} ORDER BY sort, name`;
      const active = all.filter((c) => c.active);
      let changes = "";
      if (n > active.length) {
        let need = n - active.length;
        for (const c of all.filter((x) => !x.active)) { if (!need) break; await tx`UPDATE courts SET active = true WHERE id = ${c.id}`; need--; }
        const nums = all.map((c) => Number(/(\d+)\s*$/.exec(c.name)?.[1] ?? 0));
        let k = Math.max(0, ...nums), sort = Math.max(0, ...all.map((c) => c.sort));
        while (need-- > 0) { k++; sort++; await tx`INSERT INTO courts (venue_id, name, sort) VALUES (${id}, ${`Cancha ${k}`}, ${sort})`; }
        changes = ` Ahora tiene ${n} cancha(s) activas.`;
      } else if (n < active.length) {
        const off = active.slice(n);
        const offIds = off.map((c) => c.id);
        const [{ live, sched }] = await tx<{ live: number; sched: number }[]>`
          SELECT count(*) FILTER (WHERE status = 'IN_PLAY')::int AS live,
                 count(*) FILTER (WHERE status = 'PENDING' AND scheduled_at IS NOT NULL)::int AS sched
          FROM matches WHERE court_id = ANY(${offIds}::uuid[])`;
        if (live) throw new UserError(`Hay ${live} partido(s) en juego en las canchas que querés quitar. Esperá a que terminen.`);
        if (!isConfirmed(fd)) {
          const items = [`Se desactivan: ${off.map((c) => c.name).join(", ")}.`];
          if (sched) items.push(`${sched} partido(s) pendiente(s) programados en esas canchas se reprograman desde ahora en las canchas que quedan (los resultados no se tocan).`);
          items.push("Los partidos ya jugados conservan su cancha. Podés volver a activarlas cuando quieras.");
          throw new NeedsConfirmation(`Bajar ${v.name} a ${n} cancha(s)`, items);
        }
        await tx`UPDATE matches SET court_id = NULL, scheduled_at = NULL, schedule_locked = false, updated_at = now() WHERE court_id = ANY(${offIds}::uuid[]) AND status = 'PENDING'`;
        await tx`UPDATE courts SET active = false WHERE id = ANY(${offIds}::uuid[])`;
        changes = ` Se desactivaron ${off.length} cancha(s).`;
        // Torneos en curso en esta sede: se reprograman solos desde ahora (los resultados no se tocan).
        const running = await tx<{ id: string; name: string }[]>`SELECT id, name FROM tournaments WHERE venue_id = ${id} AND status IN ('OPEN','IN_PROGRESS') AND NOT no_schedule`;
        const done: string[] = [];
        for (const t of running) {
          try { await generateTournamentSchedule(tx, user, t.id, "FROM_NOW"); done.push(t.name); } catch (e) { if (!(e instanceof UserError)) throw e; }
        }
        if (done.length) changes += ` Se reprogramó desde ahora: ${done.join(", ")}.`;
        else if (sched) changes += ` ${sched} partido(s) quedaron sin horario.`;
      }
      await tx`UPDATE venues SET name = ${name}, address = ${optStr(fd, "address")} WHERE id = ${id}`;
      await audit(tx, user, { entity: "venue", entityId: id, action: "update", summary: `Sede ${name}: ${n} cancha(s) activas` });
      return `Sede guardada.${changes}`;
    });
    return { message: msg };
  }, ["/admin"]);
}

/** Eliminar una sede (no se puede si la usa un torneo que todavía no terminó). */
export async function deleteVenueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const id = uuid(fd, "venue_id");
    const msg = await sql.begin(async (tx) => {
      const [v] = await tx<{ name: string }[]>`SELECT name FROM venues WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!v) throw new UserError("Sede no encontrada.");
      const ts = await tx<{ name: string; status: string }[]>`SELECT name, status FROM tournaments WHERE venue_id = ${id} ORDER BY start_date DESC`;
      const open = ts.filter((t) => !["FINISHED", "CANCELLED"].includes(t.status));
      if (open.length) throw new UserError(`No se puede eliminar: la usan torneos que todavía no terminaron (${open.map((t) => t.name).join(", ")}). Cambiales la sede o eliminalos primero.`);
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM courts WHERE venue_id = ${id}`;
      if (!isConfirmed(fd)) {
        const items = [`Se borran sus ${n} cancha(s).`];
        if (ts.length) items.push(`${ts.length} torneo(s) terminado(s) van a figurar «Sin sede» y sus partidos sin cancha.`);
        items.push("Esta acción no se puede deshacer.");
        throw new NeedsConfirmation(`Eliminar la sede «${v.name}»`, items);
      }
      await tx`DELETE FROM venues WHERE id = ${id}`;
      await audit(tx, user, { entity: "venue", entityId: id, action: "delete", summary: `Sede ${v.name} eliminada (${n} canchas)` });
      return `Sede «${v.name}» eliminada.`;
    });
    return { message: msg };
  }, ["/admin"]);
}

export async function addCourtAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const venueId = uuid(fd, "venue_id");
    const name = req(fd, "name", "el nombre de la cancha");
    await sql.begin(async (tx) => {
      const [v] = await tx`SELECT 1 FROM venues WHERE id = ${venueId} AND org_id = ${user.orgId}`;
      if (!v) throw new UserError("Sede no encontrada.");
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM courts WHERE venue_id = ${venueId}`;
      await tx`INSERT INTO courts (venue_id, name, sort) VALUES (${venueId}, ${name}, ${n + 1})`;
      await audit(tx, user, { entity: "court", action: "create", summary: `Cancha ${name}` });
    });
    return { message: "Cancha agregada." };
  }, ["/admin"]);
}

export async function toggleCourtAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings.manage", async (user) => {
    const id = uuid(fd, "id");
    await sql.begin(async (tx) => {
      const [c] = await tx<{ active: boolean; name: string }[]>`SELECT c.active, c.name FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ${id} AND v.org_id = ${user.orgId}`;
      if (!c) throw new UserError("Cancha no encontrada.");
      await tx`UPDATE courts SET active = ${!c.active} WHERE id = ${id}`;
      await audit(tx, user, { entity: "court", entityId: id, action: "update", summary: `Cancha ${c.name} ${c.active ? "desactivada" : "activada"}` });
    });
    return { message: "Cancha actualizada." };
  }, ["/admin"]);
}

/* --------------------------- Usuarios --------------------------- */

export async function createUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("users.manage", async (user) => {
    const email = req(fd, "email", "el email").toLowerCase();
    const name = req(fd, "name", "el nombre");
    const role = str(fd, "role") as Role;
    if (!["ADMIN", "ORGANIZER", "RESULTS_OPERATOR"].includes(role)) throw new UserError("Rol inválido.");
    const password = String(fd.get("password") ?? "");
    const pp = passwordProblems(password);
    if (pp) throw new UserError(pp);
    const hash = await hashPassword(password);
    await sql.begin(async (tx) => {
      const [existing] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
      let id = existing?.id;
      if (!id) {
        const [u] = await tx<{ id: string }[]>`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${name}, ${hash}) RETURNING id`;
        id = u.id;
      }
      await tx`INSERT INTO memberships (user_id, org_id, role) VALUES (${id}, ${user.orgId}, ${role})
               ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role`;
      await audit(tx, user, { entity: "user", entityId: id, action: "create", summary: `Usuario ${email} con rol ${role}` });
    });
    return { message: "Usuario creado. Compartile su email y contraseña inicial." };
  }, ["/admin/settings"]);
}

export async function updateMembershipAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("users.manage", async (user) => {
    const userId = uuid(fd, "user_id");
    const role = str(fd, "role") as Role;
    if (!["ADMIN", "ORGANIZER", "RESULTS_OPERATOR"].includes(role)) throw new UserError("Rol inválido.");
    const grant = fd.getAll("grant").map(String).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    const revoke = fd.getAll("revoke").map(String).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    if (userId === user.id && role !== "ADMIN" && !user.isSuperadmin) throw new UserError("No podés quitarte el rol de administrador a vos mismo.");
    await sql.begin(async (tx) => {
      const [before] = await tx`SELECT role, permissions FROM memberships WHERE user_id = ${userId} AND org_id = ${user.orgId}`;
      if (!before) throw new UserError("Usuario no encontrado.");
      const perms = { grant, revoke };
      await tx`UPDATE memberships SET role = ${role}, permissions = ${JSON.stringify(perms)}::text::jsonb WHERE user_id = ${userId} AND org_id = ${user.orgId}`;
      if (fd.get("active") !== null) await tx`UPDATE users SET active = ${fd.get("active") === "on"} WHERE id = ${userId} AND id <> ${user.id}`;
      await audit(tx, user, { entity: "user", entityId: userId, action: "update", summary: "Rol y permisos modificados", before, after: { role, perms } });
    });
    return { message: "Permisos actualizados." };
  }, ["/admin/settings"]);
}

export async function createOrgAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async (user) => {
    if (!user.isSuperadmin) throw new UserError("Solo el administrador de la plataforma puede crear organizadores.");
    const name = req(fd, "name", "el nombre");
    await sql.begin(async (tx) => {
      const [o] = await tx<{ id: string }[]>`INSERT INTO organizations (name, slug) VALUES (${name}, ${slugify(name) + "-" + Date.now().toString(36)}) RETURNING id`;
      await tx`INSERT INTO categories (org_id, name, gender_rule) VALUES (${o.id}, 'Libre Masculina', 'MALE'), (${o.id}, 'Libre Femenina', 'FEMALE'), (${o.id}, 'Mixta', 'MIXED')`;
      await audit(tx, user, { entity: "organization", entityId: o.id, action: "create", summary: `Organizador ${name} creado` });
    });
    return { message: "Organizador creado. Cambiá a él desde el selector superior." };
  }, ["/admin"]);
}

/* --------------------------- Importación de jugadores --------------------------- */

export async function importPlayersAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Elegí el archivo de Excel.");
    const g = str(fd, "default_gender");
    const defaultGender = g === "M" || g === "F" || g === "X" ? g : null;
    const r = await sql.begin((tx) => importPlayers(tx, user, file, defaultGender, isConfirmed(fd)));
    return { message: `¡Listo! Se cargaron ${r.created} jugador(es).${r.updated ? ` Se actualizó la categoría de ${r.updated}.` : ""}${r.skipped ? ` ${r.skipped} ya existían sin cambios.` : ""}${r.issues ? ` ${r.issues} fila(s) tenían problemas y no se cargaron.` : ""}` };
  }, ["/admin/players"]);
}
