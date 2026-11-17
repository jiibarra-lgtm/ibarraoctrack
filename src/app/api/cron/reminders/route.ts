import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendDueReminders } from "@/lib/reminder-push";

/** Lo llama la base (pg_cron) cada minuto que hay un recordatorio vencido. La clave se valida en la base. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  if (key.length < 32 || key.length > 200) return NextResponse.json({ error: "Sin clave" }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await sendDueReminders(sb, key);
  if ("error" in r) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json(r);
}
