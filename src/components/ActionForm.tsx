"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/server/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingCtx = createContext<boolean | null>(null);

/**
 * Formulario conectado a una Server Action. Muestra errores, mensajes de éxito
 * y, si la acción lo pide, un recuadro con el impacto del cambio y el botón "Confirmar".
 *
 * Se envía manualmente (no con <form action>) para que React no borre lo que el usuario
 * escribió: así, al confirmar, se reenvían exactamente los mismos datos.
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
  const [state, formAction, pendingAction] = useActionState(action, {} as ActionState);
  const [pendingTransition, startTransition] = useTransition();
  const pending = pendingAction || pendingTransition;
  const ref = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (confirmRef.current) confirmRef.current.value = "0";
  }, [state, router, resetOnSuccess]);

  return (
    <PendingCtx.Provider value={pending}>
      <form
        ref={ref}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const form = e.currentTarget;
          const confirming = confirmRef.current?.value === "1";
          if (confirmText && !confirming && !window.confirm(confirmText)) return;
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const fd = new FormData(form, submitter && submitter.getAttribute("type") === "submit" ? submitter : undefined);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        <input ref={confirmRef} type="hidden" name="__confirm" defaultValue="0" />
        {state.error && <div className="alert err" role="alert">{state.error}</div>}
        {state.ok && state.message && !hideSuccess && !state.redirectTo && <div className="alert ok" role="status">{state.message}</div>}
        {state.confirm && (
          <div className="confirm-box" role="alertdialog">
            <h4>⚠ {state.confirm.title}</h4>
            <ul>{state.confirm.items.map((i, k) => <li key={k}>{i}</li>)}</ul>
            <div className="row">
              <button
                type="button"
                className="btn warn sm"
                disabled={pending}
                onClick={() => {
                  if (confirmRef.current) confirmRef.current.value = "1";
                  ref.current?.requestSubmit();
                }}
              >
                {pending ? "Aplicando…" : "Confirmar y aplicar"}
              </button>
              <span className="muted" style={{ fontSize: 13 }}>Revisá el impacto antes de confirmar.</span>
            </div>
          </div>
        )}
      </form>
    </PendingCtx.Provider>
  );
}

export function Submit({ children, className = "btn", pendingText = "Guardando…" }: { children: ReactNode; className?: string; pendingText?: string }) {
  const ctx = useContext(PendingCtx);
  const { pending: formPending } = useFormStatus();
  const pending = ctx ?? formPending;
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
