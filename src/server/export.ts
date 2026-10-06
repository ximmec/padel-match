import ExcelJS from "exceljs";
import type { Db } from "./db";
import { loadCategory, entryLabel, entryFullLabel, type LoadedCategory } from "./category";
import { loadTournamentSchedule } from "./schedule";
import { getRanking } from "./ranking";
import { queryAudit, type AuditFilter } from "./auditQuery";
import { ACTION_LABELS } from "./audit";
import { roundName, STAGE_LABELS } from "@/core/bracket";
import { categoryStages } from "@/core/engine";
import { scoreText } from "@/core/scoring";
import { TIEBREAK_LABELS } from "@/core/standings";
import { fmtDate, fmtDateTime } from "@/lib/format";

type Row = (string | number | null | undefined)[];

function sheet(wb: ExcelJS.Workbook, name: string, header: string[], rows: Row[], widths?: number[]) {
  const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
  ws.addRow(header);
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A1A33" } };
  for (const r of rows) ws.addRow(r.map((v) => (v === undefined ? null : v)));
  ws.columns.forEach((c, i) => { c.width = widths?.[i] ?? Math.min(50, Math.max(10, header[i]?.length ?? 10) + 4); });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  return ws;
}

const STATUS: Record<string, string> = { PENDING: "Pendiente", IN_PLAY: "En juego", PLAYED: "Finalizado", ANNULLED: "Anulado", ACTIVE: "Activa", WITHDRAWN: "Retirada" };

function categorySheets(wb: ExcelJS.Workbook, lcs: LoadedCategory[]) {
  // Inscripciones y jugadores
  sheet(wb, "Inscripciones", ["Categoría", "Pareja", "Jugador 1", "Código 1", "Jugador 2", "Código 2", "Siembra", "Zona", "Estado"],
    lcs.flatMap((lc) => lc.entries.map((e) => [
      lc.tc.category_name, entryLabel(e),
      e.players[0] ? `${e.players[0].first_name} ${e.players[0].last_name}` : "", e.players[0]?.code,
      e.players[1] ? `${e.players[1].first_name} ${e.players[1].last_name}` : "", e.players[1]?.code,
      e.seed, lc.zones.find((z) => z.entry_ids.includes(e.id))?.name ?? "", STATUS[e.status],
    ])), [18, 26, 22, 12, 22, 12, 8, 6, 10]);

  // Parejas y categorías (resumen con reglas)
  sheet(wb, "Categorías", ["Categoría", "Parejas activas", "Zonas", "Clasifican por zona", "Mejores siguientes", "Desempates"],
    lcs.map((lc) => [lc.tc.category_name, lc.entries.filter((e) => e.status === "ACTIVE").length, lc.zones.length,
      String(lc.rules.qualification.perZone), lc.rules.qualification.bestNext, lc.rules.tiebreaks.map((t) => TIEBREAK_LABELS[t]).join(" > ")]), [18, 14, 8, 18, 18, 60]);

  // Zonas y posiciones
  sheet(wb, "Zonas y posiciones", ["Categoría", "Zona", "Pos.", "Pareja", "PJ", "PG", "PP", "Sets +", "Sets -", "Games +", "Games -", "Estado zona"],
    lcs.flatMap((lc) => lc.zones.flatMap((z) => {
      const s = lc.view.standings.get(z.id)!;
      return s.rows.map((r) => [lc.tc.category_name, z.name, r.unresolvedTie ? `${r.position}=` : r.position, entryLabel(lc.entryMap.get(r.entryId)),
        r.played, r.won, r.lost, r.setsFor, r.setsAgainst, r.gamesFor, r.gamesAgainst, s.final ? "Definida" : s.complete ? "Empate a resolver" : "En juego"]);
    })), [18, 6, 6, 28]);

  // Resultados
  sheet(wb, "Resultados", ["Categoría", "Fase", "Pareja A", "Pareja B", "Resultado", "Estado", "Fecha y hora", "Cancha"],
    lcs.flatMap((lc) => lc.matches.map((m) => {
      let a = "", b = "", fase = "";
      if (m.phase === "ZONE") { a = entryLabel(lc.entryMap.get(m.entry_a!)); b = entryLabel(lc.entryMap.get(m.entry_b!)); fase = `Zona ${lc.zones.find((z) => z.id === m.zone_id)?.name ?? ""}`; }
      else {
        const rm = lc.view.bracket.find((x) => x.code === m.bracket_code);
        a = rm?.a.kind === "ENTRY" ? entryLabel(lc.entryMap.get(rm.a.entryId)) : rm?.a.kind === "BYE" ? "Pase libre" : "A definir";
        b = rm?.b.kind === "ENTRY" ? entryLabel(lc.entryMap.get(rm.b.entryId)) : rm?.b.kind === "BYE" ? "Pase libre" : "A definir";
        fase = `${roundName(lc.view.bracket.filter((x) => x.round === m.round).length)} (${m.bracket_code})`;
      }
      return [lc.tc.category_name, fase, a, b, m.outcome && m.status !== "PENDING" ? scoreText(m.outcome) : "", STATUS[m.status], m.scheduled_at ? fmtDateTime(m.scheduled_at) : "", m.court_name ?? ""];
    })), [18, 22, 26, 26, 18, 12, 18, 12]);

  // Cuadros
  sheet(wb, "Cuadros", ["Categoría", "Ronda", "Partido", "Pareja A", "Pareja B", "Ganador", "Resultado"],
    lcs.flatMap((lc) => lc.view.bracket.map((m) => {
      const row = lc.matches.find((x) => x.phase === "BRACKET" && x.bracket_code === m.code);
      const lbl = (r: typeof m.a) => (r.kind === "ENTRY" ? entryLabel(lc.entryMap.get(r.entryId)) : r.kind === "BYE" ? "Pase libre" : "A definir");
      return [lc.tc.category_name, roundName(lc.view.bracket.filter((x) => x.round === m.round).length), m.code, lbl(m.a), lbl(m.b),
        m.winner ? entryLabel(lc.entryMap.get(m.winner)) : "", row?.outcome && row.status === "PLAYED" ? scoreText(row.outcome) : m.byeAdvance ? "Pase libre" : ""];
    })), [18, 18, 9, 26, 26, 26, 16]);

  // Instancia alcanzada (base del ranking)
  sheet(wb, "Instancias", ["Categoría", "Pareja", "Jugadores", "Instancia alcanzada", "Puntos por jugador"],
    lcs.flatMap((lc) => {
      const { stages, complete } = categoryStages(lc.state, lc.view);
      return lc.entries.map((e) => {
        const s = stages.get(e.id) ?? "ZONE";
        return [lc.tc.category_name, entryLabel(e), entryFullLabel(e), complete ? STAGE_LABELS[s] : `${STAGE_LABELS[s]} (provisorio)`, complete ? lc.rules.points[s] : null];
      });
    }), [18, 26, 40, 26, 16]);
}

