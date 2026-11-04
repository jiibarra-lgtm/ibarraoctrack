import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processImportJob } from "@/lib/import/process";
import { isUuid } from "@/lib/utils";

// Extracción con IA puede tardar: se ejecuta en su propia invocación, no en la subida.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Importación inválida" }, { status: 400 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const outcome = await processImportJob(supabase, id);
  return NextResponse.json(outcome, { status: outcome.status === "error" ? 422 : 200 });
}
