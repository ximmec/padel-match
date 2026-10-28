import { env } from "@/lib/env";
import type { Metadata, Viewport } from "next";
import { Barlow, Exo_2, Outfit } from "next/font/google";
import "./globals.css";
import { getLang } from "@/i18n/server";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const hero = Outfit({ subsets: ["latin"], weight: ["600", "700", "800", "900"], variable: "--font-hero", display: "swap" });
const display = Exo_2({ subsets: ["latin"], weight: ["700", "800", "900"], style: ["italic", "normal"], variable: "--font-display", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(env("APP_URL") || "https://padel-match.net"),
  title: { default: "PADEL MATCH", template: "%s · PADEL MATCH" },
  description: "Torneos de pádel: zonas, resultados, cuadros, horarios y ranking en tiempo real.",
  applicationName: "PADEL MATCH",
  appleWebApp: { capable: true, title: "BlokoPadel", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${body.variable} ${display.variable} ${hero.variable}`}>
      <body>{children}</body>
    </html>
  );
}
