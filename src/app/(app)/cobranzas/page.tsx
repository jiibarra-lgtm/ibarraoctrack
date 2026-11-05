import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, HandCoins, Percent, Upload, Wallet } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { sum } from "@/lib/money";
import { canBill, COLLECTION_STATUS, invoiceLabel, METHOD_LABEL, RETENTIONS, type CollectionRow } from "@/lib/billing";
import { loadBillableOrders, loadInvoices, orderRefs } from "@/lib/billing-load";
import { InvoiceDialog } from "@/components/billing/invoice-dialog";
import { Button } from "@/components/ui/button";
import { InvoiceActions, VoidCollectionButton } from "@/components/billing/invoice-actions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cobranzas" };

export default async function CollectionsPage() {
  const s = await requireOrg();
  const sb = s.supabase;
  const year = todayISO().slice(0, 4);
  const month = todayISO().slice(0, 7);
  const [open, { data: cols }, { data: pays }, billable] = await Promise.all([
    loadInvoices(sb, s.org.org_id, { onlyOpen: true }),
    sb.from("collections").select("*, sales_invoices(invoice_type, point_of_sale, number, currency)").eq("org_id", s.org.org_id)
      .order("payment_date", { ascending: false }).limit(200),
    sb.from("bac_payments_overview").select("*").eq("org_id", s.org.org_id).order("notified_at", { ascending: false }).limit(300),
    loadBillableOrders(sb, s.org.org_id),
  ]);
  type Pay = { id: string; invoice_type: string; point_of_sale: string; number: string; invoice_date: string | null; notified_at: string; invoice_loaded: boolean; purchase_order_id: string | null; total_amount: string | null };
  const payments = (pays ?? []) as Pay[];
  const missingDoc = payments.filter((p) => !p.invoice_loaded);
  const orderOptions = billable.map((b) => ({ id: b.purchase_order_id, label: b.order?.label ?? "—", customer: b.order?.customer ?? null, to_invoice: b.to_invoice, currency: b.currency }));
  const collections = (cols ?? []) as (CollectionRow & { sales_invoices: { invoice_type: string; point_of_sale: string | null; number: string | null; currency: string } })[];
  const refs = await orderRefs(sb, collections.map((c) => c.purchase_order_id));
  const bill = canBill(s.org.role);
  const ok = collections.filter((c) => c.status === "confirmado");
  const arsOpen = open.filter((i) => i.currency === "ARS");
  const overdue = arsOpen.filter((i) => i.collection_status === "vencida");
  const sorted = [...open].sort((a, b) => (b.days_overdue ?? -999) - (a.days_overdue ?? -999));

  // Agrupado por organismo
  const byCustomer = new Map<string, { name: string; total: string[]; overdue: string[]; n: number }>();
  arsOpen.forEach((i) => {
    const k = i.customer_id ?? "—";
    const g = byCustomer.get(k) ?? { name: i.order?.customer ?? "Sin organismo", total: [], overdue: [], n: 0 };
    g.total.push(i.balance); if (i.collection_status === "vencida") g.overdue.push(i.balance); g.n++;
    byCustomer.set(k, g);
  });

  return (
    <>
      <PageHeader title="Cobranzas" description="Qué te deben, desde cuándo, y lo que ya cobraste (con retenciones)." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Wallet} label="Por cobrar" value={formatMoney(sum(arsOpen.map((i) => i.balance)))} sub={`${arsOpen.length} facturas`} />
        <Stat icon={AlarmClock} label="Vencido" value={formatMoney(sum(overdue.map((i) => i.balance)))} sub={`${overdue.length} facturas`} tone={overdue.length ? "danger" : undefined} />
        <Stat icon={HandCoins} label="Cobrado este mes" value={formatMoney(sum(ok.filter((c) => c.payment_date.startsWith(month) && c.sales_invoices.currency === "ARS").map((c) => c.amount_received)))} />
        <Stat icon={Percent} label={`Retenciones ${year}`} value={formatMoney(sum(ok.filter((c) => c.payment_date.startsWith(year)).map((c) => c.withholdings)))} sub="Para tu declaración" />
      </div>

      {payments.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader title="Pagos acreditados (avisos de SIGAF)"
            description={missingDoc.length ? `${missingDoc.length} cobrado${missingDoc.length === 1 ? "" : "s"} sin factura cargada: subila y queda todo cerrado solo.` : "Todos con su factura cargada."} />
          <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
            {payments.map((p) => {
              const label = invoiceLabel({ invoice_type: p.invoice_type, point_of_sale: p.point_of_sale, number: p.number });
              return (
                <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="tabular">Factura {label}</span>
                      <Badge tone="accent">Cobrada</Badge>
                      {!p.invoice_loaded && <Badge tone="warn">Falta subir la factura</Badge>}
                    </p>
                    <p className="text-xs text-fg-subtle">Acreditado {formatDate(p.notified_at)}{p.invoice_date ? ` · factura del ${formatDate(p.invoice_date)}` : ""}
                      {p.invoice_loaded && p.purchase_order_id && <> · <Link href={`/ordenes/${p.purchase_order_id}?tab=facturacion`} className="text-brand hover:underline">ver orden</Link></>}</p>
                  </div>
                  {p.invoice_loaded && p.total_amount && <span className="text-sm font-medium tabular">{formatMoney(p.total_amount)}</span>}
                  {!p.invoice_loaded && bill && (
                    <InvoiceDialog orders={orderOptions} orgId={s.org.org_id} title={`Subir factura ${label}`}
                      initial={{ invoice_type: p.invoice_type, point_of_sale: p.point_of_sale, number: p.number, ...(p.invoice_date ? { issue_date: p.invoice_date } : {}) }}
                      trigger={<Button size="sm"><Upload /> Subir factura</Button>} />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Facturas pendientes" description="Las más atrasadas primero" />
          {!sorted.length ? <EmptyState icon={<HandCoins />} title="No te deben nada" description="Cuando registres facturas, acá ves lo pendiente de cobro." /> : (
            <ul className="divide-y divide-border">
              {sorted.map((i) => {
                const st = COLLECTION_STATUS[i.collection_status];
                return (
                  <li key={i.invoice_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{i.order?.customer ?? "—"}</span><Badge tone={st.tone}>{st.label}</Badge></p>
                      <p className="truncate text-xs text-fg-subtle">
                        {invoiceLabel(i)} · <Link href={`/ordenes/${i.purchase_order_id}?tab=facturacion`} className="hover:text-fg">{i.order?.label}</Link> · vence {formatDate(i.due_date)}
                        {i.days_overdue !== null && i.days_overdue > 0 && <span className="font-medium text-danger"> · {i.days_overdue} días de atraso</span>}
                      </p>
                    </div>
                    <p className="text-right text-sm font-medium tabular sm:w-36">{formatMoney(i.balance, i.currency)}</p>
                    <InvoiceActions canBill={bill} canVoid={false} documentId={i.document_id}
                      invoice={{ id: i.invoice_id, label: invoiceLabel(i), balance: i.balance, currency: i.currency, customer: i.order?.customer }} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader title="Por organismo" description="Saldo pendiente" />
          {!byCustomer.size ? <EmptyState title="Sin deuda" /> : (
            <ul className="divide-y divide-border">
              {[...byCustomer.values()].sort((a, b) => Number(sum(b.total)) - Number(sum(a.total))).map((g) => (
                <li key={g.name} className="px-4 py-3 sm:px-5">
                  <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm">{g.name}</span><span className="shrink-0 text-sm font-medium tabular">{formatMoney(sum(g.total))}</span></div>
                  <p className="text-xs text-fg-subtle">{g.n} factura{g.n === 1 ? "" : "s"}{g.overdue.length ? <span className="text-danger"> · vencido {formatMoney(sum(g.overdue))}</span> : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Cobros registrados" description="Importe recibido en banco + retenciones = lo que cancela de cada factura" />
        {!collections.length ? <EmptyState title="Sin cobros todavía" /> : (
          <ul className="divide-y divide-border">
            {collections.map((c) => (
              <li key={c.id} className={cn("flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5", c.status === "anulado" && "opacity-55")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{refs.get(c.purchase_order_id)?.customer ?? "—"} · {invoiceLabel(c.sales_invoices)}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {formatDate(c.payment_date)} · {METHOD_LABEL[c.method] ?? c.method}{c.reference ? ` · ${c.reference}` : ""}
                    {Number(c.withholdings) > 0 && ` · retenciones: ${RETENTIONS.filter(([k]) => Number(c[k]) > 0).map(([k, l]) => `${l} ${formatMoney(c[k], c.sales_invoices.currency)}`).join(", ")}`}
                    {c.status === "anulado" && ` · anulado: ${c.void_reason}`}
                  </p>
                </div>
                <div className="text-right tabular sm:w-40">
                  <p className={cn("text-sm font-medium", c.status === "anulado" && "line-through")}>{formatMoney(c.amount_received, c.sales_invoices.currency)}</p>
                  {Number(c.withholdings) > 0 && <p className="text-xs text-fg-subtle">cancela {formatMoney(c.applied_amount, c.sales_invoices.currency)}</p>}
                </div>
                {bill && c.status === "confirmado" && <VoidCollectionButton id={c.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
