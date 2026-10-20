"use client";
import { useMemo, useState } from "react";
import { planZoneSizes } from "@/core/zones";

const FORMAT_OPTS: [string, string][] = [
  ["ONE_SET", "A un set"],
  ["PRO_SET_9", "Un set a 9 games"],
  ["BEST_OF_3_STB", "2 sets + super tiebreak"],
  ["BEST_OF_3", "Al mejor de 3 sets"],
];

/** Estructura deportiva: formato, zonas y clasificados, con un resumen en vivo. */
export function StructureFields({ children, cupo }: { children?: React.ReactNode; cupo?: number | null }) {
  const [mode, setMode] = useState("ZONES");
  const [target, setTarget] = useState(cupo ?? 16);
  const [size, setSize] = useState(3);
  const [perZone, setPerZone] = useState("2");
  const [bestNext, setBestNext] = useState(0);

  const summary = useMemo(() => {
    if (mode === "KNOCKOUT") {
      let bracket = 1;
      while (bracket < target) bracket *= 2;
      return { zones: [] as number[], q: target, bracket, byes: bracket - target, minMatches: 1 };
    }
    try {
      const zones = planZoneSizes(target, { preferredSize: size });
      const q = perZone === "ALL" ? target : Math.min(target, zones.reduce((a, z) => a + Math.min(Number(perZone), z), 0) + bestNext);
      let bracket = 1;
      while (bracket < q) bracket *= 2;
      const minMatches = Math.min(...zones) - 1;
      return { zones, q, bracket, byes: bracket - q, minMatches };
    } catch { return null; }
  }, [mode, target, size, perZone, bestNext]);

  return (
    <>
      <div className="fgrid fgrid-5">
        <div className="field"><label htmlFor="s-mode">Formato competitivo</label>
          <select id="s-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="ZONES">Zonas + playoffs</option>
            <option value="KNOCKOUT">Eliminación directa</option>
          </select></div>
        <div className="field"><label htmlFor="s-format">Sets por partido</label>
          <select id="s-format" name="format" defaultValue="BEST_OF_3_STB">{FORMAT_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="s-tb">Tiebreak</label>
          <select id="s-tb" name="tb" defaultValue="AT_G">
            <option value="AT_G">En 6-6 (termina 7-6)</option>
            <option value="AT_G1">En 5-5 (termina 6-5)</option>
            <option value="NONE">Sin tiebreak</option>
          </select></div>
        <div className="field"><label htmlFor="s-target">Parejas objetivo (cupo)</label>
          <select id="s-target" name="max_entries" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            {Array.from({ length: 61 }, (_, i) => i + 4).map((n) => <option key={n} value={n}>{n} parejas</option>)}
          </select></div>
        {mode === "ZONES" && <>
        <div className="field"><label htmlFor="s-size">Parejas por zona</label>
          <select id="s-size" name="zone_size" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} parejas · {n - 1} partidos</option>)}
          </select></div>
        <div className="field"><label htmlFor="s-per">Pasan al playoff por zona</label>
          <select id="s-per" name="per_zone" value={perZone} onChange={(e) => setPerZone(e.target.value)}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} pareja{n > 1 ? "s" : ""}</option>)}
            <option value="ALL">Todas</option>
          </select></div>
        <div className="field"><label htmlFor="s-best">Mejores siguientes</label>
          <select id="s-best" name="best_next" value={bestNext} onChange={(e) => setBestNext(Number(e.target.value))} disabled={perZone === "ALL"}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 0 ? "Ninguno" : `${n} mejor${n > 1 ? "es" : ""} ${perZone === "ALL" ? "" : `${Number(perZone) + 1}°`}`}</option>)}
          </select></div>
        </>}
        {children}
      </div>
      <div className="structure-summary">
        {summary && mode === "KNOCKOUT" ? (
          <>
            <span>cuadro de <b>{summary.bracket}</b>{summary.byes ? <small> ({summary.byes} pase{summary.byes > 1 ? "s" : ""} libre{summary.byes > 1 ? "s" : ""})</small> : null}</span>
            <span><b>{Math.log2(summary.bracket)}</b> rondas</span>
            <span>el que pierde queda afuera</span>
          </>
        ) : summary ? (
          <>
            <span><b>{summary.zones.length}</b> zona{summary.zones.length > 1 ? "s" : ""} <small>({summary.zones.join(", ")})</small></span>
            <span><b>{summary.q}</b> clasificados</span>
            <span>cuadro de <b>{summary.bracket}</b>{summary.byes ? <small> ({summary.byes} bye{summary.byes > 1 ? "s" : ""})</small> : null}</span>
            <span>mínimo <b>{summary.minMatches}</b> partido{summary.minMatches !== 1 ? "s" : ""} por pareja</span>
          </>
        ) : <span>Ajustá los valores para ver el resumen.</span>}
      </div>
    </>
  );
}
