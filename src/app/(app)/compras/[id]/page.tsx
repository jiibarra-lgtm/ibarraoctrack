import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { DOC_TYPES } from "@/lib/purchase/schema";
import { isUuid } from "@/lib/utils";
import { DocumentButton } from "@/app/(app)/ordenes/[id]/document-button";
import { VoidButton } from "./void-button";

export const metadata: Metadata = { title: "Compra" };
const DOC = Object.fromEntries(DOC_TYPES);

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const s = await requireOrg();
  const { data: p } = await s.supabase.from("purchases")
    .select("*, suppliers(id, name, cuit), purchase_items(*, purchase_allocations(id, quantity, unit_cost, amount, purchase_order_id, purchase_order_items(line_number, description_original, purchase_orders(id, bac_number, internal_number))))")
    .eq("id", id).eq("org_id", s.org.org_id).maybeSingle();
  if (!p) notFound();
  const sup = p.suppliers as unknown as { id: string; name: string; cuit: string | null };
  type Alloc = { id: string; quantity: string; unit_cost: string; amount: string; purchase_order_id: string; purchase_order_items: { line_number: number; description_original: string; purchase_orders: { id: string; bac_number: string | null; internal_number: number } } };
  const items = ((p.purchase_items ?? []) as (Record<string, string> & { purchase_allocations: Alloc[] })[]).sort((a, b) => Number(a.line_number) - Number(b.line_number));

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/compras" className="hover:text-fg">Compras</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{sup?.name} {p.status === "anulada" && <Badge tone="danger">Anulada</Badge>}</span>}
        description={`${DOC[p.doc_type] ?? p.doc_type} ${p.point_of_sale ? `${p.point_of_sale}-` : ""}${p.number ?? "s/n"} · ${formatDate(p.invoice_date)}${sup?.cuit ? ` · CUIT ${sup.cuit}` : ""}`}
        actions={<>
          {p.document_id && <DocumentButton documentId={p.document_id} label="Ver comprobante" />}
          {canWrite(s.org.role) && p.status !== "anulada" && <VoidButton id={p.id} />}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Neto", p.net_amount], ["IVA", p.vat_amount], ["Otros impuestos", p.other_taxes], ["Total", p.total_amount]].map(([l, v]) => (
          <Card key={l} className="px-4 py-3"><p className="text-xs text-fg-muted">{l}</p><p className="mt-1 text-lg font-semibold tabular">{formatMoney(v, p.currency)}</p></Card>
        ))}
      </div>
      <Card className="mt-5">
        <CardHeader title="Renglones y órdenes abastecidas" description="El costo unitario queda congelado al asignar: cambios de precio posteriores no alteran el histórico." />
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const allocated = it.purchase_allocations.reduce((a, x) => a + Number(x.quantity), 0);
            return (
              <li key={it.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{it.description}</p>
                  <p className="text-sm tabular">{formatQty(it.quantity)} {it.unit} × {formatMoney(it.unit_price)}{Number(it.discount_pct) > 0 ? ` − ${it.discount_pct}%` : ""} = <span className="font-medium">{formatMoney(it.net_amount)}</span></p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {it.purchase_allocations.map((a) => (
                    <Link key={a.id} href={`/ordenes/${a.purchase_order_id}?tab=compras`} className="rounded-md border border-border bg-surface-2/60 px-2.5 py-1 text-xs hover:border-border-strong">
                      <span className="font-medium">{a.purchase_order_items.purchase_orders.bac_number ?? `OC-${String(a.purchase_order_items.purchase_orders.internal_number).padStart(6, "0")}`}</span>
                      {" "}· R{a.purchase_order_items.line_number} · {formatQty(a.quantity)} u · {formatMoney(a.amount)}
                    </Link>
                  ))}
                  {allocated < Number(it.quantity) && <Badge tone="neutral">{formatQty(Number(it.quantity) - allocated)} sin vincular</Badge>}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {p.notes && <Card className="mt-5"><CardBody className="whitespace-pre-wrap text-sm">{p.notes}</CardBody></Card>}
    </>
  );
}
