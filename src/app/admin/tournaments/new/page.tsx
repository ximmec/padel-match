import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BasicInfoSection, VenueSection, TimingFields, DescriptionSection, CardSection } from "@/components/TournamentFields";
import { CategoryBuilder } from "@/components/CategoryBuilder";
import { StructureFields } from "@/components/StructureFields";
import { FormSection } from "@/components/FormSection";
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
    <div className="form-page">
      <div className="crumbs"><Link href="/admin/tournaments">Torneos</Link> /</div>
      <div className="form-eyebrow">Organizador</div>
      <h1 className="form-title">Nuevo torneo</h1>
      <p className="muted" style={{ marginBottom: 24 }}>Completá los datos básicos, elegí la sede y definí cómo se va a jugar.</p>
      <ActionForm action={createTournamentAction}>
        <BasicInfoSection circuits={circuits} seasons={seasons} categories={
          <>
            <label>Categorías *</label>
            {categories.length > 0 && <div className="chip-checks">{categories.map((c) => <label key={c.id}><input type="checkbox" name="category_ids" value={c.id} /> {c.name}</label>)}</div>}
            <CategoryBuilder />
          </>
        } />
        <VenueSection venues={venues} />
        <FormSection icon="grid" title="Estructura deportiva" desc="Definí cómo se va a jugar el torneo para preparar zonas y playoffs. Se aplica a todas las categorías elegidas.">
          <StructureFields>
            <div className="field"><label htmlFor="s-courts">Cantidad de canchas</label><input id="s-courts" type="number" name="courts_count" min={1} max={40} placeholder="Todas las de la sede" />
              <div className="hint">Se habilitan para el cronograma desde el horario de inicio.</div></div>
            <TimingFields />
          </StructureFields>
        </FormSection>
        <DescriptionSection />
        <CardSection />
        <div className="form-actions">
          <Link className="btn ghost pill lg" href="/admin/tournaments">Cancelar</Link>
          <Submit className="btn primary pill lg">Crear torneo</Submit>
        </div>
      </ActionForm>
    </div>
  );
}
