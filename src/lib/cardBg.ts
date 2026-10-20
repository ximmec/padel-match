export const CARD_BACKGROUNDS: [string, string, string | null][] = [
  ["cancha", "Cancha al atardecer", "/login-cancha.webp"],
  ["mapa", "Mapamundi", "/hero-mapa.webp"],
  ["ninguno", "Sin imagen", null],
];

export function cardBgUrl(key: string | null | undefined): string | null {
  return (CARD_BACKGROUNDS.find((b) => b[0] === key) ?? CARD_BACKGROUNDS[0])[2];
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$ " + n.toLocaleString("es-AR");
}
