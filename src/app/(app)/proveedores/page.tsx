import type { Metadata } from "next";
import Link from "next/link";
import { Factory } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SupplierDialog } from "./supplier-dialog";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const s = await requireOrg();
  const [{ data: suppliers }, { data: purchases }] = await Promise.all([
    s.supabase.from("suppliers").select("*").eq("org_id", s.org.org_id).order("name"),
    s.supabase.from("purchases").select("id, supplier_id, invoice_date, net_amount, due_date, paid, purchase_items(description, unit_price, discount_pct, quantity)")
      .eq("org_id", s.org.org_id).eq("status", "confirmada").order("invoice_date", { ascending: false }).limit(2000),
  ]);
  type P = { id: string; supplier_id: string; invoice_date: string; net_amount: string; paid: boolean; purchase_items: { description: string; unit_price: string; discount_pct: string; quantity: string }[] };
  const bySup = new Map<string, P[]>();
  ((purchases ?? []) as P[]).forEach((p) => bySup.set(p.supplier_id, [...(bySup.get(p.supplier_id) ?? []), p]));
  const writable = canWrite(s.org.role);
  const selected = suppliers?.find((x) => x.id === id);

  return (
    <>
      <PageHeader title="Proveedores" description="Historial de compras y precios por proveedor." actions={writable && <SupplierDialog />} />
      <div className={cn("grid gap-5", selected && "lg:grid-cols-[minmax(0,1fr)_440px]")}>
        <Card className="self-start overflow-hidden">
          {!suppliers?.length ? <EmptyState icon={<Factory />} title="Sin proveedores" description="Se crean solos al cargar facturas, o agregalos acá." /> : (
            <ul className="divide-y divide-border">
              {suppliers.map((sp) => {
                const ps = bySup.get(sp.id) ?? [];
                const unpaid = ps.filter((p) => !p.paid).length;
                return (
                  <li key={sp.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", id === sp.id && "bg-info-soft/50")}>
                    <Link href={`/proveedores?id=${sp.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{sp.name} {sp.rating ? <span className="text-xs text-warn">{"★".repeat(sp.rating)}</span> : null}</p>
                      <p className="truncate text-xs text-fg-subtle">{[sp.cuit, sp.payment_terms, ps[0] ? `última compra ${formatDate(ps[0].invoice_date)}` : "sin compras"].filter(Boolean).join(" · ")}</p>
                    </Link>
                    <div className="hidden text-right text-xs sm:block">
                      <p className="text-sm font-medium tabular">{formatMoney(sum(ps.map((p) => p.net_amount)))}</p>
                      <p className="text-fg-subtle">{ps.length} compras{unpaid ? ` · ${unpaid} impagas` : ""}</p>
                    </div>
                    {writable && <SupplierDialog supplier={sp} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {selected && (
          <Card className="self-start">
            <CardHeader title={selected.name} description="Precios pagados (neto unitario, con bonificación)" />
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {(bySup.get(selected.id) ?? []).flatMap((p) => p.purchase_items.map((it, k) => (
                <li key={`${p.id}-${k}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{it.description}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">{formatDate(p.invoice_date)}</span>
                  <span className="w-28 shrink-0 text-right tabular">{formatMoney((Number(it.unit_price) * (1 - Number(it.discount_pct) / 100)).toFixed(2))}</span>
                </li>
              )))}
              {!(bySup.get(selected.id) ?? []).length && <li className="px-4 py-6 text-sm text-fg-subtle">Sin compras registradas.</li>}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
