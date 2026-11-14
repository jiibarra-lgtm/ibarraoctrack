import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/session";
import { backupToXlsx } from "@/lib/backup";
import { todayISO } from "@/lib/format";

export const maxDuration = 60;

/** Descarga de la copia de seguridad completa (admin / finanzas). */
export async function GET() {
  const s = await requireOrg();
  const { data, error } = await s.supabase.rpc("backup_dump_org", { p_org: s.org.org_id });
  if (error || !data) return NextResponse.json({ error: "Sin permisos para descargar la copia" }, { status: 403 });
  const today = todayISO();
  return new NextResponse(Buffer.from(backupToXlsx(data, today)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="oc-track-backup-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
