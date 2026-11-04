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

export async function updateFinancialSettings(_: unknown, form: FormData): Promise<{ ok?: boolean; error?: string } | null> {
  const s = await requireOrg();
  if (s.org.role !== "admin" && s.org.role !== "finanzas") return { error: "Sólo administración o finanzas." };
  const parsed = z.object({
    vat_recoverable: z.enum(["si", "no"]),
    sales_include_vat: z.enum(["si", "no"]),
    default_vat_rate: z.coerce.number().min(0).max(100),
    min_margin_pct: z.coerce.number().min(-100).max(1000),
    default_allocation: z.enum(["importe", "unidades"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá los valores." };
  const d = parsed.data;
  const { error } = await s.supabase.from("financial_settings").upsert({
    org_id: s.org.org_id, vat_recoverable: d.vat_recoverable === "si", sales_include_vat: d.sales_include_vat === "si",
    default_vat_rate: d.default_vat_rate, min_margin_pct: d.min_margin_pct, default_allocation: d.default_allocation,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}
