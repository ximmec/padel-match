import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/server/auth";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BasicInfoSection, VenueSection, TimingFields, PlayersInfoSection } from "@/components/TournamentFields";
import { FormSection } from "@/components/FormSection";
import { Forbidden } from "@/components/views";
import { updateTournamentAction } from "@/server/actions/admin";
import { normalizeRules } from "@/core/engine";
import { formatLabel } from "@/core/scoring";

export const metadata = { title: "Editar torneo" };

export default async function EditTournament({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const u = await requireUser();
  if (!can(u, "tournaments.manage")) return <Forbidden />;
  const [t] = await sql<{ id: string; name: string; start_date: string; end_date: string; status: string; venue_id: string | null; circuit_id: string | null; season_id: string | null; is_public: boolean; rules_text: string | null; match_duration_min: number; min_rest_min: number }[]>`
    SELECT * FROM tournaments WHERE id = ${id} AND org_id = ${u.orgId}`;
  if (!t) notFound();
  const [venues, circuits, seasons, cats] = await Promise.all([
    sql<{ id: string; name: string }[]>`SELECT id, name FROM venues WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM circuits WHERE org_id = ${u.orgId} ORDER BY name`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM seasons WHERE org_id = ${u.orgId} ORDER BY name DESC`,
    sql<{ id: string; name: string; rules: unknown }[]>`SELECT tc.id, c.name, tc.rules FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = ${id} ORDER BY c.name`,
  ]);
  return (
    <div className="form-page">
      <div className="crumbs"><Link href="/admin/tournaments">Torneos</Link> / <Link href={`/admin/tournaments/${id}`}>{t.name}</Link> /</div>
      <div className="form-eyebrow">Organizador</div>
      <h1 className="form-title">Editar torneo</h1>
      <p className="muted" style={{ marginBottom: 24 }}>Cambiá los datos del torneo. Los cambios se ven al instante en la página pública.</p>
      <ActionForm action={updateTournamentAction}>
        <input type="hidden" name="id" value={id} />
        <BasicInfoSection t={t} circuits={circuits} seasons={seasons} withStatus />
        <VenueSection t={t} venues={venues} />
        <FormSection icon="grid" title="Estructura deportiva" desc="Tiempos para el cronograma. El formato, las zonas y los clasificados se ajustan en cada categoría.">
          <div className="fgrid"><TimingFields t={t} /></div>
          <div className="cat-rules">
            {cats.map((c) => {
              const r = normalizeRules(c.rules as never);
              const q = r.qualification;
              return (
                <Link key={c.id} href={`/admin/tournaments/${id}/c/${c.id}?tab=reglas`}>
                  <b>{c.name}</b>
                  <span className="muted">{formatLabel(r.format)} · zonas de {r.preferredZoneSize} · pasan {q.perZone === "ALL" ? "todas" : q.perZone}{q.bestNext ? ` + ${q.bestNext} mejores` : ""} · <span style={{ color: "var(--orange-hi)" }}>Cambiar reglas →</span></span>
                </Link>
              );
            })}
            {cats.length === 0 && <p className="muted">Este torneo todavía no tiene categorías.</p>}
          </div>
        </FormSection>
        <PlayersInfoSection t={t} />
        <div className="form-actions">
          <Link className="btn ghost pill lg" href={`/admin/tournaments/${id}`}>Cancelar</Link>
          <Submit className="btn primary pill lg">Guardar cambios</Submit>
        </div>
      </ActionForm>
    </div>
  );
}
