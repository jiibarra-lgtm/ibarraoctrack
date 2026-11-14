import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { backupToXlsx } from "@/lib/backup";
import { todayISO } from "@/lib/format";

/** Copia de seguridad semanal: la pide el script de Gmail con su clave y la guarda en el Drive del usuario. */
const Body = z.object({ token: z.string().min(32).max(200) });

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let token: string;
  try {
    token = Body.parse(await req.json()).token;
  } catch {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("backup_dump", { p_token: token });
  if (error || !data) return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  const today = todayISO();
  const bytes = backupToXlsx(data, today);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="oc-track-backup-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
