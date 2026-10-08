import Link from "next/link";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BasicInfoSection, VenueSection, TimingFields, PlayersInfoSection } from "@/components/TournamentFields";
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
        <BasicInfoSection circuits={circuits} seasons={seasons}>
          <div className="field" style={{ marginTop: 6, marginBottom: 0 }}>
            <label>Categorías *</label>
            {categories.length === 0
              ? <p className="muted">No hay categorías. Creálas en <Link href="/admin/settings">Configuración</Link>.</p>
              : <div className="chip-checks">{categories.map((c) => <label key={c.id}><input type="checkbox" name="category_ids" value={c.id} /> {c.name}</label>)}</div>}
            <div className="hint">Podés elegir varias. Cada una tiene sus propias zonas y cuadro.</div>
          </div>
        </BasicInfoSection>
        <VenueSection venues={venues} />
        <FormSection icon="grid" title="Estructura deportiva" desc="Definí cómo se va a jugar para preparar zonas y playoffs. Se aplica a todas las categorías elegidas y después podés ajustarla en cada una.">
          <StructureFields>
            <TimingFields />
          </StructureFields>
        </FormSection>
        <PlayersInfoSection />
        <div className="form-actions">
          <Link className="btn ghost pill lg" href="/admin/tournaments">Cancelar</Link>
          <Submit className="btn primary pill lg">Crear torneo</Submit>
        </div>
      </ActionForm>
    </div>
  );
}
