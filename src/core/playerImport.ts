/**
 * Interpretación de planillas de jugadores (Excel/CSV) para importarlos en bloque.
 * Lógica pura: recibe las celdas como texto y devuelve jugadores normalizados y errores.
 */

export type Gender = "M" | "F" | "X";

export interface ImportedPlayer {
  row: number; // número de fila en la planilla (1 = primera)
  first_name: string;
  last_name: string;
  gender: Gender;
  document: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  category: string | null;
}

export interface ImportIssue { row: number; message: string }

export interface ImportResult {
  players: ImportedPlayer[];
  issues: ImportIssue[];
  /** Columnas reconocidas, para mostrar al usuario. */
  columns: string[];
  headerRow: number;
}

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

type Field = "first_name" | "last_name" | "full_first" | "full_last" | "gender" | "document" | "phone" | "email" | "city" | "category";

/** Reconoce el encabezado de una columna. */
export function detectField(header: string): Field | null {
  const h = fold(header).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!h) return null;
  if (/^(apellido y nombres?|apellidos? y nombres?|apellido nombre)$/.test(h)) return "full_last";
  if (/^(nombre y apellidos?|nombres? y apellidos?|nombre completo|jugador|jugadora|participante|nombre apellido)$/.test(h)) return "full_first";
  if (/^apellidos?$/.test(h)) return "last_name";
  if (/^(nombres?|first name|primer nombre)$/.test(h)) return "first_name";
  if (/^(genero|sexo|rama|masc fem|m f)$/.test(h)) return "gender";
  if (/^(dni|d n i|documento|doc|nro documento|numero de documento|n documento|cuit|cuil|dni nro)$/.test(h)) return "document";
  if (/(telefono|celular|cel|tel|whatsapp|movil)/.test(h)) return "phone";
  if (/(e ?mail|correo)/.test(h)) return "email";
  if (/^(ciudad|localidad|zona|barrio)$/.test(h)) return "city";
  if (/^(categoria|cat|nivel|division|categoria del jugador)$/.test(h)) return "category";
  return null;
}

export function parseGender(v: string): Gender | null {
  const g = fold(v);
  if (!g) return null;
  if (/^(m|h|masc|masculino|hombre|varon|caballero|v)$/.test(g)) return "M";
  if (/^(f|fem|femenino|mujer|dama|d)$/.test(g)) return "F";
  if (/^(x|otro|otra|no binario|nb)$/.test(g)) return "X";
  return null;
}

/** "Juan Pablo Pérez" → { first: "Juan Pablo", last: "Pérez" }; "Pérez, Juan" → { first: "Juan", last: "Pérez" } */
export function splitFullName(v: string, lastFirst: boolean): { first: string; last: string } | null {
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    return first && last ? { first, last } : null;
  }
  const parts = s.split(" ");
  if (parts.length < 2) return null;
  return lastFirst
    ? { last: parts[0], first: parts.slice(1).join(" ") }
    : { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** Si el texto viene todo en MAYÚSCULAS o minúsculas, lo pasa a "Nombre Propio". */
function niceName(s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  return t === t.toUpperCase() || t === t.toLowerCase() ? titleCase(t) : t;
}

const FIELD_LABELS: Record<Field, string> = {
  first_name: "Nombre", last_name: "Apellido", full_first: "Nombre y apellido", full_last: "Apellido y nombre",
  gender: "Género", document: "Documento", phone: "Teléfono", email: "Email", city: "Ciudad", category: "Categoría",
};

/**
 * @param rows celdas como texto, fila por fila
 * @param defaultGender género a usar si la planilla no tiene esa columna (o la celda está vacía)
 */
export function parsePlayerSheet(rows: string[][], defaultGender: Gender | null): ImportResult {
  // Buscar la fila de encabezados entre las primeras 10
  let headerRow = -1;
  let map: (Field | null)[] = [];
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const m = rows[i].map((c) => detectField(String(c ?? "")));
    const has = (f: Field) => m.includes(f);
    if ((has("first_name") && has("last_name")) || has("full_first") || has("full_last")) {
      headerRow = i;
      map = m;
      break;
    }
  }
  if (headerRow === -1) {
    return {
      players: [], columns: [], headerRow: -1,
      issues: [{ row: 0, message: "No encontré las columnas de nombre. La primera fila debe tener títulos como «Nombre» y «Apellido» (o «Nombre y apellido»)." }],
    };
  }
  const col = (f: Field) => map.indexOf(f);
  const issues: ImportIssue[] = [];
  const players: ImportedPlayer[] = [];
  const seen = new Map<string, number>();

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c ?? "").trim());
    if (r.every((c) => c === "")) continue;
    const rowNo = i + 1;
    const cell = (f: Field) => (col(f) >= 0 ? r[col(f)] ?? "" : "");

    let first = cell("first_name"), last = cell("last_name");
    if ((!first || !last) && (col("full_first") >= 0 || col("full_last") >= 0)) {
      const full = col("full_first") >= 0 ? splitFullName(cell("full_first"), false) : splitFullName(cell("full_last"), true);
      if (full) { first = first || full.first; last = last || full.last; }
    }
    if (!first || !last) { issues.push({ row: rowNo, message: "Falta el nombre o el apellido." }); continue; }

    const g = parseGender(cell("gender")) ?? defaultGender;
    if (!g) { issues.push({ row: rowNo, message: `No se reconoce el género «${cell("gender") || "vacío"}». Usá M o F, o elegí un género para todos.` }); continue; }

    const docRaw = cell("document").replace(/[.\s-]/g, "");
    const document = docRaw ? docRaw.slice(0, 20) : null;
    const emailRaw = cell("email");
    const email = emailRaw && /^\S+@\S+\.\S+$/.test(emailRaw) ? emailRaw.toLowerCase().slice(0, 120) : null;
    if (emailRaw && !email) issues.push({ row: rowNo, message: `Email inválido «${emailRaw}» (se importa sin email).` });

    const p: ImportedPlayer = {
      row: rowNo,
      first_name: niceName(first).slice(0, 60),
      last_name: niceName(last).slice(0, 60),
      gender: g,
      document,
      phone: cell("phone").slice(0, 30) || null,
      email,
      city: cell("city") ? niceName(cell("city")).slice(0, 60) : null,
      category: cell("category") ? cell("category").replace(/\s+/g, " ").trim().slice(0, 40) : null,
    };
    const key = document ? `doc:${document}` : `name:${fold(p.first_name)}|${fold(p.last_name)}`;
    if (seen.has(key)) { issues.push({ row: rowNo, message: `Repetido en la planilla (igual a la fila ${seen.get(key)}).` }); continue; }
    seen.set(key, rowNo);
    players.push(p);
  }
  const columns = [...new Set(map.filter((f): f is Field => !!f).map((f) => FIELD_LABELS[f]))];
  return { players, issues, columns, headerRow: headerRow + 1 };
}
