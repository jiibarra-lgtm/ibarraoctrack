import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/** Botones de la notificación ("Hecho", "En 1 hora", "Mañana"): sin sesión, con el token propio del recordatorio. */
const Body = z.object({
  id: z.string().uuid(), token: z.string().uuid(),
  action: z.enum(["done", "snooze"]), minutes: z.number().int().min(5).max(60 * 24 * 31).optional(),
});

export async function POST(req: NextRequest) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.rpc("reminder_act_token", { p_id: p.data.id, p_token: p.data.token, p_action: p.data.action, p_minutes: p.data.minutes ?? null });
  if (error) return NextResponse.json({ error: "No se pudo" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
