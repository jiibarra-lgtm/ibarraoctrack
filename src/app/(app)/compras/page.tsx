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
  // Facturas de proveedores que llegaron por mail (se leen solas y alimentan Precios de proveedores y Stock)
  const { data: mail } = await s.supabase.from("supplier_invoices").select("id, supplier_name, letter, point_of_sale, number, issue_date, total, kind")
    .eq("org_id", s.org.org_id).eq("hidden", false).order("issue_date", { ascending: false, nullsFirst: false }).limit(40);

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
          <EmptyState icon={<ShoppingCart />} title="Todavía no hay compras vinculadas a órdenes" description="Subí la foto o el PDF de una factura de proveedor para repartirla entre las OC. Las que llegan por mail están abajo."
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
      {(mail ?? []).length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <div>
              <p className="font-semibold">Facturas que llegaron por mail</p>
              <p className="text-xs text-fg-subtle">Se leen solas: sus precios están en Precios de proveedores y los productos ya entraron al stock. Para el costo de una OC usá el botón &quot;De compras&quot; del renglón.</p>
            </div>
            <Button asChild size="sm" variant="secondary"><Link href="/precios-proveedores?t=facturas">Ver todas</Link></Button>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {(mail ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{x.supplier_name ?? "—"}</p>
                  <p className="text-xs text-fg-subtle">{x.kind === "factura" ? "Factura" : x.kind ?? "Comprobante"} {x.letter ?? ""} {x.point_of_sale ? `${String(x.point_of_sale).padStart(5, "0")}-${String(x.number ?? 0).padStart(8, "0")}` : "s/n"} · {x.issue_date ? formatDate(x.issue_date) : "sin fecha"}</p>
                </div>
                <span className="font-medium tabular">{formatMoney(x.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
