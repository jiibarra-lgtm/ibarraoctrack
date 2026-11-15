import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, Banknote, CheckCircle2, CircleDashed, FileCheck2, FileQuestion, Landmark, Mail, MapPin, Percent, Receipt, ShieldAlert, Wallet } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { cn } from "@/lib/utils";
import { businessDay, IVA_DAY, iibbBalances, ivaBalances } from "@/lib/taxes";
import { guessJurisdiction } from "@/lib/jurisdictions";
import { monthRows, type Monthly, type Withholding } from "./tax-tabs";
import { AnnualLimitForm, JurisdictionSelect, LinkOrderButton, RefreshSuppliersButton } from "./arca-ui";

const N = (x: unknown) => Number(x ?? 0) || 0;
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString();
const shift = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); };
const nro = (pv: number | null, n: number | null) => (pv ? `${String(pv).padStart(5, "0")}-${String(n ?? 0).padStart(8, "0")}` : "sin número");
const TYPE: Record<number, string> = { 1: "FA", 6: "FB", 11: "FC", 51: "FM", 201: "FCE A", 206: "FCE B", 211: "FCE C", 2: "ND A", 7: "ND B" };

// ---------------------------------------------------------------------------
// 1 · 11 · 22: circuito de cada factura emitida (OC → PRD → aviso SIGAF → banco)
// ---------------------------------------------------------------------------
type Circ = {
  id: string; issue_date: string; voucher_type: number; point_of_sale: number; number: number; name: string; doc_number: string | null; total: string;
  purchase_order_id: string | null; po_number: string | null; po_total: string | null; link_source: string | null; prd_number: string | null; prd_at: string | null;
  sigaf_notified: string | null; paid_on: string | null; deposit_amount: string | null; days_to_pay: number | null; stage: Stage;
};
type Stage = "sin_oc" | "sin_prd" | "con_prd" | "pago_avisado" | "cobrada";
const STAGES: [Stage, string, "danger" | "warn" | "info" | "accent" | "neutral"][] = [
  ["sin_oc", "Sin OC", "warn"], ["sin_prd", "OC sin PRD", "neutral"], ["con_prd", "Con PRD", "info"], ["pago_avisado", "Pago avisado (SIGAF)", "accent"], ["cobrada", "Cobrada", "accent"],
];

