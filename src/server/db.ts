import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __pmSql: ReturnType<typeof create> | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable DATABASE_URL.");
  return postgres(url, {
    max: process.env.VERCEL ? 3 : 10,
    idle_timeout: 20,
    connect_timeout: 15,
    // Compatible con el pooler de Neon / pgbouncer
    prepare: false,
    onnotice: () => {},
    transform: { undefined: null },
    // Las columnas DATE se manejan como texto "YYYY-MM-DD" para evitar corrimientos de zona horaria.
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

/** Cliente SQL compartido (una instancia por proceso). */
function getSql() {
  return globalThis.__pmSql ?? (globalThis.__pmSql = create());
}

/** Se conecta recién en el primer uso (así el build no necesita base de datos). */
export const sql: ReturnType<typeof create> = new Proxy(function () {} as unknown as ReturnType<typeof create>, {
  apply: (_t, _this, args: unknown[]) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const real = getSql() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = postgres.TransactionSql<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = postgres.Sql<any> | postgres.TransactionSql<any>;

/** Error con mensaje apto para mostrar al usuario. */
export class UserError extends Error {}

/** Traduce errores de restricciones de Postgres a mensajes comprensibles. */
export function friendlyDbError(e: unknown): string {
  const err = e as { code?: string; constraint_name?: string; message?: string };
  if (e instanceof UserError) return e.message;
  if (err?.code === "23505") {
    switch (err.constraint_name) {
      case "entry_players_unique_active": return "Ese jugador ya está inscripto en esta categoría del torneo.";
      case "players_document_uq": return "Ya existe un jugador con ese documento.";
      case "tournaments_slug_key": return "Ya existe un torneo con ese nombre corto (slug).";
      case "categories_org_id_name_key": return "Ya existe una categoría con ese nombre.";
      case "tournament_categories_tournament_id_category_id_key": return "Esa categoría ya está en el torneo.";
      case "users_email_key": return "Ya existe un usuario con ese email.";
      default: return "Ya existe un registro con esos datos.";
    }
  }
  if (err?.code === "23503") return "No se puede completar: hay datos relacionados que lo impiden.";
  if (err?.code === "23514") return "Algún dato no cumple las reglas permitidas.";
  if (err?.code === "40001") return "Otra persona modificó estos datos al mismo tiempo. Volvé a intentar.";
  console.error(e);
  return "Ocurrió un error inesperado. Volvé a intentar.";
}
