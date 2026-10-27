import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { playerLoginAction } from "@/server/actions/jugadores";
import { getCurrentPlayer } from "@/server/playerAuth";

export const metadata = { title: "Ingresar · Jugadores" };

export default async function PlayerLoginPage() {
  if (await getCurrentPlayer()) redirect("/jugadores");
  return (
    <AuthShell>
      <h1>Hola, <span className="accent">jugador</span></h1>
      <p className="muted auth-sub">Ingresá a Mi Padel Match para ver tus partidos y recibir avisos.</p>
      <ActionForm action={playerLoginAction}>
        <div className="field"><label htmlFor="email">Email</label>
          <div className="input-icon"><FieldIcon name="user" /><input id="email" name="email" type="email" autoComplete="username" placeholder="tu@correo.com" required /></div>
        </div>
        <div className="field"><label htmlFor="password">Contraseña</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" autoComplete="current-password" placeholder="••••••••" required /></div>
        </div>
        <Submit className="btn primary block lg auth-submit" pendingText="Ingresando…">Ingresar →</Submit>
      </ActionForm>
      <div className="auth-divider" />
      <p className="auth-foot">¿No tenés cuenta? <Link href="/jugadores/registro">Creala acá</Link> (es gratis).</p>
      <p className="muted auth-foot" style={{ fontSize: 13 }}>¿Olvidaste tu contraseña? Pedile a la organización que te la restablezca.</p>
      <p className="muted auth-foot" style={{ fontSize: 13 }}>¿Organizás torneos? <Link href="/login">Ingresá al panel</Link>.</p>
    </AuthShell>
  );
}
