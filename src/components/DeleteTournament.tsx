import { ActionForm, Submit } from "@/components/ActionForm";
import { deleteTournamentAction } from "@/server/actions/competition";

export function DeleteTournament({ id, open = false }: { id: string; open?: boolean }) {
  return (
    <details className="card reset-card" id="eliminar" open={open}>
      <summary>Eliminar torneo</summary>
      <p className="muted" style={{ marginTop: 10 }}>Borra el torneo con sus categorías, inscripciones, zonas, cuadros, horarios y resultados. Los jugadores y las sedes no se borran. Antes de aplicar te mostramos todo lo que se va a eliminar.</p>
      <ActionForm action={deleteTournamentAction}>
        <input type="hidden" name="tournament_id" value={id} />
        <Submit className="btn danger" pendingText="Revisando…">Eliminar torneo</Submit>
      </ActionForm>
    </details>
  );
}
