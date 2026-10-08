"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type NavItem = { href: string; label: string; icon: string };

/** Estructura del panel: barra superior, menú lateral (cajón en celular) y contenido. */
export function AdminShell({ brand, userMenu, sections, children }: {
  brand: React.ReactNode; userMenu: React.ReactNode; sections: { title?: string; items: NavItem[] }[]; children: React.ReactNode;
}) {
  const path = usePathname() ?? "/admin";
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  const active = (href: string) => (href === "/admin" ? path === href : path === href || path.startsWith(href + "/"));
  return (
    <div className={`admin ${open ? "menu-open" : ""}`}>
      <header className="admin-top">
        <button type="button" className="menu-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open}>
          <Icon name={open ? "x" : "menu"} size={22} />
        </button>
        {brand}
        <div className="spacer" />
        {userMenu}
      </header>
      <aside className="admin-side" aria-label="Menú del panel">
        <nav>
          {sections.map((s, i) => (
            <div key={i} className="side-section">
              {s.title && <div className="side-title">{s.title}</div>}
              {s.items.map((l) => (
                <Link key={l.href} href={l.href} className={active(l.href) ? "active" : ""}>
                  <Icon name={l.icon} /> <span>{l.label}</span>
                </Link>
              ))}
            </div>
          ))}
          <div className="side-section">
            <Link href="/" target="_blank" className="side-public"><Icon name="external" /> <span>Vista pública</span></Link>
          </div>
        </nav>
      </aside>
      <div className="admin-scrim" onClick={() => setOpen(false)} aria-hidden />
      <main className="admin-main">{children}</main>
    </div>
  );
}
