import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { recoverAction } from "@/server/actions/auth";

export const metadata = { title: "Recuperar acceso", robots: { index: false } };

export default function RecoverPage() {
  const enabled = !!process.env.SETUP_KEY;
  return (
    <AuthShell>
      <h1>Recuperar <span className="accent">acceso</span></h1>
      <p className="muted auth-sub">Usá la clave de instalación (SETUP_KEY) para poner una contraseña nueva.</p>
      {!enabled ? (
        <div className="alert warn">La recuperación no está habilitada porque falta la variable SETUP_KEY en Vercel.</div>
      ) : (
        <ActionForm action={recoverAction}>
          <div className="field"><label htmlFor="setupKey">Clave de instalación</label>
            <div className="input-icon"><FieldIcon name="key" /><PasswordInput id="setupKey" name="setupKey" required autoComplete="off" /></div>
            <div className="hint">Está en Vercel → tu proyecto → Settings → Environment Variables → SETUP_KEY.</div></div>
          <div className="field"><label htmlFor="email">Email de la cuenta</label>
            <div className="input-icon"><FieldIcon name="user" /><input id="email" name="email" type="email" placeholder="tu@correo.com" autoComplete="username" /></div>
            <div className="hint">¿No te acordás del email? Dejalo vacío y te mostramos las cuentas de administrador.</div></div>
          <div className="field"><label htmlFor="password">Contraseña nueva</label>
            <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" minLength={10} autoComplete="new-password" /></div>
            <div className="hint">Mínimo 10 caracteres, con letras y números.</div></div>
          <Submit className="btn primary block lg auth-submit" pendingText="Guardando…">Guardar y entrar →</Submit>
        </ActionForm>
      )}
      <p className="auth-foot"><Link href="/login">← Volver a ingresar</Link></p>
    </AuthShell>
  );
}
