export type Role = "ADMIN" | "ORGANIZER" | "RESULTS_OPERATOR";

export const PERMISSIONS = [
  "tournaments.manage",
  "players.manage",
  "results.enter",
  "schedule.manage",
  "ranking.adjust",
  "exports.download",
  "audit.view",
  "users.manage",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "tournaments.manage": "Crear y modificar torneos, zonas y cuadros",
  "players.manage": "Gestionar jugadores e inscripciones",
  "results.enter": "Cargar y corregir resultados",
  "schedule.manage": "Modificar cronograma, canchas y horarios",
  "ranking.adjust": "Ajustes manuales de ranking",
  "exports.download": "Exportar a Excel",
  "audit.view": "Ver historial de auditoría",
  "users.manage": "Gestionar usuarios y permisos",
  "settings.manage": "Configurar categorías, sedes, circuitos y temporadas",
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador general",
  ORGANIZER: "Organizador",
  RESULTS_OPERATOR: "Operador de resultados",
};

const ROLE_PERMS: Record<Role, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  ORGANIZER: ["tournaments.manage", "players.manage", "results.enter", "schedule.manage", "ranking.adjust", "exports.download", "audit.view", "settings.manage"],
  RESULTS_OPERATOR: ["results.enter"],
};

export interface PermissionOverrides { grant?: Permission[]; revoke?: Permission[] }

export function effectivePermissions(role: Role, overrides: PermissionOverrides | null | undefined, superadmin = false): Set<Permission> {
  if (superadmin) return new Set(PERMISSIONS);
  const set = new Set<Permission>(ROLE_PERMS[role] ?? []);
  for (const p of overrides?.grant ?? []) if ((PERMISSIONS as readonly string[]).includes(p)) set.add(p);
  for (const p of overrides?.revoke ?? []) set.delete(p);
  return set;
}
