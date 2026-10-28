"use client";
import { useEffect, useRef, useState } from "react";
import { CARD_BACKGROUNDS, cardBgUrl, fmtMoney } from "@/lib/cardBg";

const STATUS: Record<string, string> = { DRAFT: "Borrador", OPEN: "Abierto", IN_PROGRESS: "En curso", FINISHED: "Finalizado", CANCELLED: "Cancelado" };

/** Logo + imagen de fondo de la tarjeta, con vista previa en vivo. */
export function CardPublisher({ logo: initialLogo, bg: initialBg }: { logo?: string | null; bg?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [logo, setLogo] = useState(initialLogo ?? "");
  const [bg, setBg] = useState(initialBg ?? "atardecer");
  const [err, setErr] = useState("");
  const [p, setP] = useState({ name: "", date: "", time: "", venue: "", fee: "", status: "OPEN", cupo: "" });

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? "";
      const sel = form.elements.namedItem("venue_id") as HTMLSelectElement | null;
      const venue = sel?.value === "__new__" ? v("new_venue_name") : sel && sel.value ? sel.options[sel.selectedIndex].text : "";
      setP({ name: v("name"), date: v("start_date"), time: v("start_time"), venue, fee: v("entry_fee"), status: v("status") || "OPEN", cupo: v("max_entries") });
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); };
  }, []);

  async function onFile(f: File | undefined) {
    setErr("");
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setErr("Usá una imagen PNG, JPG o WEBP."); return; }
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode().catch(() => setErr("No se pudo leer la imagen."));
    const size = 256, c = document.createElement("canvas");
    c.width = size; c.height = size;
    const s = Math.min(img.width, img.height);
    c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    setLogo(c.toDataURL("image/webp", 0.85));
  }

  const url = cardBgUrl(bg);
  const fee = Number(p.fee.replace(/\D/g, "")) || 0;
  const date = p.date ? p.date.split("-").reverse().join("/") : "Fecha a definir";
  return (
    <div ref={ref} className="publisher">
      <input type="hidden" name="logo" value={logo} />
      <div>
        <label>Logo de la organización o del torneo</label>
        <div className="row" style={{ gap: 14, marginBottom: 6 }}>
          <span className="logo-slot">{logo ? <img src={logo} alt="" /> : <span>🏆</span>}</span>
          <label className="btn ghost pill" style={{ margin: 0, cursor: "pointer" }}>⬆ Subir logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
          {logo && <button type="button" className="link-btn" onClick={() => setLogo("")}>Quitar</button>}
        </div>
        <div className="hint">PNG o JPG. Se recorta en círculo, ideal cuadrado.</div>
        {err && <div className="alert err">{err}</div>}
        <div className="field" style={{ marginTop: 18 }}><label htmlFor="t-bg">Imagen de fondo de la tarjeta *</label>
          <select id="t-bg" name="card_bg" value={bg} onChange={(e) => setBg(e.target.value)}>
            {CARD_BACKGROUNDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
      </div>
      <div>
        <div className="preview-title">Vista previa</div>
        <article className="tcard2 preview" style={{ backgroundImage: url ? `linear-gradient(90deg, rgba(8,8,10,.96) 0%, rgba(8,8,10,.82) 45%, rgba(8,8,10,.55) 100%), url(${url})` : "none" }}>
          <div className="tcard2-top"><span className="badge info">{STATUS[p.status] ?? "Abierto"}</span></div>
          <div className="tcard2-body">
            {logo ? <img className="tcard2-logo" src={logo} alt="" /> : <span className="tcard2-logo initial">{(p.name.trim()[0] ?? "T").toUpperCase()}</span>}
            <div style={{ minWidth: 0 }}>
              <h3 className="tcard2-name">{p.name || "Nombre del torneo"}</h3>
              <div className="tcard2-meta">📅 {date}{p.time ? ` · ${p.time}` : ""}</div>
              <div className="tcard2-meta">📍 {p.venue || "Tu sede"}</div>
            </div>
          </div>
          <div className="tcard2-foot">
            <div className="tstat"><span><b>0/{p.cupo || "—"}</b><small>Parejas</small></span></div>
            <div className="tstat"><span><b>{fmtMoney(fee)}</b><small>Inscripción</small></span></div>
          </div>
        </article>
      </div>
    </div>
  );
}
