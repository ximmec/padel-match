"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./ActionForm";
import { recordResultAction } from "@/server/actions/competition";
import type { MatchOutcome } from "@/core/scoring";

/**
 * Carga rápida de resultado: casillas grandes por set, pensadas para usar en el celular.
 */
export function ResultForm({
  matchId, version, sideA, sideB, maxSets, current, compact = false,
}: {
  matchId: string;
  version: number;
  sideA: string;
  sideB: string;
  maxSets: number;
  current: MatchOutcome | null;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"PLAYED" | "WO_A" | "WO_B" | "RET_A" | "RET_B">(
    current?.kind === "WALKOVER" ? (current.winner === "A" ? "WO_A" : "WO_B") : current?.kind === "RETIRED" ? (current.winner === "A" ? "RET_A" : "RET_B") : "PLAYED",
  );
  const sets = current && current.kind !== "WALKOVER" ? current.sets : [];
  const isWo = mode.startsWith("WO");
  const kind = isWo ? "WALKOVER" : mode.startsWith("RET") ? "RETIRED" : "PLAYED";
  const winner = mode.endsWith("_A") ? "A" : mode.endsWith("_B") ? "B" : "";
  const n = Math.max(1, maxSets);

  return (
    <ActionForm action={recordResultAction} hideSuccess={false}>
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="winner" value={winner} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(" + n + ", auto)", gap: 6, alignItems: "center" }}>
        <div className="muted" style={{ fontSize: 12 }}></div>
        {Array.from({ length: n }, (_, i) => <div key={i} className="muted" style={{ fontSize: 11, textAlign: "center" }}>Set {i + 1}</div>)}
        {(["A", "B"] as const).map((side) => (
          <Row key={side} label={side === "A" ? sideA : sideB} side={side} n={n} sets={sets} disabled={isWo} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select className="sm" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Tipo de resultado">
          <option value="PLAYED">Partido completo</option>
          <option value="WO_A">W.O. — gana {sideA}</option>
          <option value="WO_B">W.O. — gana {sideB}</option>
          <option value="RET_A">Abandono — gana {sideA}</option>
          <option value="RET_B">Abandono — gana {sideB}</option>
        </select>
        {current && !compact && <input name="reason" className="sm" placeholder="Motivo de la corrección" style={{ flex: 1, minWidth: 140 }} />}
        <Submit className="btn primary" pendingText="Guardando…">{current ? "Corregir" : "Guardar"}</Submit>
      </div>
    </ActionForm>
  );
}

function Row({ label, side, n, sets, disabled }: { label: string; side: "A" | "B"; n: number; sets: [number, number][]; disabled: boolean }) {
  return (
    <>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
      {Array.from({ length: n }, (_, i) => (
        <input
          key={i}
          className="score"
          name={`s${i + 1}${side.toLowerCase()}`}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          disabled={disabled}
          defaultValue={sets[i] ? String(side === "A" ? sets[i][0] : sets[i][1]) : ""}
          aria-label={`${label} set ${i + 1}`}
          onFocus={(e) => e.currentTarget.select()}
        />
      ))}
    </>
  );
}
