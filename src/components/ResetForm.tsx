import { ActionForm, Submit } from "@/components/ActionForm";
import { resetCategoryAction, resetTournamentAction } from "@/server/actions/competition";

/** Reiniciar una categoría o todo el torneo, conservando las inscripciones. */
export function ResetForm({ scope, id }: { scope: "category" | "tournament"; id: string }) {
  const what = scope === "category" ? "esta categoría" : "todo el torneo";
  return (
    <details className="card reset-card">
      <summary>Reiniciar {what}</summary>
      <p className="muted" style={{ marginTop: 10 }}>Las parejas inscriptas <b>no se pierden</b>. Antes de aplicar te mostramos exactamente qué se va a borrar.</p>
      <ActionForm action={scope === "category" ? resetCategoryAction : resetTournamentAction}>
        <input type="hidden" name={scope === "category" ? "tc_id" : "tournament_id"} value={id} />
        <label className="choice">
          <input type="radio" name="mode" value="RESULTS" defaultChecked />
          <span><b>Borrar solo los resultados</b><small>Se mantienen las zonas, el cuadro y los horarios. Todos los partidos vuelven a "pendiente".</small></span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" value="ALL" />
          <span><b>Empezar de cero</b><small>Se borran zonas, partidos, cuadro y horarios. Quedan solo las inscripciones, listas para volver a sortear.</small></span>
        </label>
        <Submit className="btn danger" pendingText="Revisando…">Reiniciar {what}</Submit>
      </ActionForm>
    </details>
  );
}
