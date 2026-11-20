import type { Metadata } from "next";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Landmark, Target, TrendingDown } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { SeriesChart } from "@/components/charts/series-chart";
import { formatDate, formatMoney } from "@/lib/format";
import { loadBillableOrders } from "@/lib/billing-load";
import { loadBreakEven } from "@/lib/break-even";
import { businessDay, IVA_DAY } from "@/lib/taxes";
import { cashLedger, chequeOpen, fixedCostDates, projectFlow, type FlowItem } from "@/lib/treasury";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Flujo de fondos" };

const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const plus = (iso: string, d: number) => new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);
const shiftM = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const clamp = (v: string | undefined, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const GROUPS: Record<string, string> = {
  cobros: "Facturas a cobrar", cheques_in: "Cheques de terceros", oc: "OC por facturar", cheques_out: "Cheques propios", proveedores: "Proveedores", fijos: "Gastos fijos", impuestos: "Impuestos",
};

export default async function FlujoPage({ searchParams }: { searchParams: Promise<{ c?: string; d?: string; w?: string; oc?: string; f?: string }> }) {
  const sp = await searchParams;
  const collectPct = clamp(sp.c, 100, 0, 100);
  const delayDays = clamp(sp.d, 0, 0, 180);
  const weeks = clamp(sp.w, 12, 4, 26);
  const withOc = sp.f ? sp.oc === "1" : true;
  const s = await requireOrg();
  const sb = s.supabase, org = s.org.org_id;
  const today = nowAr(), month = today.slice(0, 7);
  const horizon = plus(today, weeks * 7 + 7);

  const [{ data: bal }, { data: cash }, { data: cheq }, { data: inv }, { data: purch }, { data: fc }, { data: billsPaid }, { data: fs }, billable, { data: monthly }, { data: tax }, arca, be] = await Promise.all([
    sb.from("bank_balances").select("as_of, balance").eq("org_id", org).order("as_of", { ascending: false }).limit(1),
    sb.from("cash_movements").select("id, mov_date, direction, amount, category, concept, created_at").eq("org_id", org).limit(20000),
    sb.from("cheques").select("direction, status, amount, pay_date, counterpart_name").eq("org_id", org).limit(2000),
    sb.from("invoice_balances").select("invoice_type, point_of_sale, number, balance, due_date, issue_date, currency").eq("org_id", org).gt("balance", 0).limit(2000),
    sb.from("purchases").select("total_amount, due_date, invoice_date, currency, suppliers(name)").eq("org_id", org).eq("status", "confirmada").eq("paid", false).limit(1000),
    sb.from("fixed_costs").select("id, name, amount, frequency, due_day, source, is_variable").eq("org_id", org).eq("active", true).limit(1000),
    sb.from("fixed_cost_bills").select("cost_id, period").eq("org_id", org).eq("paid", true).gte("period", shiftM(month, -1)).limit(5000),
    sb.from("financial_settings").select("collection_days").eq("org_id", org).maybeSingle(),
    loadBillableOrders(sb, org).catch(() => []),
    sb.from("arca_monthly").select("month, direction, vat").eq("org_id", org).gte("month", shiftM(month, -2)).limit(50),
    sb.from("tax_settings").select("iibb_rate, iibb_day").eq("org_id", org).maybeSingle(),
    sb.rpc("arca_conn", { p_action: "status", p_org: org, p_data: {} }).then((r) => r.data as { cuit?: string } | null, () => null),
    loadBreakEven(sb, org, month).catch(() => null),
  ]);

  const bank = Number(bal?.[0]?.balance ?? 0);
  const cashBal = cashLedger(((cash ?? []) as { id: string; mov_date: string; direction: "in" | "out"; amount: string; category: never; concept: string; created_at: string }[]).map((r) => ({ ...r, amount: Number(r.amount) }))).at(-1)?.balance ?? 0;
  const opening = bank + cashBal;
  const collDays = Number(fs?.collection_days ?? 30);
  const items: FlowItem[] = [];

  for (const i of (inv ?? []) as { invoice_type: string; point_of_sale: string; number: string; balance: string; due_date: string | null; issue_date: string; currency: string }[])
    if (i.currency === "ARS") items.push({ date: i.due_date ?? plus(i.issue_date, collDays), amount: Number(i.balance), dir: "in", group: "cobros", label: `Factura ${i.invoice_type} ${i.point_of_sale}-${i.number}`, certain: false });
  for (const c of (cheq ?? []) as { direction: "recibido" | "emitido"; status: never; amount: string; pay_date: string; counterpart_name: string | null }[]) {
    if (!chequeOpen(c)) continue;
    items.push({ date: c.pay_date, amount: Number(c.amount), dir: c.direction === "recibido" ? "in" : "out", group: c.direction === "recibido" ? "cheques_in" : "cheques_out", label: `Cheque ${c.counterpart_name ?? ""}`, certain: true });
  }
  if (withOc) for (const b of billable) if (b.currency === "ARS")
    items.push({ date: plus(today, 15 + collDays), amount: Number(b.to_invoice), dir: "in", group: "oc", label: `OC ${b.order?.label ?? ""} sin facturar`, certain: false });
  for (const p of (purch ?? []) as unknown as { total_amount: string; due_date: string | null; invoice_date: string; currency: string; suppliers: { name: string } | null }[])
    if (p.currency === "ARS") items.push({ date: p.due_date ?? plus(p.invoice_date, 30), amount: Number(p.total_amount), dir: "out", group: "proveedores", label: p.suppliers?.name ?? "Proveedor", certain: true });
  const paid = new Set(((billsPaid ?? []) as { cost_id: string; period: string }[]).map((b) => `${b.cost_id}|${b.period}`));
  for (const f of (fc ?? []) as { id: string; name: string; amount: string; frequency: number | null; due_day: number | null; source: string; is_variable: boolean }[]) {
    if (["arca", "mail"].includes(f.source)) continue;
    for (const d of fixedCostDates(`${month}-01`, horizon, f.due_day, f.frequency)) {
      if (paid.has(`${f.id}|${d.slice(0, 7)}`)) continue;
      items.push({ date: d, amount: Number(f.amount), dir: "out", group: "fijos", label: f.name, certain: true });
    }
  }
  // Impuestos: IVA del mes pasado (débito − crédito) y anticipo de IIBB, estimados
  const prev = shiftM(month, -1);
  const vatOf = (dir: string) => ((monthly ?? []) as { month: string; direction: string; vat: string }[]).filter((x) => x.month.startsWith(prev) && x.direction === dir).reduce((a, x) => a + Number(x.vat), 0);
  const ivaDue = vatOf("emitido") - vatOf("recibido");
  const digit = Number(String(arca?.cuit ?? "0").slice(-1)) || 0;
  const [y, mm] = month.split("-").map(Number);
  if (ivaDue > 0) items.push({ date: businessDay(y, mm, IVA_DAY[digit]), amount: ivaDue, dir: "out", group: "impuestos", label: "IVA (estimado)", certain: true });
  const { data: lastIibb } = await sb.from("iibb_filings").select("month, total_due, paid_at").eq("org_id", org).eq("month", prev).maybeSingle().then((r) => r, () => ({ data: null }));
  const iibbAmt = lastIibb && !lastIibb.paid_at ? Number(lastIibb.total_due) : 0;
  if (iibbAmt > 0) items.push({ date: businessDay(y, mm, Number(tax?.iibb_day ?? 15)), amount: iibbAmt, dir: "out", group: "impuestos", label: "Ingresos Brutos", certain: true });

  const flow = projectFlow(opening, items, today, weeks, { collectPct, delayDays });
  const min = flow.reduce((a, w) => (w.closing < a.closing ? w : a), flow[0]);
  const firstNeg = flow.find((w) => w.closing < 0);
  const totIn = flow.reduce((a, w) => a + w.in, 0), totOut = flow.reduce((a, w) => a + w.out, 0);
  const groups = Object.keys(GROUPS).filter((g) => flow.some((w) => w.groups[g]));
  const soon = items.filter((i) => i.date <= plus(today, 14)).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <PageHeader title="Flujo de fondos" description="Saldo de hoy (banco + caja) más lo que se espera cobrar y menos lo que hay que pagar, semana por semana. Movés el escenario y ves si en algún momento te quedás corto." />

      <form className="glass mb-5 flex flex-wrap items-end gap-4 rounded-2xl px-5 py-4 text-sm">
        <label className="grid gap-1 text-xs text-fg-muted">Se cobra (%)<input name="c" type="number" min={0} max={100} defaultValue={collectPct} className="h-9 w-24 rounded-lg border border-card-border bg-field px-2 tabular" /></label>
        <label className="grid gap-1 text-xs text-fg-muted">Demora extra en cobrar (días)<input name="d" type="number" min={0} max={180} defaultValue={delayDays} className="h-9 w-24 rounded-lg border border-card-border bg-field px-2 tabular" /></label>
        <label className="grid gap-1 text-xs text-fg-muted">Semanas<input name="w" type="number" min={4} max={26} defaultValue={weeks} className="h-9 w-20 rounded-lg border border-card-border bg-field px-2 tabular" /></label>
        <label className="flex items-center gap-2 pb-2 text-xs text-fg-muted"><input type="checkbox" name="oc" value="1" defaultChecked={withOc} /> Contar OC sin facturar</label>
        <input type="hidden" name="f" value="1" />
        <Button type="submit" size="sm">Recalcular</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Landmark} label="Disponible hoy" value={formatMoney(opening)} sub={`banco ${formatMoney(bank)} · caja ${formatMoney(cashBal)}`} />
        <Stat icon={ArrowDownLeft} label={`Entra en ${weeks} semanas`} value={formatMoney(totIn)} sub={collectPct < 100 || delayDays ? `escenario: ${collectPct}% con ${delayDays} días de demora` : "si se cobra todo en fecha"} />
        <Stat icon={ArrowUpRight} label={`Sale en ${weeks} semanas`} value={formatMoney(totOut)} />
        <Stat icon={TrendingDown} label="Saldo más bajo" value={formatMoney(min?.closing)} tone={min && min.closing < 0 ? "danger" : "accent"} sub={min ? `semana del ${formatDate(min.week)}` : ""} />
      </div>

      {firstNeg && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>La semana del <b>{formatDate(firstNeg.week)}</b> quedás en <b>{formatMoney(firstNeg.closing)}</b>. Adelantá cobros, mové pagos o tené un descubierto acordado.</span>
        </div>
      )}

      <Card className="mt-5">
        <CardHeader title="Saldo proyectado" description="Al cierre de cada semana" />
        <div className="px-3 pb-4"><SeriesChart type="line" xKey="label" data={flow.map((w) => ({ label: formatDate(w.week).slice(0, 5), saldo: w.closing, entra: w.in, sale: w.out }))} series={[{ key: "saldo", label: "Saldo" }, { key: "entra", label: "Entra" }, { key: "sale", label: "Sale" }]} /></div>
      </Card>

      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm tabular">
            <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
              <th className="px-5 py-2.5 text-left font-medium">Semana del</th>
              {groups.map((g) => <th key={g} className="px-2 text-right font-medium">{GROUPS[g]}</th>)}
              <th className="px-2 text-right font-medium">Neto</th><th className="px-5 text-right font-medium">Saldo</th>
            </tr></thead>
            <tbody>
              {flow.map((w) => (
                <tr key={w.week} className="border-b border-border last:border-0">
                  <td className="px-5 py-2">{formatDate(w.week)}</td>
                  {groups.map((g) => <td key={g} className={cn("px-2 text-right", (w.groups[g] ?? 0) > 0 ? "text-accent" : (w.groups[g] ?? 0) < 0 ? "" : "text-fg-subtle")}>{w.groups[g] ? formatMoney(w.groups[g]) : "—"}</td>)}
                  <td className={cn("px-2 text-right", w.in - w.out < 0 && "text-danger")}>{formatMoney(w.in - w.out)}</td>
                  <td className={cn("px-5 text-right font-semibold", w.closing < 0 && "text-danger")}>{formatMoney(w.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Próximos 14 días" description="Lo vencido aparece hoy" />
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {soon.map((i, n) => (
              <li key={n} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className={cn("w-20 tabular", i.date < today && "text-danger")}>{formatDate(i.date < today ? today : i.date)}</span>
                <span className="min-w-0 flex-1 truncate">{i.label} <span className="text-xs text-fg-subtle">· {GROUPS[i.group]}</span></span>
                <span className={cn("tabular", i.dir === "in" ? "text-accent" : "")}>{i.dir === "in" ? "+" : "−"}{formatMoney(i.amount)}</span>
              </li>
            ))}
            {!soon.length && <li className="px-5 py-4 text-sm text-fg-subtle">Nada en los próximos 14 días.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Resultado del mes y punto de equilibrio" description="Cuánto hay que vender (neto de IVA) para cubrir los gastos fijos con tu margen real de los últimos 6 meses." />
          {be ? (
            <div className="space-y-3 px-5 pb-5 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <p><span className="text-fg-subtle">Gastos fijos del mes</span><br /><b className="tabular">{formatMoney(be.fixed)}</b></p>
                <p><span className="text-fg-subtle">Margen bruto real</span><br /><b className="tabular">{be.marginPct !== null ? `${(be.marginPct * 100).toFixed(1)}%` : "—"}</b></p>
                <p><span className="text-fg-subtle">Hay que vender</span><br /><b className="tabular">{be.needed !== null ? formatMoney(be.needed) : "—"}</b></p>
                <p><span className="text-fg-subtle">Vendido este mes</span><br /><b className="tabular">{formatMoney(be.sold)}</b></p>
              </div>
              {be.pct !== null && (
                <>
                  <div className="h-3 overflow-hidden rounded-full bg-field"><div className={cn("h-full rounded-full", be.pct >= 1 ? "bg-accent" : be.pct >= 0.7 ? "bg-warn" : "bg-danger")} style={{ width: `${Math.min(100, be.pct * 100)}%` }} /></div>
                  <p className="flex items-center gap-1.5 text-xs text-fg-muted"><Target className="size-3.5" />
                    {be.pct >= 1 ? `Cubriste los gastos fijos: el resultado del mes es aprox. ${formatMoney((be.sold - (be.needed ?? 0)) * (be.marginPct ?? 0))} de ganancia.`
                      : `Vas ${(be.pct * 100).toFixed(0)}%: faltan ${formatMoney((be.needed ?? 0) - be.sold)} de ventas netas para no perder (resultado hoy aprox. ${formatMoney(be.sold * (be.marginPct ?? 0) - be.fixed)}).`}
                  </p>
                </>
              )}
            </div>
          ) : <p className="px-5 pb-5 text-sm text-fg-subtle">Faltan datos de márgenes de las OC para calcularlo.</p>}
        </Card>
      </div>
    </>
  );
}
