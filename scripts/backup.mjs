// Copia de seguridad lógica de la base: exporta todas las tablas a un archivo JSON comprimido.
// Uso: DATABASE_URL=... node scripts/backup.mjs  → backups/padel-match-AAAA-MM-DD-HHMM.json.gz
// (Complementa los backups automáticos de Neon; ver README, sección "Copias de seguridad".)
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false });
const TABLES = [
  "organizations", "users", "memberships", "players", "circuits", "seasons", "categories", "venues", "courts",
  "tournaments", "court_availability", "tournament_categories", "entries", "entry_players", "zones", "zone_entries",
  "matches", "match_result_versions", "ranking_ledger", "audit_log", "schema_migrations",
];
try {
  const dump = { createdAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) dump.tables[t] = await sql`SELECT * FROM ${sql(t)}`;
  const dir = path.join(process.cwd(), "backups");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = path.join(dir, `padel-match-${stamp}.json.gz`);
  await writeFile(file, gzipSync(JSON.stringify(dump)));
  console.log(`Copia guardada en ${file}`);
} finally {
  await sql.end();
}
