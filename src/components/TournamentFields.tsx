type Opt = { id: string; name: string };
type T = { name?: string; start_date?: string; end_date?: string; venue_id?: string | null; circuit_id?: string | null; season_id?: string | null; is_public?: boolean; rules_text?: string | null; match_duration_min?: number; min_rest_min?: number; status?: string };

export function TournamentFields({ t = {}, venues, circuits, seasons, withStatus = false }: { t?: T; venues: Opt[]; circuits: Opt[]; seasons: Opt[]; withStatus?: boolean }) {
  return (
    <>
      <div className="field"><label>Nombre del torneo *</label><input name="name" defaultValue={t.name} required minLength={3} maxLength={100} placeholder="Ej. Abierto de Primavera" /></div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Fecha de inicio *</label><input type="date" name="start_date" defaultValue={t.start_date} required /></div>
        <div className="field"><label>Fecha de fin</label><input type="date" name="end_date" defaultValue={t.end_date} /></div>
        <div className="field"><label>Sede</label>
          <select name="venue_id" defaultValue={t.venue_id ?? ""}><option value="">Sin sede</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <div className="hint">Las canchas de la sede se usan para el cronograma.</div></div>
        <div className="field"><label>Circuito</label>
          <select name="circuit_id" defaultValue={t.circuit_id ?? ""}><option value="">Ninguno</option>{circuits.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div className="field"><label>Temporada</label>
          <select name="season_id" defaultValue={t.season_id ?? ""}><option value="">Ninguna</option>{seasons.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        {withStatus && (
          <div className="field"><label>Estado</label>
            <select name="status" defaultValue={t.status}>
              <option value="DRAFT">Borrador (no visible)</option><option value="OPEN">Inscripción abierta</option>
              <option value="IN_PROGRESS">En curso</option><option value="FINISHED">Finalizado</option><option value="CANCELLED">Cancelado</option>
            </select></div>
        )}
        <div className="field"><label>Duración estimada por partido (min)</label><input type="number" name="match_duration_min" min={10} max={300} defaultValue={t.match_duration_min ?? 60} /></div>
        <div className="field"><label>Descanso mínimo entre partidos (min)</label><input type="number" name="min_rest_min" min={0} max={600} defaultValue={t.min_rest_min ?? 30} /></div>
      </div>
      <div className="field"><label>Reglamento / información para jugadores</label><textarea name="rules_text" defaultValue={t.rules_text ?? ""} /></div>
      <label className="checkbox" style={{ marginBottom: 12 }}><input type="checkbox" name="is_public" defaultChecked={t.is_public ?? true} /> Visible en la vista pública</label>
    </>
  );
}
