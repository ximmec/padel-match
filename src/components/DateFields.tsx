"use client";
import { useState } from "react";

/** Fecha, horario, inscripción y «Torneo largo» (varios días). */
export function DateFields({ start, end, time, fee }: { start?: string; end?: string; time?: string | null; fee?: number | null }) {
  const [long, setLong] = useState(!!start && !!end && end !== start);
  return (
    <>
      <div className="fgrid fgrid-3">
        <div className="field"><label htmlFor="t-start">Fecha *</label><input id="t-start" type="date" name="start_date" defaultValue={start} required /></div>
        <div className="field"><label htmlFor="t-time">Horario de inicio</label><input id="t-time" type="time" name="start_time" defaultValue={time?.slice(0, 5) ?? ""} /></div>
        <div className="field"><label htmlFor="t-fee">Inscripción por pareja</label>
          <div className="money"><span>$</span><input id="t-fee" name="entry_fee" inputMode="numeric" defaultValue={fee ?? ""} placeholder="0" /></div></div>
      </div>
      <div className="toggle-row">
        <div><b>Torneo largo</b><p>Los partidos se distribuyen en varios días en lugar de jugarse en una sola jornada.</p></div>
        <label className="switch"><input type="checkbox" checked={long} onChange={(e) => setLong(e.target.checked)} aria-label="Torneo largo" /><span /></label>
      </div>
      {long && (
        <div className="fgrid fgrid-3" style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor="t-end">Fecha de fin *</label><input id="t-end" type="date" name="end_date" defaultValue={end} required /></div>
        </div>
      )}
    </>
  );
}
