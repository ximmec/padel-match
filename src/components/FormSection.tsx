import { Icon } from "@/components/Icon";

/** Bloque de formulario con ícono, título y descripción. */
export function FormSection({ icon, title, desc, children, aside }: { icon: string; title: string; desc?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="fsec">
      <div className="fsec-head">
        <span className="fsec-ico"><Icon name={icon} size={20} /></span>
        <div style={{ flex: 1 }}><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}
