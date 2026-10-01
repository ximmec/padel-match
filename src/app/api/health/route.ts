import { NextResponse } from "next/server";
import { sql } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM schema_migrations`;
    return NextResponse.json({ ok: true, db: "ok", migrations: r.n });
  } catch {
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }
}
