"use server";

import { z } from "zod";
import { sql, UserError } from "../db";
import { audit } from "../audit";
import { runAction, str, optStr, int, req, uuid, isConfirmed, type ActionState } from "../action";
import { importPlayers } from "../importPlayers";
import { hashPassword, passwordProblems } from "../password";
import { uniqueSlug, addCategory, slugify } from "../ops";
import { DEFAULT_RULES } from "@/core/engine";
import { fromLocalInput } from "@/lib/format";
import { PERMISSIONS, type Permission, type Role } from "../permissions";

/* --------------------------- Jugadores --------------------------- */

const playerSchema = z.object({
  first_name: z.string().trim().min(1, "Completá el nombre").max(60),
  last_name: z.string().trim().min(1, "Completá el apellido").max(60),
  gender: z.enum(["M", "F", "X"], { message: "Elegí el género" }),
  document: z.string().trim().max(20).optional().transform((v) => (v ? v.replace(/\D/g, "") || v : null)),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  email: z.string().trim().max(120).optional().transform((v) => v || null).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), "Email inválido"),
  city: z.string().trim().max(60).optional().transform((v) => v || null),
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
});

function parsePlayer(fd: FormData) {
  const r = playerSchema.safeParse(Object.fromEntries(["first_name", "last_name", "gender", "document", "phone", "email", "city", "notes"].map((k) => [k, str(fd, k)])));
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
        INSERT INTO players (org_id, code, first_name, last_name, gender, document, phone, email, city, notes)
        VALUES (${user.orgId}, ${code}, ${d.first_name}, ${d.last_name}, ${d.gender}, ${d.document}, ${d.phone}, ${d.email}, ${d.city}, ${d.notes})
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
      const [before] = await tx`SELECT first_name, last_name, gender, document, phone, email, city, notes FROM players WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!before) throw new UserError("Jugador no encontrado.");
      await tx`UPDATE players SET first_name = ${d.first_name}, last_name = ${d.last_name}, gender = ${d.gender}, document = ${d.document},
               phone = ${d.phone}, email = ${d.email}, city = ${d.city}, notes = ${d.notes}, updated_at = now() WHERE id = ${id}`;
      await audit(tx, user, { entity: "player", entityId: id, action: "update", summary: `Jugador ${d.first_name} ${d.last_name} modificado`, before, after: d });
    });
    return { message: "Cambios guardados." };
  }, ["/admin/players"]);
}

export async function deletePlayerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("players.manage", async (user) => {
    const id = uuid(fd, "id");
    await sql.begin(async (tx) => {
      const [p] = await tx<{ first_name: string; last_name: string }[]>`SELECT first_name, last_name FROM players WHERE id = ${id} AND org_id = ${user.orgId} AND deleted_at IS NULL`;
      if (!p) throw new UserError("Jugador no encontrado.");
      const [act] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM entry_players ep JOIN entries e ON e.id = ep.entry_id JOIN tournament_categories tc ON tc.id = e.tc_id
        WHERE ep.player_id = ${id} AND ep.active AND tc.status <> 'FINISHED'`;
      if (act.n > 0) throw new UserError("El jugador está inscripto en un torneo en curso. Retirá o reemplazá la inscripción primero.");
      // Baja lógica: se conserva su historial y sus puntos
      await tx`UPDATE players SET deleted_at = now() WHERE id = ${id}`;
      await audit(tx, user, { entity: "player", entityId: id, action: "delete", summary: `Baja del jugador ${p.first_name} ${p.last_name} (se conserva su historial)` });
    });
    return { message: "Jugador dado de baja.", redirectTo: "/admin/players" };
  }, ["/admin/players"]);
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

export async function createTournamentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const r = tournamentSchema.safeParse({
      name: str(fd, "name"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date") || str(fd, "start_date"),
      match_duration_min: str(fd, "match_duration_min") || 60, min_rest_min: str(fd, "min_rest_min") || 30,
    });
    if (!r.success) throw new UserError(r.error.issues[0].message);
    const venue = await orgRef("venues", optStr(fd, "venue_id"), user.orgId);
    const circuit = await orgRef("circuits", optStr(fd, "circuit_id"), user.orgId);
    const season = await orgRef("seasons", optStr(fd, "season_id"), user.orgId);
    const categoryIds = fd.getAll("category_ids").map(String).filter(Boolean);
    const id = await sql.begin(async (tx) => {
      const slug = await uniqueSlug(tx, `${r.data.name} ${r.data.start_date.slice(0, 4)}`);
      const [t] = await tx<{ id: string }[]>`
        INSERT INTO tournaments (org_id, name, slug, venue_id, circuit_id, season_id, start_date, end_date, status, is_public, rules_text, match_duration_min, min_rest_min)
        VALUES (${user.orgId}, ${r.data.name}, ${slug}, ${venue}, ${circuit}, ${season}, ${r.data.start_date}, ${r.data.end_date}, 'OPEN',
                ${fd.get("is_public") === "on"}, ${optStr(fd, "rules_text")}, ${r.data.match_duration_min}, ${r.data.min_rest_min})
        RETURNING id`;
      await audit(tx, user, { entity: "tournament", entityId: t.id, action: "create", tournamentId: t.id, summary: `Torneo ${r.data.name} creado`, after: r.data });
      for (const c of categoryIds) await addCategory(tx, user, t.id, uuid(c), DEFAULT_RULES);
      return t.id;
    });
    return { message: "Torneo creado.", redirectTo: `/admin/tournaments/${id}` };
  }, ["/admin"]);
}

export async function updateTournamentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("tournaments.manage", async (user) => {
    const id = uuid(fd, "id");
    const r = tournamentSchema.safeParse({
      name: str(fd, "name"), start_date: str(fd, "start_date"), end_date: str(fd, "end_date"),
      match_duration_min: str(fd, "match_duration_min"), min_rest_min: str(fd, "min_rest_min"),
    });
    if (!r.success) throw new UserError(r.error.issues[0].message);
    const status = str(fd, "status");
    if (!["DRAFT", "OPEN", "IN_PROGRESS", "FINISHED", "CANCELLED"].includes(status)) throw new UserError("Estado inválido.");
    const venue = await orgRef("venues", optStr(fd, "venue_id"), user.orgId);
    const circuit = await orgRef("circuits", optStr(fd, "circuit_id"), user.orgId);
    const season = await orgRef("seasons", optStr(fd, "season_id"), user.orgId);
    await sql.begin(async (tx) => {
      const [before] = await tx`SELECT name, start_date, end_date, status, venue_id, circuit_id, season_id, is_public, match_duration_min, min_rest_min FROM tournaments WHERE id = ${id} AND org_id = ${user.orgId} FOR UPDATE`;
      if (!before) throw new UserError("Torneo no encontrado.");
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
    return { message: `¡Listo! Se cargaron ${r.created} jugador(es).${r.skipped ? ` ${r.skipped} ya existían y se omitieron.` : ""}${r.issues ? ` ${r.issues} fila(s) tenían problemas y no se cargaron.` : ""}` };
  }, ["/admin/players"]);
}
