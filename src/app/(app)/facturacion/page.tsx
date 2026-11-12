import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, FileClock, FileText, Plus, Printer, Receipt, Wallet } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { sum } from "@/lib/money";
import { canBill, COLLECTION_STATUS, invoiceLabel } from "@/lib/billing";
import { loadBillableOrders, loadInvoices } from "@/lib/billing-load";
import { InvoiceDialog } from "@/components/billing/invoice-dialog";
import { InvoiceActions } from "@/components/billing/invoice-actions";
import { EInvoiceDialog } from "@/components/billing/einvoice-dialog";
import { CreditNoteButton } from "@/components/billing/credit-note-button";
import { fmtVoucher } from "@/lib/einvoice";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Facturación" };

const FILTERS = [["todas", "Todas"], ["pendientes", "Por cobrar"], ["vencidas", "Vencidas"], ["cobradas", "Cobradas"], ["anuladas", "Anuladas"]] as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "todas" } = await searchParams;
  const s = await requireOrg();
  const [invoices, billable, { data: emissionsData }] = await Promise.all([
    loadInvoices(s.supabase, s.org.org_id), loadBillableOrders(s.supabase, s.org.org_id),
    s.supabase.from("arca_emissions_overview").select("id, kind, voucher_type, point_of_sale, number, issue_date, receiver_name, total, po_label, purchase_order_id, credit_note_id, cae")
      .eq("org_id", s.org.org_id).order("created_at", { ascending: false }).limit(60),
  ]);
  type Em = { id: string; kind: string; voucher_type: number; point_of_sale: number; number: number; issue_date: string; receiver_name: string; total: string; po_label: string | null; purchase_order_id: string | null; credit_note_id: string | null; cae: string };
  const emissions = (emissionsData ?? []) as Em[];
  const bill = canBill(s.org.role);
  const month = todayISO().slice(0, 7);
  const year = todayISO().slice(0, 4);
  const active = invoices.filter((i) => i.status === "emitida");
  const ars = <T extends { currency: string }>(rows: T[]) => rows.filter((r) => r.currency === "ARS");

  const shown = invoices.filter((i) =>
    f === "pendientes" ? i.status === "emitida" && Number(i.balance) > 0
      : f === "vencidas" ? i.collection_status === "vencida"
      : f === "cobradas" ? i.collection_status === "cobrada"
      : f === "anuladas" ? i.status === "anulada" : true);

  const options = billable.map((b) => ({ id: b.purchase_order_id, label: b.order?.label ?? "—", customer: b.order?.customer ?? null, to_invoice: b.to_invoice, currency: b.currency }));

  return (
    <>
      <PageHeader title="Facturación" description="Facturas emitidas a los organismos por cada orden."
        actions={bill && <div className="flex flex-wrap gap-2">
          <InvoiceDialog orders={options} orgId={s.org.org_id} trigger={<Button variant="secondary"><Plus /> Registrar factura hecha afuera</Button>} />
          <EInvoiceDialog trigger={<Button><FileText /> Factura electrónica</Button>} />
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Receipt} label="Facturado este mes" value={formatMoney(sum(ars(active).filter((i) => i.issue_date.startsWith(month)).map((i) => i.total_amount)))} />
        <Stat icon={CalendarCheck} label={`Facturado ${year}`} value={formatMoney(sum(ars(active).filter((i) => i.issue_date.startsWith(year)).map((i) => i.total_amount)))} />
        <Stat icon={FileClock} label="Falta facturar" value={formatMoney(sum(ars(billable).map((b) => b.to_invoice)))} sub={`${billable.length} órdenes`} />
        <Stat icon={Wallet} label="Por cobrar" value={formatMoney(sum(ars(active).map((i) => i.balance)))} href="/cobranzas" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3 sm:px-5">
            {FILTERS.map(([k, label]) => (
              <Link key={k} href={`/facturacion?f=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-medium", f === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{label}</Link>
            ))}
          </div>
          {!shown.length ? (
            <EmptyState icon={<Receipt />} title="Sin facturas" description="Subí el PDF de la factura en los documentos de la orden y se registra sola, o usá “Registrar factura”." />
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((i) => {
                const st = COLLECTION_STATUS[i.collection_status];
                return (
                  <li key={i.invoice_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium"><span className="tabular">{invoiceLabel(i)}</span><Badge tone={st.tone}>{st.label}</Badge></p>
                      <p className="truncate text-xs text-fg-subtle">
                        <Link href={`/ordenes/${i.purchase_order_id}?tab=facturacion`} className="hover:text-fg">{i.order?.label ?? "Orden"}</Link>
                        {" · "}{i.order?.customer ?? "—"} · {formatDate(i.issue_date)}{i.due_date ? ` · vence ${formatDate(i.due_date)}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-sm tabular sm:w-40">
                      <p className={cn("font-medium", i.status === "anulada" && "line-through opacity-60")}>{formatMoney(i.total_amount, i.currency)}</p>
                      {i.status === "emitida" && Number(i.balance) > 0 && Number(i.collected_amount) > 0 && <p className="text-xs text-fg-subtle">saldo {formatMoney(i.balance, i.currency)}</p>}
                    </div>
                    <InvoiceActions canBill={bill} canVoid={i.status === "emitida" && Number(i.collected_amount) === 0} documentId={i.document_id}
                      invoice={{ id: i.invoice_id, label: invoiceLabel(i), balance: i.balance, currency: i.currency, customer: i.order?.customer }} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader title="Para facturar" description="Órdenes con saldo sin facturar" />
          {!billable.length ? <EmptyState title="Todo facturado" /> : (
            <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
              {billable.sort((a, b) => Number(b.to_invoice) - Number(a.to_invoice)).map((b) => (
                <li key={b.purchase_order_id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/ordenes/${b.purchase_order_id}?tab=facturacion`} className="block truncate text-sm font-medium hover:text-brand">{b.order?.label}</Link>
                    <p className="truncate text-xs text-fg-subtle">{b.order?.customer ?? "—"} · {Number(b.invoiced_pct).toFixed(0)}% facturado</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular">{formatMoney(b.to_invoice, b.currency)}</p>
                    {bill && <EInvoiceDialog purchaseOrderId={b.purchase_order_id} trigger={<button className="text-xs text-brand hover:underline">Facturar con ARCA</button>} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {emissions.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader title="Comprobantes electrónicos emitidos" description="Facturas y notas de crédito con CAE emitidas desde la app" />
          <ul className="divide-y divide-border">
            {emissions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium tabular", e.credit_note_id && "line-through opacity-60")}>{fmtVoucher(e.voucher_type, e.point_of_sale, Number(e.number))}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {formatDate(e.issue_date)} · {e.receiver_name}
                    {e.po_label && e.purchase_order_id && <> · <Link href={`/ordenes/${e.purchase_order_id}`} className="hover:text-fg">OC {e.po_label}</Link></>}
                    {" "}· CAE {e.cae}{e.credit_note_id ? " · anulada" : ""}
                  </p>
                </div>
                <p className={cn("font-medium tabular", e.kind === "nota_credito" && "text-danger")}>{e.kind === "nota_credito" ? "−" : ""}{formatMoney(e.total)}</p>
                <a href={`/imprimir/factura/${e.id}`} target="_blank" rel="noreferrer" className="text-fg-subtle hover:text-fg" title="Imprimir / PDF"><Printer className="size-4" /></a>
                {bill && e.kind === "factura" && !e.credit_note_id && <CreditNoteButton id={e.id} label={fmtVoucher(e.voucher_type, e.point_of_sale, Number(e.number))} total={formatMoney(e.total)} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
