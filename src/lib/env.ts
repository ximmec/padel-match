/** Lee una variable de entorno aceptando también el nombre en minúsculas (ej. setup_key). */
export function env(name: string): string | undefined {
  const v = process.env[name] ?? process.env[name.toLowerCase()];
  return v && v.trim() ? v.trim() : undefined;
}
