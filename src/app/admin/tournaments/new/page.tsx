import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { TournamentFields } from "@/components/TournamentFields";
import { Forbidden } from "@/components/views";
import { createTournamentAction } from "@/server/actions/admin";

export const metadata = { title: "Nuevo torneo" };

export default async function NewTournament() {
  const u = await requireUser();
  if (!can(u, "tournaments.manage")) return <Forbidden />;
  const [venues, circuits, seasons, categories] = await Promise.all([
    sql<{ id: string; name: string }[]>`SELECT id, name FROM venues WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM circuits WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM seasons WHERE org_id = ${u.orgId} ORDER BY name DESC`,
    sql<{ id: string; name: string; gender_rule: string }[]>`SELECT id, name, gender_rule FROM categories WHERE org_id = ${u.orgId} ORDER BY name`,
  ]);
  return (
    <div className="narrow stack" style={{ margin: "0 auto" }}>
      <div className="crumbs"><Link href="/admin/tournaments">Torneos</Link> /</div>
      <h1>Nuevo torneo</h1>
      <div className="card">
        <ActionForm action={createTournamentAction}>
          <TournamentFields venues={venues} circuits={circuits} seasons={seasons} />
          <fieldset>
            <legend>Categorías</legend>
            {categories.length === 0 && <p className="muted">No hay categorías. Creálas en <Link href="/admin/settings">Configuración</Link>.</p>}
            <div className="grid grid-3" style={{ gap: 6 }}>
              {categories.map((c) => <label key={c.id} className="checkbox"><input type="checkbox" name="category_ids" value={c.id} /> {c.name}</label>)}
            </div>
            <div className="hint muted" style={{ fontSize: 12, marginTop: 6 }}>Las reglas (formato, desempates, clasificados y puntos) se ajustan después en cada categoría.</div>
          </fieldset>
          {venues.length === 0 && <div className="alert info">Tip: cargá una sede con sus canchas en <Link href="/admin/settings">Configuración</Link> para poder generar el cronograma.</div>}
          <Submit className="btn primary lg">Crear torneo</Submit>
        </ActionForm>
      </div>
    </div>
  );
}
