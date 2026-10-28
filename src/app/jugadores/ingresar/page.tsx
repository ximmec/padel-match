import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { playerLoginAction } from "@/server/actions/jugadores";
import { getCurrentPlayer } from "@/server/playerAuth";
import { getT } from "@/i18n/server";

export async function generateMetadata() { const { t } = await getT(); return { title: `${t.nav.login} · ${t.me.title}` }; }

export default async function PlayerLoginPage() {
  if (await getCurrentPlayer()) redirect("/jugadores");
  const { lang, t } = await getT();
  const a = t.auth;
  return (
    <AuthShell lang={lang} langSwitch>
      <h1>{a.loginTitle1}<span className="accent">{a.loginTitle2}</span></h1>
      <p className="muted auth-sub">{a.loginSub}</p>
      <ActionForm action={playerLoginAction}>
        <div className="field"><label htmlFor="email">{a.email}</label>
          <div className="input-icon"><FieldIcon name="user" /><input id="email" name="email" type="email" autoComplete="username" placeholder="tu@correo.com" required /></div>
        </div>
        <div className="field"><label htmlFor="password">{a.password}</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" autoComplete="current-password" placeholder="••••••••" required /></div>
        </div>
        <Submit className="btn primary block lg auth-submit" pendingText={a.loggingIn}>{a.login}</Submit>
      </ActionForm>
      <div className="auth-divider" />
      <p className="auth-foot">{a.noAccount} <Link href="/jugadores/registro">{a.createHere}</Link> {a.free}</p>
      <p className="muted auth-foot" style={{ fontSize: 13 }}>{a.forgot}</p>
      <p className="muted auth-foot" style={{ fontSize: 13 }}>{a.organizer} <Link href="/login">{a.panel}</Link>.</p>
    </AuthShell>
  );
}
