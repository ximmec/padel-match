import { VenueSelect } from "@/components/VenueSelect";
import { FormSection } from "@/components/FormSection";

type Opt = { id: string; name: string };
export type TournamentData = { name?: string; start_date?: string; end_date?: string; venue_id?: string | null; circuit_id?: string | null; season_id?: string | null; is_public?: boolean; rules_text?: string | null; match_duration_min?: number; min_rest_min?: number; status?: string };

export function BasicInfoSection({ t = {}, circuits, seasons, withStatus = false, children }: { t?: TournamentData; circuits: Opt[]; seasons: Opt[]; withStatus?: boolean; children?: React.ReactNode }) {
  return (
    <FormSection icon="info" title="Información básica" desc="Nombre, fechas, circuito y temporada del torneo.">
      <div className="fgrid">
        <div className="field span-2"><label htmlFor="t-name">Nombre del torneo *</label><input id="t-name" name="name" defaultValue={t.name} required minLength={3} maxLength={100} placeholder="Ej. Abierto de Primavera" /></div>
        <div className="field"><label htmlFor="t-start">Fecha de inicio *</label><input id="t-start" type="date" name="start_date" defaultValue={t.start_date} required /></div>
        <div className="field"><label htmlFor="t-end">Fecha de fin</label><input id="t-end" type="date" name="end_date" defaultValue={t.end_date} />
          <div className="hint">Si dura un solo día, dejalo vacío.</div></div>
        <div className="field"><label htmlFor="t-circuit">Circuito</label>
          <select id="t-circuit" name="circuit_id" defaultValue={t.circuit_id ?? ""}><option value="">Ninguno</option>{circuits.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div className="field"><label htmlFor="t-season">Temporada</label>
          <select id="t-season" name="season_id" defaultValue={t.season_id ?? ""}><option value="">Ninguna</option>{seasons.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        {withStatus && (
          <div className="field"><label htmlFor="t-status">Estado</label>
            <select id="t-status" name="status" defaultValue={t.status}>
              <option value="DRAFT">Borrador (no visible)</option><option value="OPEN">Inscripción abierta</option>
              <option value="IN_PROGRESS">En curso</option><option value="FINISHED">Finalizado</option><option value="CANCELLED">Cancelado</option>
            </select></div>
        )}
      </div>
      {children}
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
      <div className="field"><label htmlFor="t-dur">Duración estimada (min)</label><input id="t-dur" type="number" name="match_duration_min" min={10} max={300} defaultValue={t.match_duration_min ?? 60} />
        <div className="hint">Se usa para armar el cronograma.</div></div>
      <div className="field"><label htmlFor="t-rest">Descanso entre partidos (min)</label><input id="t-rest" type="number" name="min_rest_min" min={0} max={600} defaultValue={t.min_rest_min ?? 30} />
        <div className="hint">Mínimo para una misma pareja.</div></div>
    </>
  );
}

export function PlayersInfoSection({ t = {} }: { t?: TournamentData }) {
  return (
    <FormSection icon="doc" title="Información para jugadores" desc="Lo que van a ver los jugadores en la página del torneo.">
      <div className="field"><label htmlFor="t-rules">Reglamento / información</label><textarea id="t-rules" name="rules_text" defaultValue={t.rules_text ?? ""} placeholder="Ej. Pelotas Head Pro. Presentarse 15 minutos antes. W.O. a los 15 minutos de tolerancia." /></div>
      <label className="checkbox" style={{ marginBottom: 0 }}><input type="checkbox" name="is_public" defaultChecked={t.is_public ?? true} /> Visible en la vista pública</label>
    </FormSection>
  );
}
