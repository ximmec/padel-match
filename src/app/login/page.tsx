import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { loginAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth";
import { sql } from "@/server/db";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect("/admin");
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
  if (n === 0) redirect("/setup");
  return (
    <AuthShell>
      <h1>Bienvenido <span className="accent">de vuelta</span></h1>
      <p className="muted auth-sub">Ingresá al panel de organizadores.</p>
      <ActionForm action={loginAction}>
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div className="field"><label htmlFor="email">Email</label>
          <div className="input-icon"><FieldIcon name="user" /><input id="email" name="email" type="email" autoComplete="username" placeholder="tu@correo.com" required /></div>
        </div>
        <div className="field"><label htmlFor="password">Contraseña</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" autoComplete="current-password" placeholder="••••••••" required /></div>
        </div>
        <Submit className="btn primary block lg auth-submit" pendingText="Ingresando…">Ingresar →</Submit>
      </ActionForm>
      <p className="muted auth-foot">¿Olvidaste tu contraseña? Pedile al administrador de tu organización que te asigne una nueva.</p>
      <div className="auth-divider" />
      <p className="auth-foot">¿Sos jugador? No necesitás cuenta: <a href="/">buscá tu torneo acá</a>.</p>
    </AuthShell>
  );
}
