/** La acción requiere confirmación explícita: se muestra el impacto antes de aplicarla. */
export class NeedsConfirmation extends Error {
  constructor(public title: string, public items: string[]) { super(title); }
}
