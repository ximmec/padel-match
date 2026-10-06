import Link from "next/link";
import { Brand } from "@/components/Brand";
import { NavLinks } from "@/components/NavLinks";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <NavLinks
            exact={["/"]}
            links={[
              { href: "/", label: "Torneos" },
              { href: "/buscar", label: "¿Cuándo juego?" },
              { href: "/ranking", label: "Ranking" },
            ]}
          />
          <Link href="/login" className="btn ghost sm">Organizadores</Link>
        </div>
      </header>
      {children}
      <footer className="footer">
        <div className="grid grid-3" style={{ maxWidth: 1100, margin: "0 auto 18px", textAlign: "left", gap: 24 }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mark.webp" alt="" /> <b style={{ color: "var(--silver)" }}>PADEL-MATCH</b>
            <p style={{ marginTop: 10 }}>Torneos de pádel con resultados, zonas, cuadros, horarios y ranking en vivo.</p>
          </div>
          <div>
            <b style={{ color: "var(--silver)", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11 }}>Jugadores</b>
            <div className="stack" style={{ marginTop: 10 }}>
              <div><Link href="/">Torneos en curso</Link></div>
              <div><Link href="/buscar">¿Cuándo juego?</Link></div>
              <div><Link href="/ranking">Ranking</Link></div>
            </div>
          </div>
          <div>
            <b style={{ color: "var(--silver)", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11 }}>Organizadores</b>
            <div className="stack" style={{ marginTop: 10 }}>
              <div><Link href="/login">Ingresar al panel</Link></div>
            </div>
          </div>
        </div>
        © {new Date().getFullYear()} PADEL-MATCH.NET
      </footer>
    </>
  );
}
