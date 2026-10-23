"use client";
import { useMemo, useState } from "react";
import { planZoneSizes } from "@/core/zones";
import { qualifiersInZone, resolveQualification } from "@/core/bracket";
import { Toggle } from "@/components/Toggle";

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
  const [bestNext, setBestNext] = useState<number | "AUTO">("AUTO");
  const [gvg, setGvg] = useState(false);
  const [pass3, setPass3] = useState(false);

  const summary = useMemo(() => {
    if (mode === "KNOCKOUT") {
      let bracket = 1;
      while (bracket < target) bracket *= 2;
      return { zones: [] as number[], q: target, bracket, byes: bracket - target, minMatches: 1 };
    }
    try {
      const zones = planZoneSizes(target, { preferredSize: size });
      const base = { perZone: perZone === "ALL" ? ("ALL" as const) : Number(perZone), bestNext: bestNext === "AUTO" ? 0 : bestNext, perZoneOf4: pass3 ? 3 : null };
      const rule = bestNext === "AUTO" ? resolveQualification({ ...base, autoBestNext: true }, zones) : base;
      const q = Math.min(target, zones.reduce((a, z) => a + qualifiersInZone(z, rule), 0) + (perZone === "ALL" ? 0 : rule.bestNext));
      let bracket = 1;
      while (bracket < q) bracket *= 2;
      const minMatches = Math.min(...zones.map((z) => (z === 4 && gvg ? 2 : z - 1)));
      return { zones, q, bracket, byes: bracket - q, minMatches, best: rule.bestNext };
    } catch { return null; }
  }, [mode, target, size, perZone, bestNext, gvg, pass3]);

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
        <div className="field"><label htmlFor="s-target">Parejas por categoría (cupo)</label>
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
          <select id="s-best" name="best_next" value={bestNext} onChange={(e) => setBestNext(e.target.value === "AUTO" ? "AUTO" : Number(e.target.value))} disabled={perZone === "ALL"}>
            <option value="AUTO">Automático (los que hagan falta)</option>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 0 ? "Ninguno" : `${n} mejor${n > 1 ? "es" : ""} ${perZone === "ALL" ? "" : `${Number(perZone) + 1}°`}`}</option>)}
          </select></div>
        </>}
        {children}
      </div>
      <div className="toggles">
        {mode === "ZONES" && <>
          <Toggle name="four_gvg" checked={gvg} onChange={setGvg} title="Si hay zonas de 4, GvG/PvP" desc="1° vs 4° y 2° vs 3°; después ganadores contra ganadores y perdedores contra perdedores, en lugar de todos contra todos." />
          <Toggle name="four_pass3" checked={pass3} onChange={setPass3} title="En las zonas de 4 pasan 3" desc={`de la zona de 4 clasifican 3; las demás siguen pasando ${perZone === "ALL" ? "todas" : perZone}.`} />
        </>}
        <Toggle name="no_schedule" title="Sin horarios" desc="el organizador asigna los horarios desde la mesa (no se genera cronograma automático)." />
        <Toggle name="ignore_restrictions" title="No tener en cuenta restricciones" desc="ignora los horarios que cargan las parejas." />
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
            <span><b>{summary.q}</b> clasificados{"best" in summary && summary.best ? <small> (incluye {summary.best} mejor{summary.best > 1 ? "es" : ""} {Number(perZone) + 1}°)</small> : null}</span>
            <span>cuadro de <b>{summary.bracket}</b>{summary.byes ? <small> ({summary.byes} bye{summary.byes > 1 ? "s" : ""})</small> : null}</span>
            <span>mínimo <b>{summary.minMatches}</b> partido{summary.minMatches !== 1 ? "s" : ""} por pareja</span>
          </>
        ) : <span>Ajustá los valores para ver el resumen.</span>}
      </div>
    </>
  );
}
