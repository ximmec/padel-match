import ExcelJS from "exceljs";
import type { Tx } from "./db";
import { UserError } from "./db";
import type { CurrentUser } from "./auth";
import { audit } from "./audit";
import { NeedsConfirmation } from "./errors";
import { parsePlayerSheet, fold, type Gender, type ImportedPlayer } from "@/core/playerImport";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 5000;

/** Lee la primera hoja (Excel) o un CSV y devuelve las celdas como texto. */
export async function readSheet(file: File): Promise<string[][]> {
  if (!file || file.size === 0) throw new UserError("Elegí un archivo.");
  if (file.size > MAX_BYTES) throw new UserError("El archivo es demasiado grande (máximo 4 MB).");
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseCsv(buf.toString("utf8"));
  if (name.endsWith(".xls")) throw new UserError("Ese Excel es de un formato viejo (.xls). Abrilo en Excel y usá «Guardar como» → «Libro de Excel (.xlsx)».");
  if (!name.endsWith(".xlsx")) throw new UserError("Subí un archivo de Excel (.xlsx) o CSV.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UserError("No pude leer el archivo. Verificá que sea un Excel (.xlsx) válido.");
  }
  // La primera hoja que tenga datos
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new UserError("El Excel está vacío.");
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > MAX_ROWS + 10) return;
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) {
      const cell = row.getCell(c);
      let v = "";
      try { v = cell.text ?? ""; } catch { v = String(cell.value ?? ""); }
      cells.push(v.trim());
    }
    rows[n - 1] = cells;
  });
  return Array.from(rows, (r) => r ?? []);
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"' && clean[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.slice(0, MAX_ROWS + 10);
}

export async function importPlayers(tx: Tx, user: CurrentUser, file: File, defaultGender: Gender | null, confirmed: boolean) {
  const rows = await readSheet(file);
  const parsed = parsePlayerSheet(rows, defaultGender);
  if (parsed.headerRow === -1) throw new UserError(parsed.issues[0].message);
  if (parsed.players.length > MAX_ROWS) throw new UserError(`Máximo ${MAX_ROWS} jugadores por archivo.`);

  // Jugadores que ya existen (por documento o por nombre y apellido)
  const existing = await tx<{ id: string; first_name: string; last_name: string; document: string | null; category: string | null }[]>`
    SELECT id, first_name, last_name, document, category FROM players WHERE org_id = ${user.orgId} AND deleted_at IS NULL`;
  const byDoc = new Map(existing.filter((e) => e.document).map((e) => [e.document!, e]));
  const byName = new Map(existing.map((e) => [`${fold(e.first_name)}|${fold(e.last_name)}`, e]));
  const toCreate: ImportedPlayer[] = [];
  const skipped: ImportedPlayer[] = [];
  // Existentes cuya categoría cambia: se actualiza (útil para completar la categoría de jugadores ya cargados)
  const toUpdate: { id: string; p: ImportedPlayer; from: string | null }[] = [];
  for (const p of parsed.players) {
    const match = (p.document ? byDoc.get(p.document) : undefined) ?? byName.get(`${fold(p.first_name)}|${fold(p.last_name)}`);
    if (!match) toCreate.push(p);
    else if (p.category && p.category !== match.category) toUpdate.push({ id: match.id, p, from: match.category });
    else skipped.push(p);
  }

  if (!confirmed) {
    const items = [
      `Columnas reconocidas: ${parsed.columns.join(", ")} (encabezados en la fila ${parsed.headerRow}).`,
      `✅ ${toCreate.length} jugador(es) nuevo(s) para cargar.`,
    ];
    if (toCreate.length) {
      items.push(`Ejemplos: ${toCreate.slice(0, 3).map((p) => `${p.first_name} ${p.last_name} (${p.gender === "M" ? "Masc." : p.gender === "F" ? "Fem." : "Otro"}${p.category ? `, ${p.category}` : ""}${p.document ? `, DNI ${p.document}` : ""})`).join(" · ")}`);
    }
    if (toUpdate.length) items.push(`🔄 ${toUpdate.length} ya existían: se les actualiza la categoría (por ejemplo: ${toUpdate.slice(0, 3).map((u) => `${u.p.first_name} ${u.p.last_name} → ${u.p.category}`).join(", ")}).`);
    if (skipped.length) items.push(`⏭ ${skipped.length} ya existían sin cambios y se van a omitir (por ejemplo: ${skipped.slice(0, 3).map((p) => `${p.first_name} ${p.last_name}`).join(", ")}).`);
    if (parsed.issues.length) {
      items.push(`⚠ ${parsed.issues.length} fila(s) con problemas que no se van a cargar:`);
      for (const i of parsed.issues.slice(0, 8)) items.push(`Fila ${i.row}: ${i.message}`);
      if (parsed.issues.length > 8) items.push(`… y ${parsed.issues.length - 8} más.`);
    }
    if (!toCreate.length && !toUpdate.length) throw new UserError(items.slice(1).join(" "));
    throw new NeedsConfirmation(`Revisá antes de importar: ${toCreate.length} jugador(es) nuevo(s)${toUpdate.length ? ` y ${toUpdate.length} categoría(s) a actualizar` : ""}`, items);
  }

  for (const p of toCreate) {
    const [{ n }] = await tx<{ n: string }[]>`SELECT nextval('player_code_seq')::text AS n`;
    await tx`
      INSERT INTO players (org_id, code, first_name, last_name, gender, document, phone, email, city, category)
      VALUES (${user.orgId}, ${`PM-${n.padStart(5, "0")}`}, ${p.first_name}, ${p.last_name}, ${p.gender}, ${p.document}, ${p.phone}, ${p.email}, ${p.city}, ${p.category})`;
  }
  for (const u of toUpdate) {
    await tx`UPDATE players SET category = ${u.p.category}, updated_at = now() WHERE id = ${u.id}`;
  }
  await audit(tx, user, {
    entity: "player", action: "create",
    summary: `Importación desde «${file.name}»: ${toCreate.length} jugador(es) creados, ${toUpdate.length} categoría(s) actualizadas, ${skipped.length} ya existentes sin cambios, ${parsed.issues.length} fila(s) con problemas`,
    after: { file: file.name, created: toCreate.length, updated: toUpdate.map((u) => ({ id: u.id, from: u.from, to: u.p.category })), skipped: skipped.length, issues: parsed.issues.slice(0, 50) },
  });
  return { created: toCreate.length, updated: toUpdate.length, skipped: skipped.length, issues: parsed.issues.length };
}
