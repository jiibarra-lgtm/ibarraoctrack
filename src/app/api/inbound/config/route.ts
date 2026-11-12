import { after, NextResponse, type NextRequest } from "next/server";
import { runMlTasks } from "@/lib/ml-tasks";
import { tokenRpc, tokenStockRpc } from "@/lib/ml-rpc";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GMAIL_SOURCES, GMAIL_SOURCES_VERSION } from "@/lib/inbound/gmail-sources";

/** El script de Gmail pide acá qué tiene que buscar (así no hay que volver a pegarlo cuando se agrega algo). */
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
  const check = await sb.rpc("ingest_supplier_invoices", { p_token: token, p_invoices: [] });
  if (check.error) return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  // Cada corrida del script (10 min): reposición de stock y facturas de Mercado Libre, después de responder
  after(() => runMlTasks(tokenRpc(token), tokenStockRpc(token), { sync: true }).catch(() => null));
  return NextResponse.json({ version: GMAIL_SOURCES_VERSION, sources: GMAIL_SOURCES });
}
