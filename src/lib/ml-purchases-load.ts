import type { SupabaseClient } from "@supabase/supabase-js";
import type { MlInvoice, MlOrder, MlReturn } from "@/lib/ml-purchases";

/** Mes "YYYY-MM" en hora argentina. */
export const arYm = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 7) : "");
export const currentArYm = () => arYm(new Date().toISOString());
export const monthRange = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 3)).toISOString();
  const end = new Date(Date.UTC(y, m, 1, 3)).toISOString();
  return { start, end, startDay: start.slice(0, 10), endDay: end.slice(0, 10) };
};
export const lastMonths = (n: number, from = currentArYm()) => {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
};

/** Compras de ML del mes, sus facturas (con IVA y percepciones de ARCA) y las devoluciones. */
export async function loadMlPurchases(sb: SupabaseClient, org: string, ym: string) {
  const r = monthRange(ym);
  // las facturas pueden llegar hasta 20 días después de la compra
  const invEnd = new Date(Date.parse(r.end) + 20 * 864e5).toISOString().slice(0, 10);
  const invStart = new Date(Date.parse(r.start) - 5 * 864e5).toISOString().slice(0, 10);
  const [orders, invoices, returns] = await Promise.all([
    sb.from("ml_orders").select("id, title, quantity, total_amount, counterpart, status, ordered_at, delivered_at, eta, invoice_available, created_at")
      .eq("org_id", org).eq("kind", "compra").is("merged_into", null).or(`and(ordered_at.gte.${r.start},ordered_at.lt.${r.end}),and(ordered_at.is.null,created_at.gte.${r.start},created_at.lt.${r.end})`).order("ordered_at", { ascending: false, nullsFirst: false }).limit(2000),
    sb.from("supplier_invoices").select("id, mail_subject, supplier_name, letter, total, net, issue_date, arca_vouchers(vat, other_taxes), supplier_invoice_items(description)")
      .eq("org_id", org).eq("source", "mercadolibre").gte("issue_date", invStart).lt("issue_date", invEnd).limit(2000),
    sb.from("ml_returns").select("id, title, stage, start_deadline, ship_deadline, protected_until, refunded_at, ml_order_id, bank_movement_id, first_seen_at")
      .eq("org_id", org).order("first_seen_at", { ascending: false }).limit(500),
  ]);
  type InvRow = Omit<MlInvoice, "vat" | "other_taxes" | "items"> & {
    arca_vouchers: { vat: number | null; other_taxes: number | null } | { vat: number | null; other_taxes: number | null }[] | null;
    supplier_invoice_items: { description: string | null }[] | null;
  };
  const inv: MlInvoice[] = ((invoices.data ?? []) as unknown as InvRow[]).map((i) => {
    const a = Array.isArray(i.arca_vouchers) ? i.arca_vouchers[0] : i.arca_vouchers;
    return {
      id: i.id, mail_subject: i.mail_subject, supplier_name: i.supplier_name, letter: i.letter, total: i.total, net: i.net, issue_date: i.issue_date,
      vat: a?.vat != null ? Number(a.vat) : null, other_taxes: a?.other_taxes != null ? Number(a.other_taxes) : null,
      items: (i.supplier_invoice_items ?? []).map((x) => x.description ?? ""),
    };
  });
  const allReturns = (returns.data ?? []) as (MlReturn & { first_seen_at: string })[];
  return {
    orders: (orders.data ?? []) as MlOrder[],
    invoices: inv,
    // devoluciones abiertas siempre; cerradas solo las del mes
    returns: allReturns.filter((x) => x.stage !== "reembolsada" || arYm(x.refunded_at ?? x.first_seen_at) === ym),
    allReturns,
  };
}