export async function tournamentWorkbook(db: Db, orgId: string, tournamentId: string, kind: "tournament" | "schedule") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PADEL MATCH";
  const s = await loadTournamentSchedule(db, tournamentId, orgId);
  const court = (id: string | null) => s.courts.find((c) => c.id === id)?.name ?? "";
  const sorted = [...s.items].sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
  sheet(wb, "Cronograma", ["Fecha y hora", "Cancha", "Categoría", "Fase", "Pareja A", "Pareja B", "Estado", "Fijado"],
    sorted.map((i) => [i.start ? fmtDateTime(i.start) : "Sin horario", court(i.courtId), i.categoryName, i.stage, i.sideA, i.sideB, STATUS[i.status], i.locked ? "Sí" : ""]),
    [18, 12, 18, 18, 26, 26, 12, 8]);
  if (kind === "tournament") categorySheets(wb, s.categories);
  return { wb, name: `${s.tournament.name}${kind === "schedule" ? " - cronograma" : ""}` };
}

export async function categoryWorkbook(db: Db, orgId: string, tcId: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PADEL MATCH";
  const lc = await loadCategory(db, tcId, orgId);
  categorySheets(wb, [lc]);
  return { wb, name: `${lc.tc.tournament_name} - ${lc.tc.category_name}` };
}

