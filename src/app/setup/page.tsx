import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { setupAction } from "@/server/actions/auth";
import { sql } from "@/server/db";

export const metadata = { title: "Configuración inicial" };

export default async function SetupPage() {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
  if (n > 0) redirect("/login");
  return (
    <AuthShell>
      <h1>Bienvenido a <span className="accent">PADEL MATCH</span></h1>
      <p className="muted auth-sub">Creá la cuenta del administrador principal. Este paso se hace una sola vez.</p>
      <ActionForm action={setupAction}>
        {process.env.SETUP_KEY && (
          <div className="field"><label htmlFor="setupKey">Clave de instalación</label>
            <div className="input-icon"><FieldIcon name="key" /><PasswordInput id="setupKey" name="setupKey" required /></div>
            <div className="hint">Es el valor de la variable SETUP_KEY configurada en Vercel.</div></div>
        )}
        <div className="field"><label htmlFor="orgName">Nombre del organizador / club</label>
          <div className="input-icon"><FieldIcon name="home" /><input id="orgName" name="orgName" required placeholder="Ej. Circuito Pádel Norte" /></div></div>
        <div className="field"><label htmlFor="name">Tu nombre</label>
          <div className="input-icon"><FieldIcon name="id" /><input id="name" name="name" required /></div></div>
        <div className="field"><label htmlFor="email">Email</label>
          <div className="input-icon"><FieldIcon name="user" /><input id="email" name="email" type="email" required autoComplete="username" placeholder="tu@correo.com" /></div></div>
        <div className="field"><label htmlFor="password">Contraseña</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" required minLength={10} autoComplete="new-password" /></div>
          <div className="hint">Mínimo 10 caracteres, con letras y números.</div></div>
        <Submit className="btn primary block lg auth-submit">Crear y entrar</Submit>
      </ActionForm>
    </AuthShell>
  );
}
