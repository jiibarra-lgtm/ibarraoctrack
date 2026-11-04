import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShoppingCart, Upload } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { DOC_TYPES } from "@/lib/purchase/schema";

export const metadata: Metadata = { title: "Compras" };
const DOC = Object.fromEntries(DOC_TYPES);

export default async function PurchasesPage() {
  const s = await requireOrg();
  const { data: rows } = await s.supabase
    .from("purchases")
    .select("id, doc_type, point_of_sale, number, invoice_date, total_amount, net_amount, currency, status, paid, suppliers(name), purchase_items(id, purchase_allocations(id))")
    .eq("org_id", s.org.org_id).order("invoice_date", { ascending: false }).limit(300);
  const writable = canWrite(s.org.role);

  return (
    <>
      <PageHeader
        title="Compras"
        description="Facturas de proveedores y a qué órdenes abastecen."
        actions={writable && (<>
          <Button asChild variant="secondary"><Link href="/compras/importar"><Upload /> Subir factura</Link></Button>
          <Button asChild><Link href="/compras/nueva"><Plus /> Nueva</Link></Button>
        </>)}
      />
      <Card className="overflow-hidden">
        {!rows?.length ? (
          <EmptyState icon={<ShoppingCart />} title="Todavía no hay compras" description="Subí la foto o el PDF de una factura de proveedor y la leemos."
            action={writable && <Button asChild><Link href="/compras/importar"><Upload /> Subir factura</Link></Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((p) => {
              const items = (p.purchase_items ?? []) as { purchase_allocations: unknown[] }[];
              const linked = items.filter((i) => i.purchase_allocations?.length).length;
              return (
                <li key={p.id}>
                  <Link href={`/compras/${p.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{(p.suppliers as unknown as { name: string } | null)?.name ?? "—"}</p>
                      <p className="text-xs text-fg-subtle">{DOC[p.doc_type] ?? p.doc_type} {p.point_of_sale ? `${p.point_of_sale}-` : ""}{p.number ?? "s/n"} · {formatDate(p.invoice_date)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.status === "anulada" && <Badge tone="danger">Anulada</Badge>}
                      <Badge tone={linked === items.length && items.length ? "accent" : linked ? "warn" : "neutral"}>{linked}/{items.length} vinculados</Badge>
                      {p.paid && <Badge tone="info">Pagada</Badge>}
                    </div>
                    <span className="text-sm font-medium tabular sm:w-36 sm:text-right">{formatMoney(p.total_amount, p.currency)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
