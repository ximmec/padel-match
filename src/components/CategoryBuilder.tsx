"use client";
import { useState } from "react";

const LEVELS = ["Libre", "1ra", "2da", "3ra", "4ta", "5ta", "6ta", "7ma", "8va", "Beginner", "Advanced"];
const GENDERS: [string, string][] = [["MALE", "Caballeros"], ["FEMALE", "Damas"], ["MIXED", "Mixto"], ["OPEN", "Libre (cualquiera)"]];
const VETS = ["+35", "+40", "+45", "+50", "+55", "+60"];

export function buildCategoryName(level: string, suma: string | null, gender: string, vet: string): string {
  const g = { MALE: "Caballeros", FEMALE: "Damas", MIXED: "Mixto", OPEN: "" }[gender] ?? "";
  return [suma ? `Suma ${suma}` : level, g, vet].filter(Boolean).join(" ");
}

/** Crear una categoría nueva desde el formulario del torneo. */
export function CategoryBuilder() {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState("");
  const [sumaOn, setSumaOn] = useState(false);
  const [suma, setSuma] = useState("11");
  const [gender, setGender] = useState("");
  const [vet, setVet] = useState("");
  const name = (level || sumaOn) && gender ? buildCategoryName(level, sumaOn ? suma : null, gender, vet) : "";
  if (!on) return <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setOn(true)}>+ Crear categoría nueva</button>;
  return (
    <div className="cat-builder">
      <input type="hidden" name="newcat_on" value="1" />
      <div className="row between" style={{ marginBottom: 8 }}>
        <label style={{ margin: 0 }}>Categoría nueva *</label>
        <label className="checkbox sm-check"><input type="checkbox" name="newcat_suma_on" checked={sumaOn} onChange={(e) => setSumaOn(e.target.checked)} /> SUMA</label>
      </div>
      <div className="fgrid">
        {sumaOn ? (
          <select name="newcat_suma" value={suma} onChange={(e) => setSuma(e.target.value)} aria-label="Suma">
            {Array.from({ length: 13 }, (_, i) => String(i + 4)).map((n) => <option key={n} value={n}>Suma {n}</option>)}
          </select>
        ) : (
          <select name="newcat_level" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nivel" required>
            <option value="">Elegir categoría</option>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select name="newcat_gender" value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Género" required>
          <option value="">Género (obligatorio)</option>{GENDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="span-2">
          <label style={{ fontWeight: 400, color: "var(--muted)" }}>Veteranos (opcional)</label>
          <select name="newcat_vet" value={vet} onChange={(e) => setVet(e.target.value)}>
            <option value="">Sin categoría veteranos</option>{VETS.map((v) => <option key={v} value={v}>Veteranos {v}</option>)}
          </select>
        </div>
      </div>
      <div className="row between" style={{ marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>{name ? <>Se va a crear: <b style={{ color: "var(--orange-hi)" }}>{name}</b></> : "Elegí nivel (o suma) y género."}</span>
        <button type="button" className="link-btn" onClick={() => setOn(false)}>Cancelar</button>
      </div>
    </div>
  );
}
