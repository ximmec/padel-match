import type { MetadataRoute } from "next";

/** App instalable (PWA): «Agregar a pantalla de inicio» abre directo en Mi Padel Match. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PADEL MATCH",
    short_name: "Padel Match",
    description: "Tus torneos, partidos y avisos de pádel.",
    id: "/jugadores",
    start_url: "/jugadores",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050505",
    theme_color: "#050505",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
