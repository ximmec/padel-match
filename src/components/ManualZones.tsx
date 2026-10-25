"use client";
import { useMemo, useState } from "react";

export type ZonePair = { id: string; label: string; seed: number | null };

const zoneName = (i: number) => {
  let s = "", x = i;
  do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s;
};

function parseSizes(t: string): number[] | null {
  const v = t.split(/[\s,;+]+/).filter(Boolean).map(Number);
  return v.length && v.every((x) => Number.isInteger(x) && x >= 2 && x <= 12) ? v : null;
}

/** Armar zonas a mano: el organizador elige qué pareja va en cada lugar de cada zona. */
export function ManualZones({ pairs, suggested }: { pairs: ZonePair[]; suggested: number[] }) {
  const [sizesText, setSizesText] = useState(suggested.join(", "));
  const sizes = parseSizes(sizesText);
  const total = sizes?.reduce((a, b) => a + b, 0) ?? 0;
  const [grid, setGrid] = useState<string[][]>(() => suggested.map((n) => Array(n).fill("")));

  // Ajusta la grilla a los tamaños elegidos sin perder lo ya elegido
  const shaped = useMemo(() => (sizes ?? []).map((n, i) => Array.from({ length: n }, (_, k) => grid[i]?.[k] ?? "")), [sizes?.join(","), grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const used = new Set(shaped.flat().filter(Boolean));
  const unplaced = pairs.filter((p) => !used.has(p.id));
  const label = new Map(pairs.map((p) => [p.id, p.label]));
  const complete = !!sizes && total === pairs.length && unplaced.length === 0;

  const set = (zi: number, k: number, v: string) => setGrid(shaped.map((z, i) => z.map((x, j) => (i === zi && j === k ? v : x))));
  const fillRandom = () => {
    const pool = [...unplaced].sort(() => Math.random() - 0.5).map((p) => p.id);
    setGrid(shaped.map((z) => z.map((x) => x || pool.shift() || "")));
  };

  return (
    <div className="mz">
      <div className="mz-top">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="mz-sizes">Tamaños de zona</label>
          <input id="mz-sizes" value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="Ej. 4,3,3" />
          <div className="hint">Según la estructura elegida: {suggested.join(", ")}. Podés cambiarlo (por ejemplo 4,4,4,4).</div>
        </div>
        <div className="mz-status">
          {!sizes ? <span className="badge err">Tamaños inválidos</span>
            : total !== pairs.length ? <span className="badge warn">Las zonas suman {total} lugares y hay {pairs.length} parejas</span>
            : unplaced.length ? <span className="badge warn">Faltan ubicar {unplaced.length} pareja{unplaced.length > 1 ? "s" : ""}</span>
            : <span className="badge ok">¡Listo! Todas las parejas ubicadas</span>}
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={fillRandom} disabled={!unplaced.length || !sizes}>Completar el resto al azar</button>
            <button type="button" className="btn ghost sm" onClick={() => setGrid(shaped.map((z) => z.map(() => "")))}>Vaciar</button>
          </div>
        </div>
      </div>

      <div className="mz-grid">
        {shaped.map((z, zi) => (
          <div key={zi} className="mz-zone">
            <div className="mz-zone-head"><b>Zona {zoneName(zi)}</b><span className="muted">{z.filter(Boolean).length}/{z.length}</span></div>
            {z.map((v, k) => (
              <select key={k} className={`sm ${v ? "on" : ""}`} value={v} onChange={(e) => set(zi, k, e.target.value)} aria-label={`Zona ${zoneName(zi)}, lugar ${k + 1}`}>
                <option value="">{k + 1}. Elegir pareja…</option>
                {v && <option value={v}>{label.get(v)}</option>}
                {unplaced.map((p) => <option key={p.id} value={p.id}>{p.label}{p.seed ? ` (cabeza ${p.seed})` : ""}</option>)}
              </select>
            ))}
          </div>
        ))}
      </div>

      {unplaced.length > 0 && sizes && (
        <div className="mz-left"><span className="muted">Sin zona:</span> {unplaced.map((p) => <span key={p.id} className="badge">{p.label}</span>)}</div>
      )}
      <input type="hidden" name="manual" value={complete ? JSON.stringify(shaped) : ""} />
      <button className="btn primary" disabled={!complete}>Guardar zonas armadas a mano</button>
    </div>
  );
}
