import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { REPORTS } from "@/lib/reports";
import { todayISO } from "@/lib/format";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const s = await getSession();
  if (!s?.org) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const def = REPORTS[tipo];
  if (!def) return NextResponse.json({ error: "Reporte inexistente" }, { status: 404 });
  const from = req.nextUrl.searchParams.get("desde") ?? undefined;
  const to = req.nextUrl.searchParams.get("hasta") ?? undefined;
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  try {
    const csv = await def.build(s.supabase, s.org.org_id, { from, to });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="oc-track-${tipo}-${todayISO()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
