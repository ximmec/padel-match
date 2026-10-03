import { NextResponse } from "next/server";
import { sql } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { isUuid } from "@/server/action";
import { audit } from "@/server/audit";
import { tournamentWorkbook, categoryWorkbook, rankingWorkbook, auditWorkbook, playersWorkbook, playersTemplateWorkbook, fileName } from "@/server/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Iniciá sesión" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const type = p.get("type");
  if (type !== "players-template" && !user.permissions.has("exports.download")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const id = (k: string) => { const v = p.get(k); return v && isUuid(v) ? v : null; };
  try {
    let out;
    switch (type) {
      case "tournament":
      case "schedule": {
        const t = id("t");
        if (!t) return NextResponse.json({ error: "Falta el torneo" }, { status: 400 });
        out = await tournamentWorkbook(sql, user.orgId, t, type);
        break;
      }
      case "category": {
        const tc = id("tc");
        if (!tc) return NextResponse.json({ error: "Falta la categoría" }, { status: 400 });
        out = await categoryWorkbook(sql, user.orgId, tc);
        break;
      }
      case "ranking":
        out = await rankingWorkbook(sql, user.orgId, { categoryId: id("category") ?? undefined, circuitId: id("circuit") ?? undefined, seasonId: id("season") ?? undefined });
        break;
      case "players-template":
        out = await playersTemplateWorkbook();
        break;
      case "players":
        out = await playersWorkbook(sql, user.orgId);
        break;
      case "audit": {
        if (!user.permissions.has("audit.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
        const d = (k: string) => { const v = p.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
        out = await auditWorkbook(sql, { orgId: user.orgId, tournamentId: id("t"), userId: id("u"), from: d("from"), to: d("to") });
        break;
      }
      default:
        return NextResponse.json({ error: "Tipo de exportación inválido" }, { status: 400 });
    }
    const buf = await out.wb.xlsx.writeBuffer();
    await sql.begin((tx) => audit(tx, user, { entity: "export", action: "export", tournamentId: id("t"), summary: `Exportación a Excel: ${out.name}` }));
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName(out.name))}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "No se pudo generar el archivo" }, { status: 500 });
  }
}
