import type { Metadata, Viewport } from "next";
import { Barlow, Exo_2 } from "next/font/google";
import "./globals.css";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const display = Exo_2({ subsets: ["latin"], weight: ["700", "800", "900"], style: ["italic", "normal"], variable: "--font-display", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://padel-match.net"),
  title: { default: "PADEL MATCH", template: "%s · PADEL MATCH" },
  description: "Torneos de pádel: zonas, resultados, cuadros, horarios y ranking en tiempo real.",
  applicationName: "PADEL MATCH",
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
