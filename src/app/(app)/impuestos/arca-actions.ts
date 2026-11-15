"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { loadApocrifos, refreshSupplierPadron } from "@/lib/tax-sync";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

/** Vincula (o desvincula) una factura emitida de ARCA con una orden de compra. */
export async function linkVoucherToOrder(voucherId: string, poId: string | null): Promise<R> {
  const s = await requireOrg();
  if (!["admin", "finanzas", "compras"].includes(s.org.role)) return { ok: false, error: "Sin permisos" };
  if (!uuid.safeParse(voucherId).success || (poId && !uuid.safeParse(poId).success)) return { ok: false, error: "Datos inválidos" };
  const { error } = await s.supabase.rpc("arca_po_link_set", { p_org: s.org.org_id, p_voucher: voucherId, p_po: poId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impuestos");
  return { ok: true };
}

/** Busca órdenes para vincular a mano (por número de OC, BAC o cliente). */
export async function searchOrders(q: string): Promise<R<{ rows: { id: string; label: string; total: number; date: string | null }[] }>> {
  const s = await requireOrg();
  const t = q.trim().replace(/[%,()]/g, " ").slice(0, 40);
  if (t.length < 2) return { ok: true, rows: [] };
  const { data, error } = await s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, total_amount, issue_date")
    .eq("org_id", s.org.org_id).or(`bac_number.ilike.%${t}%,display_number.ilike.%${t}%,customer_name.ilike.%${t}%`).order("issue_date", { ascending: false }).limit(10);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as { id: string; bac_number: string | null; display_number: string | null; customer_name: string | null; total_amount: number; issue_date: string | null }[])
    .map((o) => ({ id: o.id, label: `${o.bac_number ?? o.display_number} · ${o.customer_name ?? ""}`, total: Number(o.total_amount), date: o.issue_date })) };
}

export async function setJurisdiction(doc: string, jurisdiction: string): Promise<R> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  const d = doc.replace(/\D/g, ""), j = jurisdiction.trim();
  if (!/^\d{11}$/.test(d) || j.length < 2 || j.length > 60) return { ok: false, error: "Datos inválidos" };
  const { error } = await s.supabase.from("customer_jurisdictions").upsert({ org_id: s.org.org_id, doc_number: d, jurisdiction: j, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impuestos");
  return { ok: true };
}

export async function saveAnnualLimit(amount: number | null, label: string): Promise<R> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > 1e14)) return { ok: false, error: "Monto inválido" };
  const { error } = await s.supabase.rpc("tax_annual_limit_save", { p_org: s.org.org_id, p_amount: amount, p_label: label });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impuestos");
  return { ok: true };
}

export async function refreshSuppliersNow(): Promise<R<{ checked: number; warning: string | null }>> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  const [p, a] = await Promise.allSettled([refreshSupplierPadron(s.supabase, s.org.org_id, 40), loadApocrifos(s.supabase)]);
  revalidatePath("/impuestos");
  const warn = [p.status === "fulfilled" ? p.value.error && `Padrón: ${p.value.error}` : `Padrón: ${(p.reason as Error).message}`,
    a.status === "rejected" ? `Apócrifos: ${(a.reason as Error).message}` : null].filter(Boolean).join(" · ");
  return { ok: true, checked: p.status === "fulfilled" ? p.value.checked : 0, warning: warn || null };
}
