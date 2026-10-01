"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/server/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Formulario conectado a una Server Action. Muestra errores, mensajes de éxito
 * y, si la acción lo pide, un recuadro con el impacto del cambio y el botón "Confirmar".
 */
export function ActionForm({
  action, children, className, resetOnSuccess = false, hideSuccess = false, confirmText,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
  /** Confirmación simple del navegador antes de enviar (para acciones destructivas). */
  confirmText?: string;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [confirmFlag, setConfirmFlag] = useState(false);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (!state.confirm) setConfirmFlag(false);
  }, [state, router, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !confirmFlag && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <input type="hidden" name="__confirm" value={confirmFlag ? "1" : "0"} />
      {state.error && <div className="alert err" role="alert">{state.error}</div>}
      {state.ok && state.message && !hideSuccess && !state.redirectTo && <div className="alert ok" role="status">{state.message}</div>}
      {state.confirm && (
        <div className="confirm-box" role="alertdialog">
          <h4>⚠ {state.confirm.title}</h4>
          <ul>{state.confirm.items.map((i, k) => <li key={k}>{i}</li>)}</ul>
          <div className="row">
            <ConfirmButton onClick={() => setConfirmFlag(true)} />
            <span className="muted" style={{ fontSize: 13 }}>Revisá el impacto antes de confirmar.</span>
          </div>
        </div>
      )}
    </form>
  );
}

function ConfirmButton({ onClick }: { onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn warn sm"
      disabled={pending}
      onClick={(e) => {
        // Marcar confirmación y reenviar en el mismo click
        const form = (e.currentTarget as HTMLButtonElement).form;
        const input = form?.querySelector<HTMLInputElement>('input[name="__confirm"]');
        if (input) input.value = "1";
        onClick();
      }}
    >
      {pending ? "Aplicando…" : "Confirmar y aplicar"}
    </button>
  );
}

export function Submit({ children, className = "btn", pendingText = "Guardando…" }: { children: ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
