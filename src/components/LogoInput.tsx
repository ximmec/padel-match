"use client";
import { useState } from "react";

/** Subir un logo: se recorta cuadrado, se achica a 256 px y se guarda en un campo oculto. */
export function LogoInput({ name = "logo", value }: { name?: string; value?: string | null }) {
  const [logo, setLogo] = useState(value ?? "");
  const [err, setErr] = useState("");
  async function onFile(f: File | undefined) {
    setErr("");
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setErr("Usá una imagen PNG, JPG o WEBP."); return; }
    const img = new Image();
    img.src = URL.createObjectURL(f);
    try { await img.decode(); } catch { setErr("No se pudo leer la imagen."); return; }
    const size = 256, c = document.createElement("canvas");
    c.width = size; c.height = size;
    const s = Math.min(img.width, img.height);
    c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    setLogo(c.toDataURL("image/webp", 0.85));
  }
  return (
    <div>
      <input type="hidden" name={name} value={logo} />
      <div className="row" style={{ gap: 12 }}>
        <span className="logo-slot">{logo ? <img src={logo} alt="" /> : <span>🏆</span>}</span>
        <label className="btn ghost sm" style={{ margin: 0, cursor: "pointer" }}>⬆ Subir logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
        {logo && <button type="button" className="link-btn" onClick={() => setLogo("")}>Quitar</button>}
      </div>
      {err && <div className="alert err">{err}</div>}
    </div>
  );
}
