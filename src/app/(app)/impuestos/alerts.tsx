import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, CalendarClock, Info } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { businessDay, iibbBalances } from "@/lib/taxes";
import { cn } from "@/lib/utils";
import { monthRows, type Monthly, type Withholding } from "./tax-tabs";
import { SircrebRateForm } from "./alerts-ui";

const N = (x: unknown) => Number(x ?? 0) || 0;
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString();
const daysAgoIso = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const shift = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); };

/** Avisos de ARCA e impuestos: facturas rechazadas u observadas, anticipo de IIBB, saldo a favor que crece y SIRCREB de más. */
export async function TaxAlerts({ sb, org, monthly, wh, iibbRate, iibbDay, sircrebRate, canEdit }: {
  sb: SupabaseClient; org: string; monthly: Monthly[]; wh: Withholding[]; iibbRate: number; iibbDay: number; sircrebRate: number | null; canEdit: boolean;
}) {
  const now = nowAr(), today = now.slice(0, 10), cur = now.slice(0, 7), prev = shift(cur, -1);
  const since = daysAgoIso(30);
  const [{ data: att }, { data: obs }] = await Promise.all([
    sb.from("einvoice_attempts").select("kind, receiver, total, error, created_at").eq("org_id", org).gte("created_at", since).order("created_at", { ascending: false }).limit(10),
    sb.from("arca_emissions").select("voucher_type, point_of_sale, number, receiver_name, total, observations, created_at").eq("org_id", org).not("observations", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(10),
  ]);
  type Item = { tone: "danger" | "warn" | "info"; title: string; detail: string };
  const items: Item[] = [];

  // 1: facturas rechazadas u observadas por ARCA
  for (const a of (att ?? []) as { kind: string; receiver: string; total: string; error: string; created_at: string }[])
    items.push({ tone: "danger", title: `ARCA rechazó una ${a.kind === "nota_credito" ? "nota de crédito" : "factura"} a ${a.receiver}`, detail: `${formatDateTime(a.created_at)} · ${formatMoney(a.total)} · ${a.error}` });
  for (const o of (obs ?? []) as { voucher_type: number; point_of_sale: number; number: number; receiver_name: string; total: string; observations: string; created_at: string }[])
    items.push({ tone: "warn", title: `Factura ${String(o.point_of_sale).padStart(5, "0")}-${String(o.number).padStart(8, "0")} autorizada con observaciones`, detail: `${o.receiver_name} · ${formatMoney(o.total)} · ${o.observations}` });

  // 40: anticipo de IIBB del mes anterior
  const rows = monthRows(monthly, wh);
  const bal = iibbBalances(rows, iibbRate);
  const p = bal.find((r) => r.month === prev);
  const due = businessDay(Number(cur.slice(0, 4)), Number(cur.slice(5)), iibbDay);
  if (p) items.push({ tone: p.aPagar > 0 && due >= today ? "warn" : "info",
    title: p.aPagar > 0 ? `Anticipo de IIBB de ${monthLabel(prev)}: ${formatMoney(p.aPagar)}` : `IIBB de ${monthLabel(prev)}: no hay que pagar`,
    detail: `${iibbRate}% sobre ventas netas ${formatMoney(p.netSales)} = ${formatMoney(p.impuesto)}, menos retenciones ${formatMoney(p.retIibb)} y SIRCREB ${formatMoney(p.sircreb)}${p.saldoFavor > 0 ? ` · queda a favor ${formatMoney(p.saldoFavor)}` : ""} · vence el ${formatDate(due)}` });

  // 41: saldo a favor de IIBB que crece 3 meses seguidos
  const last = bal.slice(-4);
  if (last.length === 4 && last.every((r, i) => i === 0 || r.saldoFavor > last[i - 1].saldoFavor) && last[3].saldoFavor > 0)
    items.push({ tone: "warn", title: `El saldo a favor de IIBB crece: ${formatMoney(last[3].saldoFavor)}`, detail: "Las retenciones y el SIRCREB superan el impuesto todos los meses. Con tu contador podés pedir exclusión o reducción de alícuota de SIRCREB/retenciones." });

  // 43: SIRCREB efectivo (retenido / acreditado) contra la alícuota del padrón
  const recent = wh.filter((w) => w.month >= shift(cur, -3) && N(w.creditos) > 0 && N(w.sircreb) > 0).sort((a, b) => b.month.localeCompare(a.month));
  const eff = recent.map((w) => ({ month: w.month, rate: (N(w.sircreb) / N(w.creditos)) * 100, sircreb: N(w.sircreb), creditos: N(w.creditos) }));
  if (eff.length && sircrebRate !== null && eff.some((e) => e.rate > sircrebRate + 0.1)) {
    const e = eff.find((x) => x.rate > sircrebRate + 0.1)!;
    items.push({ tone: "danger", title: `SIRCREB de más en ${monthLabel(e.month)}: ${e.rate.toFixed(2)}% vs ${sircrebRate}% del padrón`,
      detail: `Retuvieron ${formatMoney(e.sircreb)} sobre ${formatMoney(e.creditos)} acreditados; con tu alícuota correspondían ${formatMoney(e.creditos * sircrebRate / 100)}. Reclamá al banco o revisá el padrón.` });
  }

  // 57: impuesto al cheque del año computable a Ganancias
  const year = cur.slice(0, 4);
  const cheque = wh.filter((w) => w.month.startsWith(year)).reduce((a, w) => a + N(w.imp_cheque), 0);
  const chequeCred = wh.filter((w) => w.month.startsWith(year)).reduce((a, w) => a + N(w.imp_cheque_cred), 0);
  if (cheque > 0) items.push({ tone: "info", title: `Impuesto al cheque ${year}: ${formatMoney(cheque)}`, detail: `El 33% de lo cobrado sobre créditos (${formatMoney(chequeCred * 0.33)}) se descuenta de Ganancias; ya está restado en la pestaña Ganancias.` });

  if (!items.length && !eff.length) return null;
  const Icon = { danger: AlertTriangle, warn: AlertTriangle, info: Info };
  return (
    <Card className="mb-5 overflow-hidden">
      <CardHeader title="Avisos de ARCA e impuestos" action={<CalendarClock className="size-4 text-fg-subtle" />} />
      <ul className="divide-y divide-border">
        {items.map((a, i) => { const I = Icon[a.tone]; return (
          <li key={i} className="flex items-start gap-3 px-5 py-2.5 text-sm">
            <I className={cn("mt-0.5 size-4 shrink-0", a.tone === "danger" ? "text-danger" : a.tone === "warn" ? "text-warn" : "text-info")} />
            <div><p className="font-medium">{a.title}</p><p className="text-xs text-fg-subtle">{a.detail}</p></div>
          </li>
        ); })}
      </ul>
      {eff.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-fg-muted">
          <span>SIRCREB efectivo: {eff.map((e) => `${monthLabel(e.month)} ${e.rate.toFixed(2)}%`).join(" · ")}</span>
          {canEdit && <SircrebRateForm value={sircrebRate !== null ? String(sircrebRate) : ""} />}
        </div>
      )}
    </Card>
  );
}
