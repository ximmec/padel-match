"use client";
import { useState } from "react";

type Opt = { id: string; name: string };

/** Elegir sede o crear una nueva sin salir del formulario. */
export function VenueSelect({ venues, value }: { venues: Opt[]; value: string }) {
  const [v, setV] = useState(value);
  return (
    <>
      <select name="venue_id" value={v} onChange={(e) => setV(e.target.value)}>
        <option value="">Sin sede</option>
        {venues.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        <option value="__new__">+ Agregar nueva sede…</option>
      </select>
      {v === "__new__" ? (
        <div className="new-venue">
          <input name="new_venue_name" placeholder="Nombre de la nueva sede" required autoFocus />
          <input name="new_venue_address" placeholder="Dirección (opcional)" />
          <input name="new_venue_courts" type="number" min={0} max={40} placeholder="Cantidad de canchas" />
          <div className="hint">La sede se crea al guardar el torneo, con canchas «Cancha 1», «Cancha 2»… Después podés cambiarles el nombre en Configuración.</div>
        </div>
      ) : (
        <div className="hint">Las canchas de la sede se usan para el cronograma. ¿Falta una? Elegí «+ Agregar nueva sede…».</div>
      )}
    </>
  );
}
