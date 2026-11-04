"use client";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { COLLECTION_STATUS, invoiceLabel, METHOD_LABEL, type CollectionRow, type InvoiceBalance, type PoBilling } from "@/lib/billing";
import { InvoiceDialog, type BillableOrder } from "@/components/billing/invoice-dialog";
import { InvoiceActions, VoidCollectionButton } from "@/components/billing/invoice-actions";
import { cn } from "@/lib/utils";

function Box({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "accent" }) {
  return (
    <div className="glass rounded-2xl px-4 py-3.5">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular", tone === "danger" && "text-danger", tone === "accent" && "text-accent")}>{value}</p>
      {sub && <p className="truncate text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}

export function OrderBilling({ billing, invoices, collections, order, orgId, canBill, cur }: {
  billing: PoBilling | null; invoices: InvoiceBalance[]; collections: CollectionRow[]; order: BillableOrder; orgId: string; canBill: boolean; cur: string;
}) {
  const b = billing;
  const byInvoice = new Map(invoices.map((i) => [i.invoice_id, i]));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Box label="Facturado" value={formatMoney(b?.invoiced_amount ?? 0, cur)} sub={`${Number(b?.invoiced_pct ?? 0).toFixed(0)}% de la orden`} />
        <Box label="Falta facturar" value={formatMoney(b?.to_invoice ?? 0, cur)} />
        <Box label="Cobrado" value={formatMoney(b?.collected_amount ?? 0, cur)} sub={`${Number(b?.collected_pct ?? 0).toFixed(0)}% · retenciones ${formatMoney(b?.withholdings ?? 0, cur)}`} tone="accent" />
        <Box label="Saldo por cobrar" value={formatMoney(b?.to_collect ?? 0, cur)} sub={Number(b?.overdue_amount ?? 0) > 0 ? `Vencido ${formatMoney(b?.overdue_amount, cur)}` : "Al día"} tone={Number(b?.overdue_amount ?? 0) > 0 ? "danger" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Facturas" description="Subí el PDF en Documentos → Factura y se registra solo, o cargala acá."
          action={canBill && Number(order.to_invoice) > 0 && <InvoiceDialog orders={[order]} orgId={orgId} defaultOrderId={order.id} trigger={<Button size="sm"><Plus /> Factura</Button>} />} />
        {!invoices.length ? <EmptyState icon={<Receipt />} title="Sin facturas" /> : (
          <ul className="divide-y divide-border">
            {invoices.map((i) => {
              const st = COLLECTION_STATUS[i.collection_status];
              return (
                <li key={i.invoice_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium"><span className="tabular">{invoiceLabel(i)}</span><Badge tone={st.tone}>{st.label}</Badge></p>
                    <p className="text-xs text-fg-subtle">{formatDate(i.issue_date)}{i.due_date ? ` · vence ${formatDate(i.due_date)}` : ""}{Number(i.collected_amount) > 0 ? ` · cobrado ${formatMoney(i.collected_amount, cur)}` : ""}</p>
                  </div>
                  <p className={cn("text-right text-sm font-medium tabular sm:w-36", i.status === "anulada" && "line-through opacity-60")}>{formatMoney(i.total_amount, cur)}</p>
                  <InvoiceActions canBill={canBill} canVoid={i.status === "emitida" && Number(i.collected_amount) === 0} documentId={i.document_id}
                    invoice={{ id: i.invoice_id, label: invoiceLabel(i), balance: i.balance, currency: cur }} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {collections.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Cobros" />
          <ul className="divide-y divide-border">
            {collections.map((c) => {
              const inv = byInvoice.get(c.invoice_id);
              return (
                <li key={c.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", c.status === "anulado" && "opacity-55")}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{formatDate(c.payment_date)} · {METHOD_LABEL[c.method] ?? c.method}{inv ? ` · ${invoiceLabel(inv)}` : ""}</p>
                    <p className="truncate text-xs text-fg-subtle">{Number(c.withholdings) > 0 ? `Retenciones ${formatMoney(c.withholdings, cur)} · ` : ""}{c.reference ?? ""}{c.status === "anulado" ? ` Anulado: ${c.void_reason}` : ""}</p>
                  </div>
                  <span className={cn("text-sm font-medium tabular", c.status === "anulado" && "line-through")}>{formatMoney(c.amount_received, cur)}</span>
                  {canBill && c.status === "confirmado" && <VoidCollectionButton id={c.id} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
