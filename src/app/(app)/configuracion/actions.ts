"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";

export async function updateOrg(_: unknown, form: FormData): Promise<{ ok?: boolean; error?: string } | null> {
  const s = await requireOrg();
  if (s.org.role !== "admin") return { error: "Sólo administradores." };
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    legal_name: z.string().trim().max(200),
    cuit: z.string().trim().regex(/^(\d{2}-?\d{8}-?\d)?$/, "CUIT inválido"),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await s.supabase.from("organizations").update({
    name: parsed.data.name, legal_name: parsed.data.legal_name || null, cuit: parsed.data.cuit || null,
  }).eq("id", s.org.org_id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}
