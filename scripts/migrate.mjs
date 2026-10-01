// Aplica las migraciones SQL pendientes de db/migrations en orden.
// Se ejecuta automáticamente en cada build de Vercel (npm run build).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  if (process.env.VERCEL || process.env.CI_REQUIRE_DB) {
    console.error("Falta DATABASE_URL. Configurala en Vercel → Settings → Environment Variables.");
    process.exit(1);
  }
  console.warn("DATABASE_URL no está definida: se omiten las migraciones.");
  process.exit(0);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = path.join(process.cwd(), "db", "migrations");

try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  // Evita que dos builds simultáneos migren a la vez
  await sql`SELECT pg_advisory_lock(727274)`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const body = await readFile(path.join(dir, f), "utf8");
    console.log(`→ aplicando ${f}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
    });
  }
  console.log("Migraciones al día.");
} catch (e) {
  console.error("Error en migraciones:", e.message);
  process.exitCode = 1;
} finally {
  await sql`SELECT pg_advisory_unlock(727274)`.catch(() => {});
  await sql.end();
}
