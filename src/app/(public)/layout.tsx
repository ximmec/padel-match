import Link from "next/link";
import { Brand } from "@/components/Brand";
import { NavLinks } from "@/components/NavLinks";
import { LangSwitch } from "@/components/LangSwitch";
import { LangProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { lang, t } = await getT();
  return (
    <LangProvider lang={lang}>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <NavLinks
            exact={["/"]}
            links={[
              { href: "/", label: t.nav.tournaments },
              { href: "/buscar", label: t.nav.when },
              { href: "/ranking", label: t.nav.ranking },
              { href: "/jugadores", label: t.nav.me },
            ]}
          />
          <div className="top-cta">
            <LangSwitch />
            <Link href="/login" className="top-login">{t.nav.login}</Link>
            <Link href="/login" className="btn primary pill">{t.nav.create}</Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="footer">
        <div className="grid grid-3" style={{ maxWidth: 1100, margin: "0 auto 18px", textAlign: "left", gap: 24 }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mark.webp" alt="" /> <b style={{ color: "var(--silver)" }}>PADEL-MATCH</b>
            <p style={{ marginTop: 10 }}>{t.footer.about}</p>
          </div>
          <div>
            <b style={{ color: "var(--silver)", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11 }}>{t.footer.players}</b>
            <div className="stack" style={{ marginTop: 10 }}>
              <div><Link href="/">{t.footer.live}</Link></div>
              <div><Link href="/buscar">{t.nav.when}</Link></div>
              <div><Link href="/ranking">{t.nav.ranking}</Link></div>
              <div><Link href="/jugadores">{t.footer.meLink}</Link></div>
            </div>
          </div>
          <div>
            <b style={{ color: "var(--silver)", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11 }}>{t.footer.organizers}</b>
            <div className="stack" style={{ marginTop: 10 }}>
              <div><Link href="/login">{t.footer.panel}</Link></div>
            </div>
          </div>
        </div>
        © {new Date().getFullYear()} PADEL-MATCH.NET
      </footer>
    </LangProvider>
  );
}
