import Link from "next/link";
import { Brand } from "@/components/Brand";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <nav className="nav">
            <Link href="/">Torneos</Link>
            <Link href="/buscar">¿Cuándo juego?</Link>
            <Link href="/ranking">Ranking</Link>
          </nav>
          <Link href="/login" className="muted" style={{ color: "#cfd8e6", fontSize: 13 }}>Organizadores</Link>
        </div>
      </header>
      {children}
      <footer className="footer">PADEL MATCH · padel-match.net</footer>
    </>
  );
}
