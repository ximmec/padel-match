"use client";
import { useRef, useState, type ReactNode } from "react";
import { ActionForm, Submit } from "@/components/ActionForm";
import { markWinnerAction, setBracketSlotAction } from "@/server/actions/competition";

export type SlotPair = { id: string; label: string };
export type SlotOption = { v: string; l: string };

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Un lado de un partido del cuadro: al tocarlo abre un menú con dos acciones separadas,
 * «Marcar como ganadora» y «Cambiar pareja» (con buscador).
 */
export function BracketSlotMenu({ children, tcId, code, side, canWin, canChange, pairs, auto, current }: {
  children: ReactNode;
  tcId: string;
  code: string;
  side: "a" | "b";
  /** Hay dos parejas definidas: se puede marcar ganadora. */
  canWin: boolean;
  /** Solo el administrador general cambia parejas. */
  canChange: boolean;
  pairs: SlotPair[];
  /** «Volver a automático» (ej. Ganador R1-1, 1° Zona A). */
  auto: SlotOption[];
  current: string | null;
}) {
  const [open, setOpen] = useState<null | "menu" | "change">(null);
  const [q, setQ] = useState("");
  const refInput = useRef<HTMLInputElement>(null);
  if (!canWin && !canChange) return <>{children}</>;
  const list = pairs.filter((p) => p.id !== current && (!q || fold(p.label).includes(fold(q))));
  const pick = (v: string) => {
    if (!refInput.current) return;
    refInput.current.value = v;
    refInput.current.form?.requestSubmit();
  };

  return (
    <div className={`slot-wrap ${open ? "open" : ""}`}>
      <button type="button" className="slot-btn" onClick={() => setOpen(open ? null : "menu")} aria-expanded={!!open} title="Tocá para ver las opciones">
        {children}
      </button>
      {open && (
        <div className="slot-menu">
          {canWin && (
            <ActionForm action={markWinnerAction} hideSuccess>
              <input type="hidden" name="tc_id" value={tcId} />
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="side" value={side} />
              <Submit className="slot-opt win" pendingText="Guardando…">🏆 Marcar como ganadora</Submit>
            </ActionForm>
          )}
          {canChange && open === "menu" && (
            <button type="button" className="slot-opt" onClick={() => setOpen("change")}>🔄 Cambiar pareja</button>
          )}
          {canChange && open === "change" && (
            <ActionForm action={setBracketSlotAction} hideSuccess>
              <input type="hidden" name="tc_id" value={tcId} />
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="side" value={side} />
              <input type="hidden" name="ref" ref={refInput} defaultValue="" />
              <input className="sm slot-search" autoFocus placeholder="Buscar por nombre o apellido…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="slot-list">
                {list.map((p) => <button type="button" key={p.id} className="slot-item" onClick={() => pick(`ENTRY:${p.id}`)}>{p.label}</button>)}
                {list.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 6 }}>No hay parejas con ese nombre.</div>}
                {!q && auto.length > 0 && <div className="slot-sep">Volver a automático</div>}
                {!q && auto.map((o) => <button type="button" key={o.v} className="slot-item auto" onClick={() => pick(o.v)}>{o.l}</button>)}
              </div>
            </ActionForm>
          )}
          <button type="button" className="slot-close" onClick={() => { setOpen(null); setQ(""); }}>Cerrar</button>
        </div>
      )}
    </div>
  );
}
