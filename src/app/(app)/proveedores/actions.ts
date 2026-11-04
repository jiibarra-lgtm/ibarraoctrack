"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";

const schema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Ingresá la razón social").max(200),
  cuit: z.string().trim().regex(/^(\d{2}-?\d{8}-?\d)?$/, "CUIT inválido"),
  phone: z.string().trim().max(60), email: z.string().trim().max(120), address: z.string().trim().max(300),
  payment_terms: z.string().trim().max(200), notes: z.string().trim().max(2000),
  rating: z.string().regex(/^[1-5]?$/),
});

export async function saveSupplier(_: unknown, form: FormData) {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { error: "Tu rol no permite editar proveedores." };
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, rating, ...d } = parsed.data;
  const cuit = d.cuit ? d.cuit.replace(/\D/g, "").replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3") : null;
  const row = { ...d, cuit, rating: rating ? Number(rating) : null, phone: d.phone || null, email: d.email || null, address: d.address || null, payment_terms: d.payment_terms || null, notes: d.notes || null };
  const q = id
    ? s.supabase.from("suppliers").update(row).eq("id", id).eq("org_id", s.org.org_id)
    : s.supabase.from("suppliers").insert({ ...row, org_id: s.org.org_id, created_by: s.userId });
  const { error } = await q;
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/proveedores");
  return { ok: true };
}
