import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Brand } from "@/components/Brand";
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
    <>
      <header className="topbar"><div className="topbar-inner"><Brand /></div></header>
      <div style={{ textAlign: "center", marginTop: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.webp" alt="PADEL-MATCH.NET" width={190} height={190} style={{ filter: "drop-shadow(0 12px 40px rgba(255,115,0,.25))" }} />
      </div>
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card" style={{ marginTop: 12 }}>
          <h1>Ingresar</h1>
          <p className="muted">Panel de administración para organizadores.</p>
          <ActionForm action={loginAction}>
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required autoFocus /></div>
            <div className="field"><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <Submit className="btn primary block lg" pendingText="Ingresando…">Ingresar</Submit>
          </ActionForm>
        </div>
        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>¿Sos jugador? No necesitás cuenta: <a href="/">buscá tu torneo acá</a>.</p>
      </main>
    </>
  );
}
