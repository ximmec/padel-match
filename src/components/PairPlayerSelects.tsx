"use client";
import { useState } from "react";

export type PickPlayer = { id: string; label: string; category: string | null };

/**
 * Jugador 1 y Jugador 2 para inscribir una pareja. Si la categoría del torneo coincide con una
 * categoría de jugador (ej. Advanced), primero se muestran solo esos; con la casilla se agregan los demás.
 */
export function PairPlayerSelects({ players, level }: { players: PickPlayer[]; level: string | null }) {
  const [all, setAll] = useState(false);
  const main = level ? players.filter((p) => p.category === level) : players;
  const others = level ? players.filter((p) => p.category !== level) : [];
  const select = (name: string, label: string) => (
    <div className="field"><label htmlFor={name}>{label}</label>
      <select id={name} name={name} required defaultValue="">
        <option value="" disabled>Elegir…</option>
        {level ? (
          <>
            <optgroup label={`${level} (${main.length})`}>{main.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            {all && others.length > 0 && <optgroup label={`Otras categorías (${others.length})`}>{others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>}
          </>
        ) : players.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </div>
  );
  return (
    <>
      {level && (
        <div className="alert info" style={{ marginTop: 0 }}>
          Se muestran los jugadores de la categoría <b>{level}</b> ({main.length}).
          {others.length > 0 && (
            <label className="checkbox" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Mostrar también jugadores de otras categorías ({others.length})
            </label>
          )}
        </div>
      )}
      {select("player1", "Jugador 1")}
      {select("player2", "Jugador 2")}
    </>
  );
}
