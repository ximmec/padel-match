import { NextResponse } from "next/server";
import { sql } from "@/server/db";
import { env } from "@/lib/env";
import { entryLabel, loadCategory, type LoadedCategory } from "@/server/category";
import { deliverPending, notifyEntry } from "@/server/notify";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Recordatorio «tu partido empieza en ~15 minutos». Lo llama una tarea programada cada pocos minutos
 * (Vercel Cron en plan Pro, o un servicio externo). Protegido con la variable CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = env("CRON_SECRET");
  if (!secret) return NextResponse.json({ ok: false, error: "Falta configurar CRON_SECRET" }, { status: 503 });
  const auth = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) return NextResponse.json({ ok: false }, { status: 401 });

  const due = await sql<{ id: string; tc_id: string; org_id: string; scheduled_at: Date; court: string | null }[]>`
    SELECT m.id, m.tc_id, t.org_id, m.scheduled_at, co.name AS court
    FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id JOIN tournaments t ON t.id = tc.tournament_id
    LEFT JOIN courts co ON co.id = m.court_id
    WHERE m.status = 'PENDING' AND m.reminded_at IS NULL AND t.status IN ('OPEN','IN_PROGRESS')
      AND m.scheduled_at BETWEEN now() + interval '5 minutes' AND now() + interval '20 minutes'
    ORDER BY m.scheduled_at LIMIT 200`;
  let reminded = 0;
  const cache = new Map<string, LoadedCategory>();
  for (const d of due) {
    await sql.begin(async (tx) => {
      const [claimed] = await tx`UPDATE matches SET reminded_at = now() WHERE id = ${d.id} AND reminded_at IS NULL RETURNING id`;
      if (!claimed) return;
      const lc = cache.get(d.tc_id) ?? (await loadCategory(tx, d.tc_id, d.org_id));
      cache.set(d.tc_id, lc);
      const m = lc.matches.find((x) => x.id === d.id)!;
      let a = m.entry_a, b = m.entry_b;
      if (m.phase === "BRACKET") {
        const rm = lc.view.bracket.find((x) => x.code === m.bracket_code);
        a = rm?.a.kind === "ENTRY" ? rm.a.entryId : null;
        b = rm?.b.kind === "ENTRY" ? rm.b.entryId : null;
      }
      if (!a || !b) return;
      for (const [me, rival] of [[a, b], [b, a]] as const) {
        const vs = entryLabel(lc.entryMap.get(rival)), court = d.court ? ` · ${d.court}` : "";
        await notifyEntry(tx, d.org_id, me, {
          es: { title: "⏰ Tu partido empieza pronto", body: `${lc.tc.category_name}: vs ${vs} a las ${fmtTime(d.scheduled_at, "es")}${court}.` },
          en: { title: "⏰ Your match starts soon", body: `${lc.tc.category_name}: vs ${vs} at ${fmtTime(d.scheduled_at, "en")}${court}.` },
        }, `/t/${lc.tc.tournament_slug}/c/${lc.tc.id}`);
      }
      reminded++;
    });
  }
  const delivered = await deliverPending();
  return NextResponse.json({ ok: true, reminded, ...delivered });
}
