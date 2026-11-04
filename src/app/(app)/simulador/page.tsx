import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { Simulator, type ProductCost } from "./simulator";

export const metadata: Metadata = { title: "Simulador" };

export default async function SimulatorPage() {
  const s = await requireOrg();
  const [{ data: fs }, { data: items }] = await Promise.all([
    s.supabase.from("financial_settings").select("sales_include_vat, default_vat_rate, min_margin_pct").eq("org_id", s.org.org_id).maybeSingle(),
    s.supabase.from("purchase_items").select("product_id, unit_price, discount_pct, created_at, products(name), purchases!inner(invoice_date, status)")
      .eq("org_id", s.org.org_id).not("product_id", "is", null).eq("purchases.status", "confirmada").order("created_at", { ascending: false }).limit(3000),
  ]);
  // Último costo comprado por producto
  const last = new Map<string, ProductCost>();
  (items ?? []).forEach((i) => {
    const id = i.product_id as string;
    if (last.has(id)) return;
    const net = Number(i.unit_price) * (1 - Number(i.discount_pct ?? 0) / 100);
    last.set(id, { id, name: (i.products as unknown as { name: string } | null)?.name ?? "Producto", cost: net.toFixed(2), date: (i.purchases as unknown as { invoice_date: string }).invoice_date });
  });
  return (
    <>
      <PageHeader title="Simulador" description="Probá precio y costo antes de cotizar: cuánto ganás y cuál es el precio mínimo." />
      <Simulator includeVat={fs?.sales_include_vat ?? true} vatRate={String(fs?.default_vat_rate ?? "21")} minMargin={String(fs?.min_margin_pct ?? "15")}
        products={[...last.values()].sort((a, b) => a.name.localeCompare(b.name))} />
    </>
  );
}
