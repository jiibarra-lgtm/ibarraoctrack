import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { BellRing, CalendarRange, Clock, Hourglass } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { addDays, days, reconcileAccount, stats, type AccDeposit, type AccInvoice } from "@/lib/collect-times";
import { cn } from "@/lib/utils";

const GCBA = "34999032089";
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const num = (r: { voucher_type: number; point_of_sale: number; number: number }) => `${r.voucher_type === 1 ? "A" : r.voucher_type === 6 ? "B" : "C"} ${r.point_of_sale}-${r.number}`;

type IC = { id: string; issue_date: string; voucher_type: number; point_of_sale: number; number: number; name: string; doc_number: string; total: string; paid_on: string | null; days_to_pay: number | null; sigaf_notified: string | null };

/** Cuánto tarda en entrar la plata: por organismo, el circuito del GCBA, lo que te deberían pagar y la cuenta corriente de cada cliente. */
export async function CollectionTimes({ sb, org }: { sb: SupabaseClient; org: string }) {
  const [{ data: icData }, { data: depData }, { data: inbox }, { data: units }, { data: board }, { data: pos }, { data: conn }] = await Promise.all([
    sb.from("invoice_collections").select("id, issue_date, voucher_type, point_of_sale, number, name, doc_number, total, paid_on, days_to_pay, sigaf_notified").eq("org_id", org).gte("issue_date", addDays(todayAr(), -400)).limit(5000),
    sb.from("bank_movements").select("id, mov_date, amount, counterpart_cuit, counterpart_name, kind").eq("org_id", org).eq("direction", "in")
      .in("kind", ["pago_recibido", "transferencia", "deposito", "cheque_depositado"]).not("counterpart_cuit", "is", null).limit(3000),
    sb.from("bac_orders_inbox").select("bac_number, unit_code, perfected_at, prd_at").eq("org_id", org).not("prd_at", "is", null).limit(2000),
    sb.from("bac_units").select("code, name").eq("org_id", org).limit(2000),
    sb.from("delivery_board").select("place, oc_refs, delivered_on").eq("org_id", org).eq("status", "entregado").not("delivered_on", "is", null).limit(3000),
    sb.from("purchase_orders").select("bac_number, dependencia, customer_name:customers(name)").eq("org_id", org).not("bac_number", "is", null).limit(3000),
    sb.from("arca_connection").select("cuit").eq("org_id", org).maybeSingle(),
  ]);
  const ic = (icData ?? []) as IC[];
  if (!ic.length) return null;
  const today = todayAr();
  const own = String((conn as { cuit?: string } | null)?.cuit ?? "").replace(/\D/g, "");

  // ---------- GCBA: factura → SIGAF → banco ----------
  const g = ic.filter((x) => x.doc_number === GCBA);
  const gPaid = g.filter((x) => x.paid_on);
  const toPay = stats(gPaid.map((x) => days(x.issue_date, x.paid_on!)));
  const toSigaf = stats(gPaid.filter((x) => x.sigaf_notified).map((x) => days(x.issue_date, x.sigaf_notified!)));
  const sigafToBank = stats(gPaid.filter((x) => x.sigaf_notified).map((x) => days(x.sigaf_notified!, x.paid_on!)));
  // por mes de factura (¿está pagando más lento?)
  const byMonth = new Map<string, number[]>();
  gPaid.forEach((x) => { const k = x.issue_date.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), days(x.issue_date, x.paid_on!)]); });
  const trend = [...byMonth].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([m, xs]) => ({ m, s: stats(xs)! }));

  // ---------- Lo que te deberían pagar (pendientes del GCBA + mediana) ----------
  const med = toPay?.median ?? 18;
  const pend = g.filter((x) => !x.paid_on && days(x.issue_date, today) <= 180).map((x) => ({ x, expected: x.sigaf_notified ? addDays(x.sigaf_notified, sigafToBank?.median ?? 1) : addDays(x.issue_date, med) }));
  const week = addDays(today, 7);
  const dueWeek = pend.filter((p) => p.expected <= week && p.expected >= today);
  const lateP = pend.filter((p) => p.expected < today);
  // SIGAF avisó que pagó y el depósito no aparece
  const sigafNoBank = g.filter((x) => x.sigaf_notified && !x.paid_on && days(x.sigaf_notified, today) >= 3).sort((a, b) => a.sigaf_notified!.localeCompare(b.sigaf_notified!));

  // ---------- Por organismo: entrega → PRD y OC perfeccionada → PRD ----------
  const unitName = new Map(((units ?? []) as { code: string; name: string | null }[]).filter((u) => u.name).map((u) => [u.code, u.name!]));
  for (const p of (pos ?? []) as { bac_number: string; dependencia: string | null; customer_name: { name: string } | { name: string }[] | null }[]) {
    const code = p.bac_number.split("-")[0];
    const cn = Array.isArray(p.customer_name) ? p.customer_name[0]?.name : p.customer_name?.name;
    if (!unitName.has(code) && (p.dependencia || cn)) unitName.set(code, (p.dependencia || cn)!);
  }
  const delivered = new Map<string, { date: string; place: string }>();
  for (const b of (board ?? []) as { place: string; oc_refs: string[]; delivered_on: string }[]) {
    for (const r of b.oc_refs) { const prev = delivered.get(r); if (!prev || b.delivered_on > prev.date) delivered.set(r, { date: b.delivered_on, place: b.place }); }
  }
  const perUnit = new Map<string, { name: string; delivToPrd: number[]; perfToPrd: number[]; n: number }>();
  for (const i of (inbox ?? []) as { bac_number: string; unit_code: string; perfected_at: string | null; prd_at: string }[]) {
    const code = i.unit_code || i.bac_number.split("-")[0];
    const d = delivered.get(i.bac_number.toUpperCase());
    const u = perUnit.get(code) ?? { name: unitName.get(code) ?? d?.place ?? `Unidad ${code}`, delivToPrd: [], perfToPrd: [], n: 0 };
    if (u.name.startsWith("Unidad ") && d?.place) u.name = d.place;
    u.n++;
    if (d && days(d.date, i.prd_at) >= -3) u.delivToPrd.push(Math.max(0, days(d.date, i.prd_at)));
    if (i.perfected_at) u.perfToPrd.push(days(i.perfected_at, i.prd_at));
    perUnit.set(code, u);
  }
  const unitRows = [...perUnit].map(([code, u]) => ({ code, ...u, dp: stats(u.delivToPrd), pp: stats(u.perfToPrd) }))
    .filter((u) => u.dp || u.pp)
    .sort((a, b) => (b.dp?.median ?? b.pp?.median ?? 0) - (a.dp?.median ?? a.pp?.median ?? 0));

  // ---------- Clientes que no son el GCBA: cuenta corriente ----------
  const deps = ((depData ?? []) as { id: string; mov_date: string; amount: string; counterpart_cuit: string; counterpart_name: string | null }[])
    .filter((d) => d.counterpart_cuit !== own && d.counterpart_cuit !== GCBA);
  const clients = new Map<string, { name: string; inv: AccInvoice[]; dep: AccDeposit[] }>();
  for (const x of ic.filter((x) => x.doc_number !== GCBA && x.doc_number !== own)) {
    const c = clients.get(x.doc_number) ?? { name: x.name, inv: [], dep: [] };
    c.inv.push({ id: x.id, date: x.issue_date, total: Number(x.total), label: num(x) });
    clients.set(x.doc_number, c);
  }
  for (const d of deps) {
    const c = clients.get(d.counterpart_cuit) ?? { name: d.counterpart_name ?? d.counterpart_cuit, inv: [], dep: [] };
    c.dep.push({ id: d.id, date: d.mov_date, amount: Number(d.amount) });
    clients.set(d.counterpart_cuit, c);
  }
  const accounts = [...clients].map(([cuit, c]) => ({ cuit, name: c.name, acc: reconcileAccount(c.inv, c.dep) }))
    .filter((a) => a.acc.matches.length || a.acc.openInvoices.length || a.acc.looseDeposits.length)
    .sort((a, b) => b.acc.balance - a.acc.balance);
  const withPayments = accounts.filter((a) => a.acc.matches.length);
  const clientDays = stats(withPayments.flatMap((a) => a.acc.matches.map((m) => m.days)));

  return (
    <div className="mb-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Clock} label="GCBA: de factura a cobro" value={toPay ? `${toPay.median} días` : "—"} sub={toPay ? `mediana de ${toPay.n} facturas · entre ${toPay.min} y ${toPay.max}` : undefined} />
        <Stat icon={CalendarRange} label="Deberían pagarte esta semana" value={formatMoney(dueWeek.reduce((a, p) => a + Number(p.x.total), 0))} sub={`${dueWeek.length} facturas del GCBA`} tone="accent" />
        <Stat icon={Hourglass} label="Pasadas de lo normal" value={formatMoney(lateP.reduce((a, p) => a + Number(p.x.total), 0))} sub={`${lateP.length} facturas · ya deberían haber entrado`} tone={lateP.length ? "warn" : undefined} />
        <Stat icon={BellRing} label="SIGAF avisó y no entró" value={String(sigafNoBank.length)} sub={sigafNoBank.length ? formatMoney(sigafNoBank.reduce((a, x) => a + Number(x.total), 0)) : "todo lo avisado llegó"} tone={sigafNoBank.length ? "danger" : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Días reales de cobro por organismo"
            description={`Entrega (hoja de ruta) → PRD firmado, y OC perfeccionada → PRD. El GCBA después tarda ~${med} días desde la factura: el total es lo que tarda la plata desde que entregás, si facturás el día del PRD.`} />
          {unitRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-fg-subtle">
                  <tr><th className="px-5 py-2 font-medium">Organismo</th><th className="px-3 py-2 text-right font-medium">Entrega → PRD</th><th className="px-3 py-2 text-right font-medium">OC → PRD</th><th className="px-5 py-2 text-right font-medium">Entrega → cobro</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {unitRows.map((u) => {
                    const total = u.dp ? u.dp.median + med : null;
                    return (
                      <tr key={u.code}>
                        <td className="px-5 py-2"><p className="max-w-[260px] truncate font-medium">{u.name}</p><p className="text-[11px] text-fg-subtle">Unidad {u.code} · {u.n} OC con PRD</p></td>
                        <td className="px-3 py-2 text-right tabular">{u.dp ? <>{u.dp.median} d<span className="block text-[11px] text-fg-subtle">{u.dp.n} entregas</span></> : <span className="text-fg-subtle">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular">{u.pp ? <>{u.pp.median} d<span className="block text-[11px] text-fg-subtle">{u.pp.n} OC</span></> : <span className="text-fg-subtle">—</span>}</td>
                        <td className={cn("px-5 py-2 text-right font-semibold tabular", total !== null && total > med + 10 && "text-warn")}>{total !== null ? `~${total} días` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-4 text-sm text-fg-muted">Todavía no hay OC con PRD y entrega registrada para medir.</p>}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="El circuito del GCBA" description="Cada paso medido con tus facturas reales: cuánto tarda SIGAF en avisar y cuánto el banco en acreditar." />
          <div className="grid grid-cols-3 gap-3 px-5 pb-4 text-center">
            {[{ l: "Factura → aviso SIGAF", s: toSigaf }, { l: "SIGAF → depósito", s: sigafToBank }, { l: "Total", s: toPay }].map((x) => (
              <div key={x.l} className="rounded-xl bg-surface-2/60 p-3">
                <p className="text-[11px] text-fg-subtle">{x.l}</p>
                <p className="text-xl font-semibold tabular">{x.s ? `${x.s.median} d` : "—"}</p>
                {x.s && <p className="text-[11px] text-fg-subtle">promedio {x.s.avg} · máx {x.s.max}</p>}
              </div>
            ))}
          </div>
          {trend.length > 1 && (
            <ul className="divide-y divide-border border-t border-border">
              {trend.map((t) => (
                <li key={t.m} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-20 text-xs capitalize text-fg-subtle">{new Date(`${t.m}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "short", year: "2-digit" })}</span>
                  <span className="h-2 flex-1 rounded-full bg-field"><span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.min(100, (t.s.median / Math.max(...trend.map((z) => z.s.median), 1)) * 100)}%` }} /></span>
                  <span className="w-28 text-right text-xs tabular">{t.s.median} días · {t.s.n} fact.</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {sigafNoBank.length > 0 && (
        <Card className="overflow-hidden border-danger/30">
          <CardHeader title="SIGAF avisó el pago y el depósito no aparece en el Ciudad" description="Normalmente entra en 1 o 2 días. Si pasaron más, puede que el banco todavía no haya mandado el aviso o que lo hayan depositado junto con otra factura." />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {sigafNoBank.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                <span>Factura {num(x)} del {formatDate(x.issue_date)} · <span className="text-fg-subtle">SIGAF avisó el {formatDate(x.sigaf_notified)} (hace {days(x.sigaf_notified!, today)} días)</span></span>
                <span className="font-semibold tabular">{formatMoney(x.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {accounts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Cuenta corriente de otros clientes"
            description={`Facturas contra transferencias del mismo CUIT: detecta pagos en cuotas, anticipos y retenciones.${clientDays ? ` Tardan ${clientDays.median} días en promedio.` : ""}`} />
          <ul className="divide-y divide-border">
            {accounts.map((a) => (
              <li key={a.cuit} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{a.name} <span className="text-xs font-normal text-fg-subtle">· CUIT {a.cuit}</span></p>
                  <p className="tabular">Facturado {formatMoney(a.acc.billed)} · Cobrado {formatMoney(a.acc.received)} · <span className={cn("font-semibold", a.acc.balance > 1 ? "text-warn" : "text-accent")}>{a.acc.balance > 1 ? `Te debe ${formatMoney(a.acc.balance)}` : a.acc.balance < -1 ? `A favor de ellos ${formatMoney(-a.acc.balance)}` : "Al día"}</span></p>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {a.acc.matches.map((m) => (
                    <Badge key={m.invoice.id} tone={m.kind === "retencion" ? "warn" : "accent"}>
                      {m.invoice.label} · {m.kind === "exacto" ? `pagada en ${m.days} d` : m.kind === "cuotas" ? `${m.deposits.length} pagos${m.days < 0 ? " (anticipo)" : ` · ${m.days} d`}` : `cobrada con ${m.pct}% retenido (${formatMoney(m.retained)})`}
                    </Badge>
                  ))}
                  {a.acc.openInvoices.map((i) => <Badge key={i.id} tone="danger">{i.label} · {formatMoney(i.total)} sin cobrar · {days(i.date, today)} d</Badge>)}
                  {a.acc.looseDeposits.map((d) => <Badge key={d.id}>Depósito {formatDate(d.date)} · {formatMoney(d.amount)} sin factura</Badge>)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-fg-subtle">Los días por organismo salen de cruzar las <Link href="/entregas/pendientes" className="underline">entregas</Link> con los PRD que manda el BAC por mail.</p>
    </div>
  );
}
