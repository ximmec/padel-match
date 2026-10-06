type P = { first_name?: string; last_name?: string; gender?: string; document?: string | null; phone?: string | null; email?: string | null; city?: string | null; category?: string | null; notes?: string | null };

export function PlayerFields({ p = {}, categories = [] }: { p?: P; categories?: string[] }) {
  return (
    <>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Nombre *</label><input name="first_name" defaultValue={p.first_name} required maxLength={60} /></div>
        <div className="field"><label>Apellido *</label><input name="last_name" defaultValue={p.last_name} required maxLength={60} /></div>
        <div className="field"><label>Género *</label>
          <select name="gender" defaultValue={p.gender ?? ""} required>
            <option value="" disabled>Elegir…</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
            <option value="X">Otro / no especifica</option>
          </select>
        </div>
        <div className="field"><label>Documento (opcional)</label><input name="document" defaultValue={p.document ?? ""} maxLength={20} inputMode="numeric" />
          <div className="hint">Evita duplicados de jugadores con el mismo nombre.</div></div>
        <div className="field"><label>Teléfono</label><input name="phone" defaultValue={p.phone ?? ""} maxLength={30} inputMode="tel" /></div>
        <div className="field"><label>Email</label><input name="email" type="email" defaultValue={p.email ?? ""} maxLength={120} /></div>
        <div className="field"><label>Categoría</label><input name="category" defaultValue={p.category ?? ""} maxLength={40} placeholder="Ej. 4ta, 6ta, Principiante" list="player-categories" />
          <datalist id="player-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="hint">El nivel del jugador. Se usa para filtrar y ordenar la lista.</div></div>
        <div className="field"><label>Ciudad</label><input name="city" defaultValue={p.city ?? ""} maxLength={60} /></div>
      </div>
      <div className="field"><label>Notas</label><textarea name="notes" defaultValue={p.notes ?? ""} maxLength={500} /></div>
    </>
  );
}
