import { VenueSelect } from "@/components/VenueSelect";
import { FormSection } from "@/components/FormSection";
import { DateFields } from "@/components/DateFields";
import { CardPublisher } from "@/components/CardPublisher";

type Opt = { id: string; name: string };
export type TournamentData = {
  name?: string; start_date?: string; end_date?: string; start_time?: string | null; entry_fee?: number | null; max_entries?: number | null;
  logo?: string | null; card_bg?: string | null;
  venue_id?: string | null; circuit_id?: string | null; season_id?: string | null; is_public?: boolean; rules_text?: string | null;
  match_duration_min?: number; min_rest_min?: number; status?: string;
};

export function BasicInfoSection({ t = {}, circuits, seasons, withStatus = false, categories }: { t?: TournamentData; circuits: Opt[]; seasons: Opt[]; withStatus?: boolean; categories?: React.ReactNode }) {
  return (
    <FormSection icon="info" title="Información básica" desc="Título, categoría, fechas y datos generales del torneo.">
      <div className="fgrid">
        <div className="field"><label htmlFor="t-name">Título *</label><input id="t-name" name="name" defaultValue={t.name} required minLength={3} maxLength={100} placeholder="Ej: Master Final 2026" /></div>
        <div className="field">{categories ?? (
          <>
            <label htmlFor="t-status">Estado</label>
            {withStatus && (
              <select id="t-status" name="status" defaultValue={t.status}>
                <option value="DRAFT">Borrador (no visible)</option><option value="OPEN">Inscripción abierta</option>
                <option value="IN_PROGRESS">En curso</option><option value="FINISHED">Finalizado</option><option value="CANCELLED">Cancelado</option>
              </select>
            )}
          </>
        )}</div>
      </div>
      <DateFields start={t.start_date} end={t.end_date} time={t.start_time} fee={t.entry_fee} />
      <div className="fgrid" style={{ marginTop: 14 }}>
        <div className="field"><label htmlFor="t-circuit">Circuito</label>
          <select id="t-circuit" name="circuit_id" defaultValue={t.circuit_id ?? ""}><option value="">Ninguno</option>{circuits.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div className="field"><label htmlFor="t-season">Temporada</label>
          <select id="t-season" name="season_id" defaultValue={t.season_id ?? ""}><option value="">Ninguna</option>{seasons.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
      </div>
    </FormSection>
  );
}

export function VenueSection({ t = {}, venues }: { t?: TournamentData; venues: Opt[] }) {
  return (
    <FormSection icon="pin" title="Sede" desc="Elegí el club donde se juega, o agregá uno nuevo con sus canchas.">
      <div className="field" style={{ marginBottom: 0 }}><VenueSelect venues={venues} value={t.venue_id ?? ""} /></div>
    </FormSection>
  );
}

export function TimingFields({ t = {} }: { t?: TournamentData }) {
  return (
    <>
      <div className="field"><label htmlFor="t-dur">Duración est. (min)</label><input id="t-dur" type="number" name="match_duration_min" min={10} max={300} defaultValue={t.match_duration_min ?? 60} /></div>
      <div className="field"><label htmlFor="t-rest">Descanso (min)</label><input id="t-rest" type="number" name="min_rest_min" min={0} max={600} defaultValue={t.min_rest_min ?? 30} /></div>
    </>
  );
}

export function DescriptionSection({ t = {} }: { t?: TournamentData }) {
  return (
    <FormSection icon="doc" title="Descripción" desc="Reglamento e información que ven los jugadores en la página del torneo.">
      <div className="field"><textarea name="rules_text" aria-label="Descripción" defaultValue={t.rules_text ?? ""} placeholder="Ej. Pelotas Head Pro. Presentarse 15 minutos antes. W.O. a los 15 minutos de tolerancia." /></div>
      <label className="checkbox" style={{ marginBottom: 0 }}><input type="checkbox" name="is_public" defaultChecked={t.is_public ?? true} /> Visible en la vista pública</label>
    </FormSection>
  );
}

export function CardSection({ t = {} }: { t?: TournamentData }) {
  return (
    <FormSection icon="image" title="Publicación de la tarjeta" desc="Subí el logo y elegí la imagen de fondo. A la derecha ves cómo se va a publicar.">
      <CardPublisher logo={t.logo} bg={t.card_bg} />
    </FormSection>
  );
}
