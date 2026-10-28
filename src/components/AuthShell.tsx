import Link from "next/link";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { LangSwitch } from "@/components/LangSwitch";
import { LangProvider } from "@/i18n/client";
import { dict, type Lang } from "@/i18n";

/** Pantalla dividida para ingresar / configurar: formulario a la izquierda, foto a la derecha. */
export function AuthShell({ children, lang, langSwitch = false }: { children: React.ReactNode; lang?: Lang; langSwitch?: boolean }) {
  const t = dict(lang).auth;
  return (
    <LangProvider lang={lang ?? "es"}>
    <div className="auth">
      <div className="auth-bg" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <picture><source media="(max-width: 1000px)" srcSet="/login-cancha-m.webp" /><img src="/login-cancha.webp" alt="" /></picture>
      </div>
      <header className="auth-top">
        <Brand />
        {langSwitch && <LangSwitch />}
        <Link href="/" className="btn ghost sm auth-pill">{dict(lang).nav.seeTournaments}</Link>
      </header>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
        <div className="auth-tagline">
          <div className="hero-kicker">{t.tagKicker}</div>
          <h2>{t.tag1}<span>{t.tag2}</span></h2>
          <p>{t.tagText}</p>
          <ul className="auth-feats">
            {t.feats.map(([icon, title, text]) => (
              <li key={title}><span className="quick-ico"><Icon name={icon} size={20} /></span><span><b>{title}</b><small>{text}</small></span></li>
            ))}
          </ul>
        </div>
      </main>
    </div>
    </LangProvider>
  );
}

const icons = {
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8m-3 3 2 2" /></>,
  home: <path d="M4 20V10l8-6 8 6v10h-5v-6H9v6Z" />,
  id: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
};

export function FieldIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg className="field-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icons[name]}
    </svg>
  );
}
