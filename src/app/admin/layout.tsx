import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { logoutAction, switchOrgAction } from "@/server/actions/auth";
import { Brand } from "@/components/Brand";
import { ROLE_LABELS } from "@/server/permissions";

export const metadata = { title: "Administración", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const links: [string, string, boolean][] = [
    ["/admin", "Inicio", true],
    ["/admin/results", "Resultados", can(u, "results.enter")],
    ["/admin/tournaments", "Torneos", true],
    ["/admin/players", "Jugadores", true],
    ["/admin/ranking", "Ranking", true],
    ["/admin/audit", "Auditoría", can(u, "audit.view")],
    ["/admin/settings", "Configuración", can(u, "settings.manage") || can(u, "users.manage")],
  ];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand href="/admin" />
          <nav className="nav">
            {links.filter((l) => l[2]).map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
            <Link href="/" target="_blank">Vista pública ↗</Link>
          </nav>
          <div className="user">
            {u.orgs.length > 1 ? (
              <form action={switchOrgAction} className="row">
                <select name="orgId" defaultValue={u.orgId} aria-label="Organizador">
                  {u.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button className="btn sm ghost" style={{ color: "#fff", borderColor: "#2a4675" }}>Cambiar</button>
              </form>
            ) : <span>{u.orgName}</span>}
            <span title={ROLE_LABELS[u.role]}>· {u.name}</span>
            <form action={logoutAction}><button className="btn sm ghost" style={{ color: "#fff", borderColor: "#2a4675" }}>Salir</button></form>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