export async function rankingWorkbook(db: Db, orgId: string, f: { categoryId?: string; circuitId?: string; seasonId?: string }) {
  const wb = new ExcelJS.Workbook();
  const rows = await getRanking(db, orgId, f);
  sheet(wb, "Ranking", ["Posición", "Código", "Apellido", "Nombre", "Torneos", "Puntos"], rows.map((r) => [r.position, r.code, r.last_name, r.first_name, r.events, r.points]), [10, 12, 20, 20, 10, 10]);
  const hist = await db<{ code: string; first_name: string; last_name: string; tournament: string | null; category: string | null; kind: string; stage: string | null; points: number; reason: string | null; created_at: Date; superseded_at: Date | null }[]>`
    SELECT p.code, p.first_name, p.last_name, t.name AS tournament, c.name AS category, l.kind, l.stage, l.points, l.reason, l.created_at, l.superseded_at
    FROM ranking_ledger l JOIN players p ON p.id = l.player_id LEFT JOIN tournament_categories tc ON tc.id = l.tc_id
    LEFT JOIN tournaments t ON t.id = tc.tournament_id LEFT JOIN categories c ON c.id = l.category_id
    WHERE l.org_id = ${orgId} ORDER BY l.created_at DESC`;
  sheet(wb, "Historial de puntos", ["Fecha", "Código", "Jugador", "Torneo", "Categoría", "Tipo", "Instancia / motivo", "Puntos", "Vigente"],
    hist.map((h) => [fmtDateTime(h.created_at), h.code, `${h.first_name} ${h.last_name}`, h.tournament ?? "", h.category ?? "", h.kind === "AUTO" ? "Automático" : "Manual",
      h.kind === "AUTO" ? STAGE_LABELS[h.stage as keyof typeof STAGE_LABELS] ?? h.stage : h.reason, h.points, h.superseded_at ? "No (reemplazado)" : "Sí"]),
    [16, 12, 24, 24, 16, 12, 30, 8, 16]);
  return { wb, name: "Ranking" };
}

export async function playersWorkbook(db: Db, orgId: string) {
  const wb = new ExcelJS.Workbook();
  const rows = await db<{ code: string; first_name: string; last_name: string; gender: string; category: string | null; document: string | null; phone: string | null; email: string | null; city: string | null; deleted_at: Date | null }[]>`
    SELECT code, first_name, last_name, gender, category, document, phone, email, city, deleted_at FROM players WHERE org_id = ${orgId} ORDER BY lower(last_name), lower(first_name)`;
  sheet(wb, "Jugadores", ["Código", "Apellido", "Nombre", "Sexo", "Categoría", "DNI", "Celular", "Email", "Ciudad", "Estado"],
    rows.map((p) => [p.code, p.last_name, p.first_name, p.gender, p.category, p.document, p.phone, p.email, p.city, p.deleted_at ? "Baja" : "Activo"]), [12, 18, 18, 8, 12, 14, 16, 26, 16, 10]);
  return { wb, name: "Jugadores" };
}

export async function auditWorkbook(db: Db, f: AuditFilter) {
  const wb = new ExcelJS.Workbook();
  const rows = await queryAudit(db, { ...f, limit: 10000 });
  sheet(wb, "Historial de cambios", ["Fecha y hora", "Usuario", "Torneo", "Acción", "Detalle", "Entidad", "Valores anteriores", "Valores nuevos"],
    rows.map((r) => [fmtDateTime(r.created_at), r.user_name, r.tournament_name, ACTION_LABELS[r.action] ?? r.action, r.summary, r.entity,
      r.before == null ? "" : JSON.stringify(r.before).slice(0, 32000), r.after == null ? "" : JSON.stringify(r.after).slice(0, 32000)]),
    [18, 18, 22, 20, 60, 14, 40, 40]);
  return { wb, name: "Historial de cambios" };
}

export function fileName(name: string) {
  const date = fmtDate(new Date()).replace(/\//g, "-");
  return `${name} ${date}.xlsx`.replace(/[^\w\s.\-áéíóúñÁÉÍÓÚÑ]/g, "").replace(/\s+/g, " ");
}

export async function playersTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  sheet(wb, "Jugadores", ["Nombre", "Apellido", "Sexo", "Categoría", "DNI", "Celular", "Email", "Ciudad"], [
    ["Juan", "Pérez", "M", "Advanced", "30123456", "11 5555-1234", "juan@ejemplo.com", "La Plata"],
    ["Ana", "López", "F", "Beginner", "", "", "", ""],
  ], [16, 18, 8, 12, 14, 16, 26, 16]);
  return { wb, name: "Planilla modelo de jugadores" };
}
