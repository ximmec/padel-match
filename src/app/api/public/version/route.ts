import { NextResponse } from "next/server";
import { sql } from "@/server/db";
import { isUuid } from "@/server/action";

export const dynamic = "force-dynamic";

/** Huella de la última modificación de un torneo; la vista pública la consulta para actualizarse sola. */
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!isUuid(t)) return NextResponse.json({ error: "t inválido" }, { status: 400 });
  const [r] = await sql<{ v: string | null }[]>`
    SELECT concat_ws('|',
      (SELECT max(m.updated_at)::text FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = ${t}),
      (SELECT max(tc.version)::text || ':' || count(*)::text FROM tournament_categories tc WHERE tc.tournament_id = ${t}),
      (SELECT count(*)::text FROM matches m JOIN tournament_categories tc ON tc.id = m.tc_id WHERE tc.tournament_id = ${t}),
      (SELECT count(*)::text FROM zone_entries ze JOIN tournament_categories tc ON tc.id = ze.tc_id WHERE tc.tournament_id = ${t}),
      (SELECT updated_at::text FROM tournaments WHERE id = ${t} AND is_public)
    ) AS v`;
  return NextResponse.json({ v: r?.v ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
