"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Enlaces de navegación que marcan la sección actual. */
export function NavLinks({ links, exact = [] }: { links: { href: string; label: string; external?: boolean }[]; exact?: string[] }) {
  const path = usePathname() ?? "/";
  const isActive = (href: string) => (exact.includes(href) ? path === href : path === href || path.startsWith(href + "/"));
  return (
    <nav className="nav">
      {links.map((l) => (
        <Link key={l.href} href={l.href} target={l.external ? "_blank" : undefined} className={!l.external && isActive(l.href) ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
