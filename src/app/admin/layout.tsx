import { requireUser, can } from "@/server/auth";
import { logoutAction, switchOrgAction } from "@/server/actions/auth";
import { Brand } from "@/components/Brand";
import { AdminShell } from "@/components/AdminShell";
import { Icon } from "@/components/Icon";
import { ROLE_LABELS } from "@/server/permissions";

export const metadata = { title: "Administración", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const main = [
    { href: "/admin", label: "Inicio", icon: "home", show: true },
    { href: "/admin/results", label: "Cargar resultados", icon: "bolt", show: can(u, "results.enter") },
    { href: "/admin/tournaments", label: "Torneos", icon: "trophy", show: true },
    { href: "/admin/players", label: "Jugadores", icon: "users", show: true },
    { href: "/admin/ranking", label: "Ranking", icon: "chart", show: true },
  ];
  const org = [
    { href: "/admin/audit", label: "Auditoría", icon: "list", show: can(u, "audit.view") },
    { href: "/admin/settings", label: "Configuración", icon: "gear", show: can(u, "settings.manage") || can(u, "users.manage") },
  ];
  const strip = (l: typeof main) => l.filter((x) => x.show).map(({ href, label, icon }) => ({ href, label, icon }));
  const sections = [{ items: strip(main) }, { title: "Organizador", items: strip(org) }].filter((s) => s.items.length);

  const userMenu = (
    <details className="user-menu">
      <summary>
        <span className="avatar">{u.name.trim().charAt(0).toUpperCase()}</span>
        <span className="who"><b>{u.name}</b><small>{ROLE_LABELS[u.role]}</small></span>
        <Icon name="chevron" size={18} />
      </summary>
      <div className="user-pop">
        <div className="user-pop-head"><b>{u.orgName}</b><small>{u.email}</small></div>
        {u.orgs.length > 1 && (
          <form action={switchOrgAction} className="row" style={{ padding: "8px 14px" }}>
            <select name="orgId" defaultValue={u.orgId} aria-label="Organizador" style={{ flex: 1 }}>
              {u.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="btn sm ghost">Cambiar</button>
          </form>
        )}
        <a href="/" target="_blank"><Icon name="external" size={18} /> Vista pública</a>
        <form action={logoutAction}><button><Icon name="out" size={18} /> Salir</button></form>
      </div>
    </details>
  );

  return (
    <AdminShell brand={<Brand href="/admin" tld={false} />} userMenu={userMenu} sections={sections}>
      <div className="container">{children}</div>
    </AdminShell>
  );
}
