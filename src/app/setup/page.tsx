import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Brand } from "@/components/Brand";
import { setupAction } from "@/server/actions/auth";
import { sql } from "@/server/db";

export const metadata = { title: "Configuración inicial" };

export default async function SetupPage() {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
  if (n > 0) redirect("/login");
  return (
    <>
      <header className="topbar"><div className="topbar-inner"><Brand /></div></header>
      <div style={{ textAlign: "center", marginTop: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.webp" alt="PADEL-MATCH.NET" width={200} height={200} style={{ mixBlendMode: "lighten" }} />
      </div>
      <main className="container" style={{ maxWidth: 520 }}>
        <div className="card" style={{ marginTop: 12 }}>
          <h1>Bienvenido a PADEL MATCH</h1>
          <p>Creá la cuenta del administrador principal. Este paso se hace una sola vez.</p>
          <ActionForm action={setupAction}>
            {process.env.SETUP_KEY && (
              <div className="field"><label>Clave de instalación</label><input name="setupKey" type="password" required />
                <div className="hint">Es el valor de la variable SETUP_KEY configurada en Vercel.</div></div>
            )}
            <div className="field"><label>Nombre del organizador / club</label><input name="orgName" required placeholder="Ej. Circuito Pádel Norte" /></div>
            <div className="field"><label>Tu nombre</label><input name="name" required /></div>
            <div className="field"><label>Email</label><input name="email" type="email" required autoComplete="username" /></div>
            <div className="field"><label>Contraseña</label><input name="password" type="password" required minLength={10} autoComplete="new-password" />
              <div className="hint">Mínimo 10 caracteres, con letras y números.</div></div>
            <Submit className="btn primary block lg">Crear y entrar</Submit>
          </ActionForm>
        </div>
      </main>
    </>
  );
}
