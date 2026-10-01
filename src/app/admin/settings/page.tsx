import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import * as A from "@/server/actions/admin";
import { changePasswordAction } from "@/server/actions/auth";
import { PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, effectivePermissions, type Role, type PermissionOverrides } from "@/server/permissions";

export const metadata = { title: "Configuración" };

const RULE_LABEL: Record<string, string> = { MALE: "Masculina", FEMALE: "Femenina", MIXED: "Mixta", OPEN: "Libre / personalizada" };

export default async function SettingsPage() {
  const u = await requireUser();
  const settings = can(u, "settings.manage");
  const [categories, circuits, seasons, venues, courts, users] = await Promise.all([
    sql<{ id: string; name: string; gender_rule: string }[]>`SELECT id, name, gender_rule FROM categories WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM circuits WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM seasons WHERE org_id = ${u.orgId} ORDER BY name DESC`,
    sql<{ id: string; name: string; address: string | null }[]>`SELECT id, name, address FROM venues WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; venue_id: string; name: string; active: boolean }[]>`SELECT c.id, c.venue_id, c.name, c.active FROM courts c JOIN venues v ON v.id = c.venue_id WHERE v.org_id = ${u.orgId} ORDER BY c.sort, c.name`,
    can(u, "users.manage")
      ? sql<{ id: string; name: string; email: string; active: boolean; role: Role; permissions: PermissionOverrides }[]>`
          SELECT u.id, u.name, u.email, u.active, m.role, m.permissions FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.org_id = ${u.orgId} ORDER BY u.name`
      : Promise.resolve([]),
  ]);

  return (
    <div className="stack">
      <h1>Configuración</h1>
      {settings && (
        <div className="grid grid-2">
          <div className="card">
            <h2>Categorías</h2>
            <table><tbody>{categories.map((c) => <tr key={c.id}><td>{c.name}</td><td className="muted">{RULE_LABEL[c.gender_rule]}</td></tr>)}</tbody></table>
            <ActionForm action={A.createCategoryAction} resetOnSuccess className="row" >
              <input name="name" placeholder="Ej. 5ta Masculina" required style={{ flex: 1, minWidth: 160 }} />
              <select name="gender_rule" className="sm">{Object.entries(RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <Submit className="btn sm">Agregar</Submit>
            </ActionForm>
          </div>

          <div className="card">
            <h2>Sedes y canchas</h2>
            {venues.map((v) => (
              <div key={v.id} style={{ marginBottom: 12 }}>
                <b>{v.name}</b> <span className="muted">{v.address}</span>
                <div className="row" style={{ marginTop: 6 }}>
                  {courts.filter((c) => c.venue_id === v.id).map((c) => (
                    <ActionForm key={c.id} action={A.toggleCourtAction} hideSuccess>
                      <input type="hidden" name="id" value={c.id} />
                      <button className={`badge ${c.active ? "ok" : ""}`} style={{ border: "none", cursor: "pointer" }} title={c.active ? "Desactivar" : "Activar"}>{c.name}{c.active ? "" : " (inactiva)"}</button>
                    </ActionForm>
                  ))}
                </div>
                <ActionForm action={A.addCourtAction} resetOnSuccess className="row">
                  <input type="hidden" name="venue_id" value={v.id} />
                  <input name="name" className="sm" placeholder="Nombre de cancha" required />
                  <Submit className="btn ghost sm">+ Cancha</Submit>
                </ActionForm>
              </div>
            ))}
            <ActionForm action={A.createVenueAction} resetOnSuccess>
              <div className="grid grid-3" style={{ gap: 8 }}>
                <input name="name" placeholder="Nombre de la sede" required />
                <input name="address" placeholder="Dirección" />
                <input name="courts" type="number" min={0} max={40} placeholder="Cant. de canchas" />
              </div>
              <div style={{ marginTop: 8 }}><Submit className="btn sm">+ Nueva sede</Submit></div>
            </ActionForm>
          </div>

          <div className="card">
            <h2>Circuitos</h2>
            <p>{circuits.map((c) => c.name).join(" · ") || <span className="muted">Ninguno</span>}</p>
            <ActionForm action={A.createSimpleAction} resetOnSuccess className="row">
              <input type="hidden" name="kind" value="circuits" />
              <input name="name" className="sm" placeholder="Nombre del circuito" required />
              <Submit className="btn sm">Agregar</Submit>
            </ActionForm>
          </div>

          <div className="card">
            <h2>Temporadas</h2>
            <p>{seasons.map((c) => c.name).join(" · ") || <span className="muted">Ninguna</span>}</p>
            <ActionForm action={A.createSimpleAction} resetOnSuccess className="row">
              <input type="hidden" name="kind" value="seasons" />
              <input name="name" className="sm" placeholder="Ej. 2027" required />
              <Submit className="btn sm">Agregar</Submit>
            </ActionForm>
          </div>
        </div>
      )}

      {can(u, "users.manage") && (
        <div className="card">
          <h2>Usuarios y permisos</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Usuario</th><th>Rol y permisos</th></tr></thead>
            <tbody>
              {users.map((x) => {
                const eff = effectivePermissions(x.role, x.permissions);
                return (
                  <tr key={x.id}>
                    <td style={{ verticalAlign: "top" }}><b>{x.name}</b><div className="muted" style={{ fontSize: 12 }}>{x.email}</div>{!x.active && <span className="badge err">Inactivo</span>}</td>
                    <td>
                      <details>
                        <summary>{ROLE_LABELS[x.role]} · {eff.size} permisos</summary>
                        <ActionForm action={A.updateMembershipAction}>
                          <input type="hidden" name="user_id" value={x.id} />
                          <div className="row" style={{ margin: "8px 0" }}>
                            <select name="role" className="sm" defaultValue={x.role}>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                            {x.id !== u.id && <label className="checkbox"><input type="checkbox" name="active" defaultChecked={x.active} /> Activo</label>}
                            {x.id !== u.id && <input type="hidden" name="active" value="" />}
                          </div>
                          <div className="grid grid-2" style={{ gap: 4 }}>
                            {PERMISSIONS.map((p) => (
                              <div key={p} className="row" style={{ fontSize: 13 }}>
                                <span className={`dot ${eff.has(p) ? "ok" : "idle"}`} />
                                <span style={{ flex: 1 }}>{PERMISSION_LABELS[p]}</span>
                                <label className="checkbox" style={{ fontSize: 12 }}><input type="checkbox" name="grant" value={p} defaultChecked={x.permissions?.grant?.includes(p)} /> dar</label>
                                <label className="checkbox" style={{ fontSize: 12 }}><input type="checkbox" name="revoke" value={p} defaultChecked={x.permissions?.revoke?.includes(p)} /> quitar</label>
                              </div>
                            ))}
                          </div>
                          <p className="muted" style={{ fontSize: 12 }}>Cada rol trae permisos por defecto; con «dar» y «quitar» se ajustan para este usuario.</p>
                          <Submit className="btn sm">Guardar</Submit>
                        </ActionForm>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <h3 style={{ marginTop: 16 }}>Nuevo usuario</h3>
          <ActionForm action={A.createUserAction} resetOnSuccess>
            <div className="grid grid-4" style={{ gap: 8 }}>
              <input name="name" placeholder="Nombre" required />
              <input name="email" type="email" placeholder="Email" required />
              <input name="password" type="password" placeholder="Contraseña inicial" required minLength={10} autoComplete="new-password" />
              <select name="role" defaultValue="RESULTS_OPERATOR">{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div style={{ marginTop: 8 }}><Submit className="btn sm">Crear usuario</Submit></div>
          </ActionForm>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h2>Mi contraseña</h2>
          <ActionForm action={changePasswordAction} resetOnSuccess>
            <div className="field"><label>Actual</label><input type="password" name="current" required autoComplete="current-password" /></div>
            <div className="field"><label>Nueva</label><input type="password" name="next" required minLength={10} autoComplete="new-password" /></div>
            <Submit className="btn sm">Cambiar contraseña</Submit>
          </ActionForm>
        </div>
        {u.isSuperadmin && (
          <div className="card">
            <h2>Organizadores</h2>
            <p className="muted" style={{ fontSize: 13 }}>Cada organizador tiene sus propios torneos, jugadores, ranking y usuarios, separados del resto.</p>
            <ActionForm action={A.createOrgAction} resetOnSuccess className="row">
              <input name="name" className="sm" placeholder="Nombre del organizador" required />
              <Submit className="btn sm">Crear</Submit>
            </ActionForm>
          </div>
        )}
      </div>
    </div>
  );
}
