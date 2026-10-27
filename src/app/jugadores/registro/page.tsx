import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { playerRegisterAction } from "@/server/actions/jugadores";
import { getCurrentPlayer } from "@/server/playerAuth";

export const metadata = { title: "Crear cuenta · Jugadores" };

export default async function PlayerRegisterPage() {
  if (await getCurrentPlayer()) redirect("/jugadores");
  return (
    <AuthShell>
      <h1>Creá tu <span className="accent">cuenta</span></h1>
      <p className="muted auth-sub">Mirá tus partidos y recibí avisos en el celular: horarios, canchas y resultados.</p>
      <ActionForm action={playerRegisterAction}>
        <div className="field"><label htmlFor="name">Nombre y apellido</label>
          <div className="input-icon"><FieldIcon name="user" /><input id="name" name="name" autoComplete="name" placeholder="Como figurás en los torneos" required maxLength={80} /></div>
        </div>
        <div className="field"><label htmlFor="email">Email</label>
          <div className="input-icon"><FieldIcon name="mail" /><input id="email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required /></div>
        </div>
        <div className="field"><label htmlFor="document">DNI (opcional)</label>
          <input id="document" name="document" inputMode="numeric" placeholder="Nos ayuda a encontrar tu ficha de jugador" maxLength={15} />
        </div>
        <div className="field"><label htmlFor="phone">Celular (opcional)</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="11 2345 6789" maxLength={30} />
        </div>
        <div className="field"><label htmlFor="password">Contraseña</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" autoComplete="new-password" placeholder="Mínimo 8, con letras y números" required /></div>
        </div>
        <div className="field"><label htmlFor="password2">Repetí la contraseña</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password2" name="password2" autoComplete="new-password" placeholder="••••••••" required /></div>
        </div>
        <Submit className="btn primary block lg auth-submit" pendingText="Creando…">Crear cuenta →</Submit>
      </ActionForm>
      <div className="auth-divider" />
      <p className="auth-foot">¿Ya tenés cuenta? <Link href="/jugadores/ingresar">Ingresá</Link>.</p>
    </AuthShell>
  );
}
