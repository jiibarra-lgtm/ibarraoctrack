import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Scale, Receipt } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { dec, sum } from "@/lib/money";
import { AGING, canBill } from "@/lib/billing";
import { loadInvoices, loadMonthlyFlows } from "@/lib/billing-load";
import { SeriesChart } from "@/components/charts/series-chart";
import { PaidToggle } from "@/components/billing/paid-toggle";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Finanzas" };

export default async function FinancePage() {
  const s = await requireOrg();
  const sb = s.supabase;
  const today = todayISO();
  const [open, flows, { data: payables }, { data: bankRows }] = await Promise.all([
    loadInvoices(sb, s.org.org_id, { onlyOpen: true }),
    loadMonthlyFlows(sb, s.org.org_id, "ARS", 12),
    sb.from("purchases").select("id, point_of_sale, number, invoice_date, due_date, total_amount, currency, suppliers(name)")
      .eq("org_id", s.org.org_id).eq("status", "confirmada").eq("paid", false).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
    sb.from("bank_movements_overview").select("*").eq("org_id", s.org.org_id).order("mov_date", { ascending: false }).limit(300),
  ]);
  type Mov = { id: string; mov_date: string; detail: string; amount: string; kind: string; status: string; status_note: string | null; payments_count: number; invoices: string | null };
  const bank = (bankRows ?? []) as Mov[];
  const gcba = bank.filter((m) => m.kind === "gcba");
  const sircrebMonth = sum(bank.filter((m) => m.kind === "sircreb" && m.mov_date.startsWith(today.slice(0, 7))).map((m) => m.amount));
  const sircrebYear = sum(bank.filter((m) => m.kind === "sircreb" && m.mov_date.startsWith(today.slice(0, 4))).map((m) => m.amount));
  const MOV_STATUS: Record<string, { label: string; tone: "accent" | "warn" | "danger" | "neutral" }> = {
    conciliado: { label: "Conciliado", tone: "accent" }, faltan_facturas: { label: "Faltan facturas", tone: "warn" },
    sin_avisos: { label: "Sin aviso de SIGAF", tone: "neutral" }, revisar: { label: "Revisar", tone: "danger" }, pendiente: { label: "Pendiente", tone: "neutral" },
  };
  const ars = open.filter((i) => i.currency === "ARS");
  const pay = (payables ?? []).filter((p) => p.currency === "ARS");
  const receivable = sum(ars.map((i) => i.balance));
  const payable = sum(pay.map((p) => p.total_amount));
  const net = dec(receivable).minus(payable).toFixed(2);
  const month = flows[flows.length - 1];
  const canPay = canBill(s.org.role) || s.org.role === "compras";

  // Antigüedad por organismo
  const rows = new Map<string, { name: string; buckets: string[][] }>();
  ars.forEach((i) => {
    const k = i.customer_id ?? "—";
    const r = rows.get(k) ?? { name: i.order?.customer ?? "Sin organismo", buckets: AGING.map(() => []) };
    const idx = AGING.findIndex((a) => a.test(i.days_overdue));
    r.buckets[idx].push(i.balance);
    rows.set(k, r);
  });
  const aging = [...rows.values()].map((r) => ({ ...r, totals: r.buckets.map((b) => sum(b)), total: sum(r.buckets.flat()) }))
    .sort((a, b) => Number(b.total) - Number(a.total));
  const colTotals = AGING.map((_, i) => sum(aging.map((r) => r.totals[i])));

  return (
    <>
      <PageHeader title="Finanzas" description="Lo que te deben, lo que debés a proveedores y cómo se movió la plata. Importes en ARS." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ArrowDownLeft} label="Por cobrar" value={formatMoney(receivable)} sub={`${ars.length} facturas`} href="/cobranzas" />
        <Stat icon={ArrowUpRight} label="Por pagar a proveedores" value={formatMoney(payable)} sub={`${pay.length} compras sin pagar`} />
        <Stat icon={Scale} label="Posición neta" value={formatMoney(net)} sub="Por cobrar − por pagar" tone={Number(net) < 0 ? "danger" : "accent"} />
        <Stat icon={Receipt} label="Cobrado este mes" value={formatMoney(month?.collected ?? 0)} sub={`Pagado ${formatMoney(month?.paid ?? 0)}`} />
      </div>

      <Card className="mt-5">
        <CardHeader title="Flujo de los últimos 12 meses" description="Cobrado (en banco) vs pagado a proveedores y gastos" />
        <CardBody className="pt-2">
          <SeriesChart data={flows} series={[{ key: "collected", label: "Cobrado" }, { key: "paid", label: "Pagado a proveedores" }, { key: "expenses", label: "Gastos" }]} />
        </CardBody>
      </Card>

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Banco Ciudad · cobros del GCBA"
          description="Se leen solos del aviso diario de movimientos y se cruzan con los avisos de pago de SIGAF. Lo que falta para llegar al total de las facturas son retenciones."
          action={<span className="text-right text-xs text-fg-muted">SIRCREB mes <b className="tabular text-fg">{formatMoney(sircrebMonth)}</b><br />año <b className="tabular text-fg">{formatMoney(sircrebYear)}</b></span>} />
        {!gcba.length ? <EmptyState title="Sin movimientos todavía" description="Aparecen cuando el script de Gmail lee el aviso de Banco Ciudad." /> : (
          <ul className="max-h-[380px] divide-y divide-border overflow-y-auto">
            {gcba.map((m) => {
              const st = MOV_STATUS[m.status] ?? MOV_STATUS.pendiente;
              return (
                <li key={m.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">Pago GCBA · {formatDate(m.mov_date)} <Badge tone={st.tone}>{st.label}</Badge></p>
                    <p className="truncate text-xs text-fg-subtle">{m.invoices ? `Facturas ${m.invoices}` : "Sin facturas vinculadas"}{m.status_note ? ` · ${m.status_note}` : ""}</p>
                  </div>
                  <span className="text-sm font-semibold tabular">{formatMoney(m.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Antigüedad de la deuda" description="Saldo por organismo según días desde el vencimiento" />
          {!aging.length ? <EmptyState title="Sin saldos pendientes" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-border text-xs text-fg-subtle">
                  <th className="px-4 py-2 text-left font-medium sm:px-5">Organismo</th>
                  {AGING.map((a) => <th key={a.key} className="px-3 py-2 text-right font-medium">{a.label}</th>)}
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {aging.map((r) => (
                    <tr key={r.name}>
                      <td className="max-w-[220px] truncate px-4 py-2.5 sm:px-5">{r.name}</td>
                      {r.totals.map((t, i) => <td key={i} className={cn("px-3 py-2.5 text-right tabular", Number(t) === 0 ? "text-fg-subtle" : i >= 2 && "text-danger")}>{Number(t) ? formatMoney(t) : "—"}</td>)}
                      <td className="px-4 py-2.5 text-right font-medium tabular sm:px-5">{formatMoney(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-2/60 font-medium">
                    <td className="px-4 py-2.5 sm:px-5">Total</td>
                    {colTotals.map((t, i) => <td key={i} className="px-3 py-2.5 text-right tabular">{Number(t) ? formatMoney(t) : "—"}</td>)}
                    <td className="px-4 py-2.5 text-right tabular sm:px-5">{formatMoney(receivable)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="self-start overflow-hidden">
          <CardHeader title="Por pagar a proveedores" description="Compras sin marcar como pagadas" />
          {!pay.length ? <EmptyState title="Nada pendiente" /> : (
            <ul className="max-h-[440px] divide-y divide-border overflow-y-auto">
              {pay.map((p) => {
                const late = p.due_date && p.due_date < today;
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/compras/${p.id}`} className="block truncate text-sm font-medium hover:text-brand">{(p.suppliers as unknown as { name: string } | null)?.name ?? "—"}</Link>
                      <p className={cn("truncate text-xs", late ? "text-danger" : "text-fg-subtle")}>{p.point_of_sale ? `${p.point_of_sale}-` : ""}{p.number ?? "s/n"} · {p.due_date ? `vence ${formatDate(p.due_date)}` : formatDate(p.invoice_date)}</p>
                    </div>
                    <span className="text-sm font-medium tabular">{formatMoney(p.total_amount, p.currency)}</span>
                    {canPay && <PaidToggle id={p.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
