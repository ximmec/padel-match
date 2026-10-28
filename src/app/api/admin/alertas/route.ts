import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getAdminAlerts } from "@/server/adminAlerts";

export const dynamic = "force-dynamic";

/** Avisos de la campanita (solo administradores generales). */
export async function GET() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "ADMIN" && !u.isSuperadmin)) return NextResponse.json({ unread: 0, items: [] }, { status: 403 });
  return NextResponse.json(await getAdminAlerts(u.id, u.orgId), { headers: { "Cache-Control": "no-store" } });
}
