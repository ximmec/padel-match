import { redirect } from "next/navigation";

/** Enlace corto para compartir: padel-match.net/app → instalar la app. */
export default function AppShortcut() {
  redirect("/jugadores?instalar=1");
}