export async function CircuitoTab({ sb, org, etapa, canEdit }: { sb: SupabaseClient; org: string; etapa?: string; canEdit: boolean }) {
  const { data } = await sb.from("invoice_circuit").select("*").eq("org_id", org).gte("issue_date", daysAgo(200)).order("issue_date", { ascending: false }).limit(600);
  const all = (data ?? []) as Circ[];
  const sel = STAGES.find(([k]) => k === etapa)?.[0];
  const rows = (sel ? all.filter((r) => r.stage === sel) : all.filter((r) => r.stage !== "cobrada")).slice(0, 200);
  const by = (k: Stage) => all.filter((r) => r.stage === k);
  const sumT = (xs: Circ[]) => xs.reduce((a, r) => a + N(r.total), 0);
  const href = (e?: string) => `/impuestos?${new URLSearchParams({ v: "circuito", ...(e ? { etapa: e } : {}) })}`;
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FileQuestion} label="Facturas sin OC" value={String(by("sin_oc").length)} sub={formatMoney(sumT(by("sin_oc")))} tone={by("sin_oc").length ? "warn" : undefined} href={href("sin_oc")} />
        <Stat icon={CircleDashed} label="Con OC, sin PRD" value={String(by("sin_prd").length)} sub={formatMoney(sumT(by("sin_prd")))} href={href("sin_prd")} />
        <Stat icon={FileCheck2} label="Con PRD (esperando pago)" value={String(by("con_prd").length)} sub={formatMoney(sumT(by("con_prd")))} href={href("con_prd")} />
        <Stat icon={Wallet} label="Pago avisado, falta el depósito" value={String(by("pago_avisado").length)} sub={formatMoney(sumT(by("pago_avisado")))} tone="accent" href={href("pago_avisado")} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Circuito de cada factura" description="Factura de ARCA → OC del BAC → PRD (mail del BAC) → aviso de pago del SIGAF → depósito en el banco. Se vinculan solas por CUIT del cliente, fecha e importe; si no, vinculala a mano." />
        <div className="flex flex-wrap gap-1.5 border-b border-border px-5 pb-3">
          <Link href={href()} className={cn("rounded-full px-3 py-1 text-xs font-medium", !sel ? "bg-primary text-primary-fg" : "bg-field text-fg-muted")}>Pendientes ({all.length - by("cobrada").length})</Link>
          {STAGES.map(([k, l]) => <Link key={k} href={href(k)} className={cn("rounded-full px-3 py-1 text-xs font-medium", sel === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted")}>{l} ({by(k).length})</Link>)}
        </div>
        {!rows.length ? <EmptyState icon={<CheckCircle2 />} title="Nada en esta etapa" description="Todas las facturas de los últimos meses están en otra etapa." /> : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const st = STAGES.find(([k]) => k === r.stage)!;
              return (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="tabular">{TYPE[r.voucher_type] ?? `Tipo ${r.voucher_type}`} {nro(r.point_of_sale, r.number)}</span>
                      <Badge tone={st[2]}>{st[1]}</Badge>
                      {r.purchase_order_id && <Link href={`/ordenes/${r.purchase_order_id}?tab=facturacion`}><Badge tone="accent">OC {r.po_number}</Badge></Link>}
                      {r.link_source === "auto" && <Badge>vinculada sola</Badge>}
                    </p>
                    <p className="truncate text-xs text-fg-subtle">
                      {formatDate(r.issue_date)} · {r.name || r.doc_number}
                      {r.prd_number ? ` · PRD ${r.prd_number}${r.prd_at ? ` (${formatDate(r.prd_at)})` : ""}` : ""}
                      {r.sigaf_notified ? ` · SIGAF avisó el ${formatDate(r.sigaf_notified)}` : ""}
                      {r.paid_on ? ` · depositado ${formatDate(r.paid_on)}${r.days_to_pay != null ? ` (${r.days_to_pay} días)` : ""}` : ""}
                      {r.po_total && Math.abs(N(r.po_total) - N(r.total)) > 1 ? ` · OC por ${formatMoney(r.po_total)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:w-64 sm:justify-end">
                    <span className="text-sm font-medium tabular">{formatMoney(r.total)}</span>
                    {canEdit && r.stage === "sin_oc" && <LinkOrderButton voucherId={r.id} linked={false} total={N(r.total)} name={r.name} />}
                    {canEdit && (r.link_source === "auto" || r.link_source === "manual") && <LinkOrderButton voucherId={r.id} linked total={N(r.total)} name={r.name} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 26 · 47: facturas de proveedores del mail ↔ Mis Comprobantes Recibidos
// ---------------------------------------------------------------------------
type PC = { side: "mail" | "arca"; id: string; issue_date: string | null; cuit: string | null; name: string | null; point_of_sale: number | null; number: number | null; total: string | null; matched: boolean; detail: string | null };

function PcList({ xs, empty }: { xs: PC[]; empty: string }) {
  return !xs.length ? <p className="px-5 pb-4 text-xs text-fg-subtle">{empty}</p> : (
    <ul className="divide-y divide-border">
      {xs.slice(0, 80).map((r) => (
        <li key={`${r.side}${r.id}`} className="flex items-center gap-3 px-5 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{r.name ?? r.cuit}<span className="text-xs text-fg-subtle"> · {r.issue_date ? formatDate(r.issue_date) : "sin fecha"} · {nro(r.point_of_sale, r.number)}{r.side === "mail" && r.detail ? ` · ${r.detail}` : ""}</span></span>
          <span className="tabular">{formatMoney(r.total)}</span>
        </li>
      ))}
    </ul>
  );
}

export async function ComprasTab({ sb, org }: { sb: SupabaseClient; org: string }) {
  const since = daysAgo(120);
  const [{ data }, { data: pend }] = await Promise.all([
    sb.from("purchase_arca_check").select("*").eq("org_id", org).gte("issue_date", since).order("issue_date", { ascending: false }).limit(1000),
    sb.from("supplier_invoices").select("total, net, items_net, letter, issue_date").eq("org_id", org).eq("hidden", false).eq("source", "mail").eq("kind", "factura")
      .is("arca_voucher_id", null).gte("issue_date", daysAgo(60)).limit(500),
  ]);
  const rows = (data ?? []) as PC[];
  const ok = rows.filter((r) => r.side === "mail" && r.matched);
  const mailOnly = rows.filter((r) => r.side === "mail" && !r.matched);
  const arcaOnly = rows.filter((r) => r.side === "arca");
  const credit = ((pend ?? []) as { total: string; net: string | null; items_net: string | null; letter: string | null }[])
    .filter((x) => x.letter === "A").reduce((a, x) => a + Math.max(0, N(x.total) - N(x.net ?? x.items_net ?? x.total)), 0);
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CheckCircle2} label="Coinciden mail y ARCA" value={String(ok.length)} tone="accent" sub="últimos 4 meses" />
        <Stat icon={Mail} label="Llegaron por mail, ARCA no las tiene" value={String(mailOnly.length)} tone={mailOnly.length ? "warn" : undefined} sub={formatMoney(mailOnly.reduce((a, r) => a + N(r.total), 0))} />
        <Stat icon={FileQuestion} label="En ARCA sin el PDF" value={String(arcaOnly.length)} tone={arcaOnly.length ? "warn" : undefined} sub={formatMoney(arcaOnly.reduce((a, r) => a + N(r.total), 0))} />
        <Stat icon={Percent} label="IVA crédito que ARCA todavía no muestra" value={formatMoney(credit)} sub="facturas A del mail de los últimos 60 días" />
      </div>
      <Card><CardHeader title="Llegaron por mail y no están en Mis Comprobantes Recibidos" description="Puede ser que ARCA todavía no la procesó (tarda unos días), que el proveedor la anuló o que es apócrifa. Si pasan 10 días, consultala con el proveedor." /><PcList xs={mailOnly} empty="Todas las facturas del mail están en ARCA." /></Card>
      <Card><CardHeader title="Están en ARCA y no llegó el PDF por mail" description="Sólo de proveedores que suelen mandar la factura por mail. Pedíselas: sin el PDF no se cargan los precios ni el stock." /><PcList xs={arcaOnly} empty="No falta ningún PDF." /></Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 48 · 49 · 85: posición estimada y VEP pagados en el banco contra lo que correspondía
// ---------------------------------------------------------------------------
type Mov = { id: string; mov_date: string; detail: string; amount: string; direction: string | null };
type Notice = { id: string; at: string; title: string; kind: string; vep_number: string | null; paid_movement_id: string | null; system: string };

export async function ObligacionesTab({ sb, org, ownCuit, monthly, wh, iibbRate, iibbDay }: { sb: SupabaseClient; org: string; ownCuit: string; monthly: Monthly[]; wh: Withholding[]; iibbRate: number; iibbDay: number }) {
  const [{ data: movs }, { data: nts }] = await Promise.all([
    sb.from("bank_movements").select("id, mov_date, detail, amount, direction").eq("org_id", org).ilike("detail", "%VEP%").gte("mov_date", daysAgo(400)).order("mov_date", { ascending: false }).limit(300),
    sb.from("tax_notices_overview").select("id, at, title, kind, vep_number, paid_movement_id, system").eq("org_id", org).gte("at", daysAgo(150)).order("at", { ascending: false }).limit(60),
  ]);
  const veps = ((movs ?? []) as Mov[]).filter((m) => m.direction !== "credito" && m.direction !== "in");
  const cuitOf = (d: string) => d.match(/(\d{11})/)?.[1] ?? null;
  const own = veps.filter((m) => !ownCuit || cuitOf(m.detail) === ownCuit || !cuitOf(m.detail));
  const others = veps.filter((m) => !own.includes(m));
  const rows = monthRows(monthly, wh);
  const iva = ivaBalances(rows), iibb = iibbBalances(rows, iibbRate);
  const digit = Number(ownCuit.slice(-1) || 0);
  const cur = nowAr().slice(0, 7);
  // Mes de pago M: corresponde el período M-1
  const table = Array.from({ length: 6 }, (_, i) => shift(cur, -i)).map((pay) => {
    const per = shift(pay, -1);
    const i = iva.find((r) => r.month === per), b = iibb.find((r) => r.month === per);
    const paid = own.filter((m) => m.mov_date.startsWith(pay)).reduce((a, m) => a + N(m.amount), 0);
    const est = (i?.aPagar ?? 0) + (b?.aPagar ?? 0);
    return { pay, per, iva: i?.aPagar ?? 0, iibb: b?.aPagar ?? 0, est, paid, diff: paid - est };
  });
  // Posición del mes en curso (se paga el mes que viene)
  const now = iva.find((r) => r.month === cur);
  const due = businessDay(Number(shift(cur, 1).slice(0, 4)), Number(shift(cur, 1).slice(5)), IVA_DAY[digit]);
  const iibbNow = iibb.find((r) => r.month === cur);
  const nextIibb = businessDay(Number(shift(cur, 1).slice(0, 4)), Number(shift(cur, 1).slice(5)), iibbDay);
  const notices = (nts ?? []) as Notice[];
  const vepNotices = notices.filter((n) => n.vep_number || n.kind === "vep");
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Receipt} label={`IVA de ${monthLabel(cur)} (va a vencer)`} value={formatMoney(now?.aPagar ?? 0)} tone={(now?.aPagar ?? 0) > 0 ? "warn" : "accent"}
          sub={now ? `débito ${formatMoney(now.debito)} − crédito ${formatMoney(now.credito)}${now.prevTecnico ? ` − saldo ${formatMoney(now.prevTecnico)}` : ""} · vence ${formatDate(due)}` : `sin comprobantes de ${monthLabel(cur)} todavía`} />
        <Stat icon={Landmark} label={`IIBB de ${monthLabel(cur)} (estimado)`} value={formatMoney(iibbNow?.aPagar ?? 0)} sub={`${iibbRate}% menos retenciones y SIRCREB · vence ${formatDate(nextIibb)}`} />
        <Stat icon={Banknote} label="VEP pagados este año" value={formatMoney(own.filter((m) => m.mov_date.startsWith(cur.slice(0, 4))).reduce((a, m) => a + N(m.amount), 0))} sub={`${own.filter((m) => m.mov_date.startsWith(cur.slice(0, 4))).length} débitos del banco`} />
        <Stat icon={AlertTriangle} label="VEP de otros CUIT" value={formatMoney(others.reduce((a, m) => a + N(m.amount), 0))} sub={`${others.length} pagos desde tu cuenta para otra persona`} tone={others.length ? "warn" : undefined} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Lo que correspondía pagar vs. lo que salió del banco" description="Estimado = IVA + IIBB del mes anterior según tus comprobantes y retenciones. Pagado = débitos 'PAGO VEP' de tu CUIT en el banco ese mes. Si IIBB lo pagás por otro medio (AGIP, débito), no aparece como VEP." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular">
            <thead><tr className="text-xs text-fg-subtle"><th className="px-5 py-2 text-left font-medium">Mes de pago</th><th className="px-2 py-2 text-right font-medium">IVA</th><th className="px-2 py-2 text-right font-medium">IIBB</th><th className="px-2 py-2 text-right font-medium">Estimado</th><th className="px-2 py-2 text-right font-medium">VEP pagados</th><th className="px-5 py-2 text-right font-medium">Diferencia</th></tr></thead>
            <tbody className="divide-y divide-border">
              {table.map((r) => (
                <tr key={r.pay}>
                  <td className="px-5 py-2">{monthLabel(r.pay)} <span className="text-xs text-fg-subtle">(período {monthLabel(r.per)})</span></td>
                  <td className="px-2 py-2 text-right">{formatMoney(r.iva)}</td><td className="px-2 py-2 text-right">{formatMoney(r.iibb)}</td>
                  <td className="px-2 py-2 text-right font-medium">{formatMoney(r.est)}</td><td className="px-2 py-2 text-right">{formatMoney(r.paid)}</td>
                  <td className={cn("px-5 py-2 text-right font-medium", Math.abs(r.diff) > Math.max(5000, r.est * 0.05) ? (r.diff < 0 ? "text-danger" : "text-warn") : "text-fg-subtle")}>
                    {r.pay === cur && r.diff < 0 ? "pendiente" : formatMoney(r.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-5 py-2 text-xs text-fg-subtle">Pagado de más: puede incluir plan de pagos, autónomos, Ganancias o intereses. Pagado de menos: revisá si quedó un VEP sin pagar o si el contador presentó otra base.</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Débitos de VEP en el banco" description="Últimos 13 meses" />
          {!veps.length ? <p className="px-5 pb-4 text-xs text-fg-subtle">No hay débitos de VEP en los movimientos del banco cargados.</p> : (
            <ul className="max-h-96 divide-y divide-border overflow-auto">
              {veps.slice(0, 60).map((m) => { const c = cuitOf(m.detail); const mine = own.includes(m); return (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-20 text-xs text-fg-subtle">{formatDate(m.mov_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs">{mine ? "Tu CUIT" : <Badge tone="warn">CUIT {c}</Badge>}</span>
                  <span className="tabular">{formatMoney(m.amount)}</span>
                </li>
              ); })}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Avisos de ARCA y AGIP" description="VEP generados y notificaciones, con su pago si apareció en el banco" />
          {!notices.length ? <p className="px-5 pb-4 text-xs text-fg-subtle">No llegaron avisos de ARCA ni AGIP en los últimos 5 meses.</p> : (
            <ul className="max-h-96 divide-y divide-border overflow-auto">
              {notices.slice(0, 40).map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-5 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-fg-subtle">{formatDate(n.at)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate">{n.title}</span><span className="text-xs text-fg-subtle">{n.system}{n.vep_number ? ` · VEP ${n.vep_number}` : ""}</span></span>
                  {n.vep_number && (n.paid_movement_id ? <Badge tone="accent">Pagado</Badge> : <Badge tone="warn">Sin débito</Badge>)}
                </li>
              ))}
            </ul>
          )}
          {vepNotices.length > 0 && <p className="border-t border-border px-5 py-2 text-xs text-fg-subtle">{vepNotices.filter((n) => n.paid_movement_id).length} de {vepNotices.length} VEP avisados ya tienen el débito en el banco.</p>}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 50 · 51 · 52 · 53: IIBB por jurisdicción, SIRCREB, percepciones y límite anual
// ---------------------------------------------------------------------------
export type EmittedLite = { doc_number: string | null; name: string; net_taxed: number; net_untaxed: number; exempt: number; exchange_rate: number; sign: number; total: number };

export async function JurisdiccionesTab({ sb, org, m, emitted, wh, monthly, recibidosOther, settings, canEdit }: {
  sb: SupabaseClient; org: string; m: string; emitted: EmittedLite[]; wh: Withholding[]; monthly: Monthly[]; recibidosOther: number;
  settings: { annual_limit?: number | string | null; annual_limit_label?: string | null }; canEdit: boolean;
}) {
  const { data: jur } = await sb.from("customer_jurisdictions").select("doc_number, jurisdiction").eq("org_id", org).limit(2000);
  const saved = new Map(((jur ?? []) as { doc_number: string; jurisdiction: string }[]).map((x) => [x.doc_number, x.jurisdiction]));
  const net = (v: EmittedLite) => (N(v.net_taxed) + N(v.net_untaxed) + N(v.exempt)) * N(v.exchange_rate || 1) * N(v.sign);
  const byCustomer = new Map<string, { doc: string; name: string; net: number; n: number }>();
  for (const v of emitted) {
    const k = v.doc_number ?? v.name;
    const e = byCustomer.get(k) ?? { doc: v.doc_number ?? "", name: v.name, net: 0, n: 0 };
    e.net += net(v); e.n++; byCustomer.set(k, e);
  }
  const customers = [...byCustomer.values()].map((c) => ({ ...c, jur: saved.get(c.doc) ?? guessJurisdiction(c.name, c.doc), guessed: !saved.has(c.doc) })).sort((a, b) => b.net - a.net);
  const byJur = new Map<string, number>();
  for (const c of customers) byJur.set(c.jur, (byJur.get(c.jur) ?? 0) + c.net);
  const totalNet = customers.reduce((a, c) => a + c.net, 0);
  const w = wh.find((x) => x.month === m);
  // Límite anual: año calendario y últimos 12 meses
  const year = m.slice(0, 4);
  const em = monthly.filter((x) => x.direction === "emitido");
  const ytd = em.filter((x) => x.month.startsWith(year)).reduce((a, x) => a + N(x.total), 0);
  const cur = nowAr().slice(0, 7);
  const last12 = em.filter((x) => x.month > shift(cur, -12) && x.month <= cur).reduce((a, x) => a + N(x.total), 0);
  const limit = settings.annual_limit ? N(settings.annual_limit) : null;
  const monthsGone = Number(cur.slice(5));
  const projected = year === cur.slice(0, 4) && monthsGone > 0 ? (ytd / monthsGone) * 12 : ytd;
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={MapPin} label={`Ventas netas ${monthLabel(m)}`} value={formatMoney(totalNet)} sub={`${byJur.size} jurisdicciones · ${customers.length} clientes`} />
        <Stat icon={Banknote} label={`SIRCREB ${monthLabel(m)}`} value={formatMoney(w?.sircreb)} sub="retenido en el banco (pago a cuenta de IIBB)" />
        <Stat icon={Percent} label={`Percepciones ${monthLabel(m)}`} value={formatMoney(w?.percepciones ?? recibidosOther)} sub="en facturas de compra (IIBB / IVA)" />
        <Stat icon={Landmark} label={`Retenciones IIBB ${monthLabel(m)}`} value={formatMoney(w?.ret_iibb)} sub="en los cobros" />
      </div>

      <Card>
        <CardHeader title={`Límite anual de facturación ${year}`} description={settings.annual_limit_label ?? "Poné el tope que tengas que vigilar (categoría Pyme, régimen, monotributo de un familiar, etc.). Te avisa al 80% y al 100%."} />
        <div className="space-y-3 px-5 pb-5 text-sm">
          {limit ? (
            <>
              <div className="h-3 overflow-hidden rounded-full bg-field"><div className={cn("h-full rounded-full", ytd >= limit ? "bg-danger" : ytd >= limit * 0.8 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (ytd / limit) * 100)}%` }} /></div>
              <p className="flex flex-wrap justify-between gap-2 text-xs text-fg-muted"><span>Facturado {year}: <b className="tabular">{formatMoney(ytd)}</b> ({((ytd / limit) * 100).toFixed(1)}%)</span><span>Proyección al cierre: <b className={cn("tabular", projected > limit && "text-danger")}>{formatMoney(projected)}</b></span><span>Últimos 12 meses: <b className="tabular">{formatMoney(last12)}</b></span><span>Límite: <b className="tabular">{formatMoney(limit)}</b></span></p>
            </>
          ) : <p className="text-xs text-fg-subtle">Facturado {year}: <b className="tabular">{formatMoney(ytd)}</b> · últimos 12 meses {formatMoney(last12)}. Cargá un límite para que te avise.</p>}
          <AnnualLimitForm amount={limit} label={settings.annual_limit_label ?? null} disabled={!canEdit} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="self-start overflow-hidden">
          <CardHeader title="Por jurisdicción" description={`Base para el Convenio Multilateral · ${monthLabel(m)}`} />
          <table className="w-full text-sm tabular">
            <tbody className="divide-y divide-border">
              {[...byJur].sort((a, b) => b[1] - a[1]).map(([j, v]) => (
                <tr key={j}><td className="px-5 py-2">{j}</td><td className="px-2 py-2 text-right">{formatMoney(v)}</td><td className="px-5 py-2 text-right text-xs text-fg-subtle">{totalNet ? ((v / totalNet) * 100).toFixed(1) : "0"}%</td></tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-5 py-2 text-xs text-fg-subtle">El coeficiente del Convenio se arma con ingresos y gastos del año anterior; esto es la distribución de ventas del mes para controlar. Confirmalo con tu contador.</p>
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Clientes del mes" description="La jurisdicción en amarillo está estimada por el nombre: confirmala una vez y queda guardada." />
          {!customers.length ? <p className="px-5 pb-4 text-xs text-fg-subtle">No hay comprobantes emitidos en {monthLabel(m)}.</p> : (
            <ul className="divide-y divide-border">
              {customers.slice(0, 100).map((c) => (
                <li key={c.doc || c.name} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{c.name || c.doc}<span className="text-xs text-fg-subtle"> · {c.n} comp.{c.doc ? ` · ${c.doc}` : ""}</span></span>
                  <span className="tabular">{formatMoney(c.net)}</span>
                  {c.doc && /^\d{11}$/.test(c.doc) ? <JurisdictionSelect doc={c.doc} value={c.jur} guessed={c.guessed} disabled={!canEdit} /> : <Badge>{c.jur}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 54 · 55 · 86: padrón de proveedores, apócrifos y cambios de CBU
// ---------------------------------------------------------------------------
type Risk = { cuit: string; name: string | null; last_date: string | null; apocrifo_since: string | null; padron_status: string | null; padron_iva: string | null; padron_checked_at: string | null; risk: "apocrifo" | "inactivo" | null };
type Cbu = { domain: string; cbu: string; first_seen: string; last_seen: string; subject: string | null; from_name: string | null; previous_cbu: string | null };

export async function ProveedoresTab({ sb, org, canEdit, hasCert }: { sb: SupabaseClient; org: string; canEdit: boolean; hasCert: boolean }) {
  const [{ data: rk }, { data: meta }, { data: cb }, { data: errs }] = await Promise.all([
    sb.from("supplier_risks").select("*").eq("org_id", org).order("last_date", { ascending: false }).limit(400),
    sb.from("arca_apocrifos_meta").select("loaded_at, rows, error, tried_at").maybeSingle(),
    sb.from("supplier_bank_changes").select("*").eq("org_id", org).order("first_seen", { ascending: false }).limit(30),
    sb.from("supplier_padron").select("error, checked_at").eq("org_id", org).not("error", "is", null).order("checked_at", { ascending: false }).limit(1),
  ]);
  const risks = (rk ?? []) as Risk[];
  const bad = risks.filter((r) => r.risk);
  const checked = risks.filter((r) => r.padron_status);
  const m = meta as { loaded_at: string | null; rows: number | null; error: string | null; tried_at: string | null } | null;
  const lastErr = (errs?.[0] as { error: string } | undefined)?.error;
  const cbus = (cb ?? []) as Cbu[];
  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ShieldAlert} label="Proveedores con problema" value={String(bad.length)} tone={bad.length ? "danger" : "accent"} sub="apócrifos o CUIT inactivo" />
        <Stat icon={CheckCircle2} label="Revisados en el padrón" value={`${checked.length} de ${risks.length}`} sub="se revisan solos una vez por mes" />
        <Stat icon={FileQuestion} label="Base de apócrifos de ARCA" value={m?.rows ? m.rows.toLocaleString("es-AR") : "—"} sub={m?.loaded_at ? `actualizada ${formatDate(m.loaded_at)}` : m?.error ? "no se pudo bajar" : "todavía no se bajó"} tone={m?.error && !m.loaded_at ? "warn" : undefined} />
        <Stat icon={Banknote} label="Cambios de CBU" value={String(cbus.length)} tone={cbus.length ? "danger" : undefined} sub="últimos 90 días, en mails de proveedores" />
      </div>
      {canEdit && <div className="flex flex-wrap items-center gap-3"><RefreshSuppliersButton />{!hasCert && <span className="text-xs text-fg-subtle">Para el padrón hace falta el certificado de ARCA cargado en Configuración.</span>}</div>}
      {lastErr && /autoriz|permis|no est[aá] habilitad|computador|ws_sr|notAuthorized|Computador no autorizado/i.test(lastErr) && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <p className="font-medium">ARCA no deja consultar el padrón con tu certificado</p>
          <p className="mt-1 text-xs text-fg-muted">Entrá a ARCA con clave fiscal → <b>Administrador de Relaciones de Clave Fiscal</b> → Nueva relación → buscá <b>&quot;Consulta de Constancia de Inscripción&quot;</b> (ws_sr_constancia_inscripcion) → representante: el computador fiscal <b>octrack</b> → Confirmar. Después tocá &quot;Revisar proveedores ahora&quot;.</p>
          <p className="mt-1 text-xs text-fg-subtle">Detalle: {lastErr}</p>
        </div>
      )}
      {m?.error && <p className="text-xs text-warn">No se pudo bajar la base de apócrifos de ARCA ({m.error}). Se reintenta sola al día siguiente.</p>}

      {cbus.length > 0 && (
        <Card className="overflow-hidden border-danger/40">
          <CardHeader title="Un proveedor mandó un CBU distinto" description="Antes de transferir, confirmalo por teléfono con alguien que conozcas. Es la estafa más común: hackean el mail del proveedor y cambian el CBU." />
          <ul className="divide-y divide-border">
            {cbus.map((c) => (
              <li key={c.domain + c.cbu} className="px-5 py-2.5 text-sm">
                <p className="font-medium">{c.from_name ?? c.domain} <span className="text-xs font-normal text-fg-subtle">· {c.domain} · {formatDate(c.first_seen)}</span></p>
                <p className="text-xs text-fg-subtle tabular">Nuevo: <b className="text-danger">{c.cbu}</b> · antes: {c.previous_cbu}{c.subject ? ` · "${c.subject}"` : ""}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader title="Proveedores del último año" description="Estado del CUIT en el padrón de ARCA y control contra la base de facturas apócrifas. Una factura de un apócrifo no da crédito de IVA ni es gasto deducible." />
        {!risks.length ? <EmptyState title="Sin proveedores" description="Subí Mis Comprobantes Recibidos o esperá a que lleguen facturas por mail." /> : (
          <ul className="divide-y divide-border">
            {[...bad, ...risks.filter((r) => !r.risk)].slice(0, 150).map((r) => (
              <li key={r.cuit} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.name ?? r.cuit}<span className="text-xs text-fg-subtle"> · {r.cuit}{r.last_date ? ` · última ${formatDate(r.last_date)}` : ""}{r.padron_iva ? ` · ${r.padron_iva}` : ""}</span></span>
                {r.risk === "apocrifo" ? <Badge tone="danger">Apócrifo desde {r.apocrifo_since ? formatDate(r.apocrifo_since) : "—"}</Badge>
                  : r.risk === "inactivo" ? <Badge tone="danger">{r.padron_status}</Badge>
                  : r.padron_status ? <Badge tone="accent">Activo</Badge> : <Badge>Sin revisar</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
