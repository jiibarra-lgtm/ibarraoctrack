import { Package } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";

/** Catálogo que se arma solo con las compras vinculadas a renglones de OC. */
export async function Catalog({ supabase, org }: { supabase: SupabaseClient; org: string }) {
  const s = { supabase, org: { org_id: org } };
  const [{ data: products }, { data: sales }, { data: buys }, { data: fs }] = await Promise.all([
    s.supabase.from("products").select("id, internal_code, bac_code, description, unit, product_aliases(alias, suppliers(name))").eq("org_id", s.org.org_id).order("description").limit(1000),
    s.supabase.from("purchase_order_items").select("product_id, unit_price").eq("org_id", s.org.org_id).not("product_id", "is", null),
    s.supabase.from("purchase_items").select("product_id, unit_price, discount_pct, purchases!inner(invoice_date, status)").eq("org_id", s.org.org_id).not("product_id", "is", null),
    s.supabase.from("financial_settings").select("sales_include_vat, default_vat_rate").eq("org_id", s.org.org_id).maybeSingle(),
  ]);
  const div = fs?.sales_include_vat === false ? 1 : 1 + Number(fs?.default_vat_rate ?? 21) / 100;
  const sale = new Map<string, number[]>();
  (sales ?? []).forEach((r) => sale.set(r.product_id!, [...(sale.get(r.product_id!) ?? []), Number(r.unit_price)]));
  type B = { product_id: string; unit_price: string; discount_pct: string; purchases: { invoice_date: string; status: string } };
  const last = new Map<string, { cost: number; date: string }>();
  ((buys ?? []) as unknown as B[]).filter((b) => b.purchases.status === "confirmada").forEach((b) => {
    const cur = last.get(b.product_id);
    if (!cur || cur.date < b.purchases.invoice_date) last.set(b.product_id, { cost: Number(b.unit_price) * (1 - Number(b.discount_pct) / 100), date: b.purchases.invoice_date });
  });

  return (
    <>
      <p className="mb-3 text-sm text-fg-muted">El catálogo se arma solo: cada vez que vinculás una compra con un renglón de OC, el producto y la equivalencia con la descripción del proveedor quedan guardados.</p>
      <Card className="overflow-hidden">
        {!products?.length ? <EmptyState icon={<Package />} title="Catálogo vacío" description="Vinculá la primera compra con una orden y aparecen los productos." /> : (
          <ul className="divide-y divide-border">
            {products.map((p) => {
              const prices = sale.get(p.id) ?? [];
              const avgSale = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
              const l = last.get(p.id);
              const aliases = (p.product_aliases ?? []) as unknown as { alias: string; suppliers: { name: string } | null }[];
              return (
                <li key={p.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium">{p.description}</p>
                    <p className="text-xs text-fg-subtle"><span className="font-mono">{p.bac_code ?? p.internal_code ?? "s/código"}</span>{l ? ` · última compra ${formatDate(l.date)}` : ""}</p>
                    {aliases.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{aliases.slice(0, 4).map((a, i) => <Badge key={i} tone="info">{a.alias}{a.suppliers ? ` (${a.suppliers.name})` : ""}</Badge>)}</div>}
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-right text-xs sm:w-80">
                    <div><p className="text-fg-subtle">Venta prom.</p><p className="tabular text-sm">{avgSale ? formatMoney(avgSale.toFixed(2)) : "—"}</p></div>
                    <div><p className="text-fg-subtle">Último costo</p><p className="tabular text-sm">{l ? formatMoney(l.cost.toFixed(2)) : "—"}</p></div>
                    <div><p className="text-fg-subtle">Margen bruto*</p><p className="tabular text-sm">{avgSale && l ? `${(((avgSale / div - l.cost) / (avgSale / div)) * 100).toFixed(1)}%` : "—"}</p></div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="mt-2 text-xs text-fg-subtle">* Margen indicativo: precio de venta promedio sin IVA contra el último costo neto.</p>
    </>
  );
}
