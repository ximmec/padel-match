import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AuthShell, FieldIcon } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { playerRegisterAction } from "@/server/actions/jugadores";
import { getCurrentPlayer } from "@/server/playerAuth";
import { getT } from "@/i18n/server";

export async function generateMetadata() { const { t } = await getT(); return { title: `${t.me.create} · ${t.me.title}` }; }

export default async function PlayerRegisterPage() {
  if (await getCurrentPlayer()) redirect("/jugadores");
  const { lang, t } = await getT();
  const a = t.auth;
  return (
    <AuthShell lang={lang} langSwitch>
      <h1>{a.regTitle1}<span className="accent">{a.regTitle2}</span></h1>
      <p className="muted auth-sub">{a.regSub}</p>
      <ActionForm action={playerRegisterAction}>
        <div className="field"><label htmlFor="name">{a.name}</label>
          <div className="input-icon"><FieldIcon name="user" /><input id="name" name="name" autoComplete="name" placeholder={a.namePh} required maxLength={80} /></div>
        </div>
        <div className="field"><label htmlFor="email">{a.email}</label>
          <div className="input-icon"><FieldIcon name="mail" /><input id="email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required /></div>
        </div>
        <div className="field"><label htmlFor="document">{a.doc}</label>
          <input id="document" name="document" placeholder={a.docPh} maxLength={15} />
        </div>
        <div className="field"><label htmlFor="phone">{a.phone}</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="11 2345 6789" maxLength={30} />
        </div>
        <div className="field"><label htmlFor="password">{a.password}</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password" name="password" autoComplete="new-password" placeholder={a.pwPh} required /></div>
        </div>
        <div className="field"><label htmlFor="password2">{a.pw2}</label>
          <div className="input-icon"><FieldIcon name="lock" /><PasswordInput id="password2" name="password2" autoComplete="new-password" placeholder="••••••••" required /></div>
        </div>
        <Submit className="btn primary block lg auth-submit" pendingText={a.creating}>{a.create}</Submit>
      </ActionForm>
      <div className="auth-divider" />
      <p className="auth-foot">{a.have} <Link href="/jugadores/ingresar">{a.enter}</Link>.</p>
    </AuthShell>
  );
}
