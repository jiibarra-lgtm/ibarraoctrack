import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Landmark, Scale } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { suggestMatches, type MatchCandidate } from "@/lib/treasury";
import { cn } from "@/lib/utils";
import { RECON_LABEL, ReconcileControls, UnreconcileButton } from "../ui";

export const metadata: Metadata = { title: "Conciliación bancaria" };

type Mov = { id: string; mov_date: string; detail: string; amount: string; kind: string; direction: "in" | "out" | null; counterpart_name: string | null;
  explained: boolean; invoice_paid: string | null; supplier_invoice: string | null; invoices: string | null; payments_count: number };
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const shift = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const BANK_KINDS: Record<string, string> = {
  imp_cheque: "Impuesto al cheque", comision: "Comisión del banco", iva_banco: "IVA / percepción del banco", sircreb: "SIRCREB (IIBB)", interes_descubierto: "Interés por descubierto",
  interes_ganado: "Interés ganado", compra: "Compra con débito", debito_automatico: "Débito automático", extraccion: "Extracción", plazo_fijo_constitucion: "Plazo fijo", plazo_fijo_acreditacion: "Plazo fijo cobrado",
};
// El aviso de saldo llega a la mañana y muestra el cierre del día hábil anterior
const closeDay = (asOf: string) => { const t = Date.parse(asOf) - 3 * 3600e3; const h = new Date(t).getUTCHours(); return new Date(t - (h < 12 ? 864e5 : 0)).toISOString().slice(0, 10); };

export default async function ConciliacionPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const today = nowAr();
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const from = `${m}-01`, to = `${shift(m, 1)}-01`;
  const wFrom = `${shift(m, -1)}-15`, wTo = `${shift(m, 1)}-15`;
  const s = await requireOrg();
  const sb = s.supabase, org = s.org.org_id;
  const edit = canBill(s.org.role);
  const [{ data: movData }, { data: balData }, { data: rec }, { data: cheq }, { data: bills }, { data: cash }, { data: inv }] = await Promise.all([
    sb.from("bank_movements_overview").select("id, mov_date, detail, amount, kind, direction, counterpart_name, explained, invoice_paid, supplier_invoice, invoices, payments_count")
      .eq("org_id", org).gte("mov_date", from).lt("mov_date", to).order("mov_date").limit(5000),
    sb.from("bank_balances").select("as_of, balance").eq("org_id", org).gte("as_of", `${shift(m, -1)}-20`).lt("as_of", `${shift(m, 1)}-10`).order("as_of").limit(2000),
    sb.from("bank_reconciliations").select("bank_movement_id, kind, note").eq("org_id", org).limit(10000),
    sb.from("cheques").select("id, direction, status, amount, pay_date, counterpart_name, number, bank_movement_id").eq("org_id", org).gte("pay_date", wFrom).lt("pay_date", wTo).limit(2000),
    sb.from("fixed_cost_bills").select("id, amount, due_date, period, paid_at, bank_movement_id, fixed_costs(name)").eq("org_id", org).gte("due_date", wFrom).lt("due_date", wTo).limit(2000),
    sb.from("cash_movements").select("id, mov_date, direction, amount, concept").eq("org_id", org).eq("category", "banco").gte("mov_date", wFrom).lt("mov_date", wTo).limit(2000),
    sb.from("invoice_balances").select("invoice_id, invoice_type, point_of_sale, number, balance, due_date, issue_date").eq("org_id", org).gt("balance", 0).limit(2000),
  ]);
  const movs = ((movData ?? []) as Mov[]);
  const recBy = new Map(((rec ?? []) as { bank_movement_id: string; kind: string; note: string | null }[]).map((r) => [r.bank_movement_id, r]));
  type Ch = { id: string; direction: string; status: string; amount: string; pay_date: string; counterpart_name: string | null; number: string | null; bank_movement_id: string | null };
  type Bill = { id: string; amount: string; due_date: string | null; period: string; paid_at: string | null; bank_movement_id: string | null; fixed_costs: { name: string } | null };
  const cheques = (cheq ?? []) as Ch[];
  const billRows = (bills ?? []) as unknown as Bill[];
  const chequeBy = new Map(cheques.filter((c) => c.bank_movement_id).map((c) => [c.bank_movement_id!, c]));
  const billBy = new Map(billRows.filter((b) => b.bank_movement_id).map((b) => [b.bank_movement_id!, b]));

  // Candidatos para sugerir
  const cands: MatchCandidate[] = [
    ...cheques.filter((c) => (c.direction === "emitido" && c.status === "emitido") || (c.direction === "recibido" && ["depositado", "cartera"].includes(c.status)))
      .map((c) => ({ kind: "cheque", ref_id: c.id, label: `Cheque ${c.number ?? ""} ${c.counterpart_name ?? ""}`.trim(), amount: Number(c.amount), date: c.pay_date, dir: c.direction === "emitido" ? "out" as const : "in" as const })),
    ...billRows.filter((b) => !b.bank_movement_id && b.due_date).map((b) => ({ kind: "gasto_fijo", ref_id: b.id, label: `${b.fixed_costs?.name ?? "Gasto fijo"} ${b.period}`, amount: Number(b.amount), date: b.due_date!, dir: "out" as const })),
    ...((cash ?? []) as { id: string; mov_date: string; direction: "in" | "out"; amount: string; concept: string }[])
      .map((c) => ({ kind: "caja", ref_id: c.id, label: `Caja: ${c.concept}`, amount: Number(c.amount), date: c.mov_date, dir: c.direction === "in" ? "out" as const : "in" as const })),
    ...((inv ?? []) as { invoice_id: string; invoice_type: string; point_of_sale: string; number: string; balance: string; due_date: string | null; issue_date: string }[])
      .map((i) => ({ kind: "cobro", ref_id: i.invoice_id, label: `Factura ${i.invoice_type} ${i.point_of_sale}-${i.number}`, amount: Number(i.balance), date: i.due_date ?? i.issue_date, dir: "in" as const })),
  ];

  const reason = (x: Mov): string | null => {
    if (x.invoice_paid) return `Cobro: ${x.invoice_paid}`;
    if (x.supplier_invoice) return `Pago: ${x.supplier_invoice}`;
    if (x.payments_count > 0) return `Pago GCBA: ${x.invoices ?? ""}`;
    if (chequeBy.has(x.id)) return `Cheque ${chequeBy.get(x.id)!.number ?? ""} ${chequeBy.get(x.id)!.counterpart_name ?? ""}`;
    if (billBy.has(x.id)) return `${billBy.get(x.id)!.fixed_costs?.name ?? "Gasto fijo"} ${billBy.get(x.id)!.period}`;
    if (BANK_KINDS[x.kind]) return BANK_KINDS[x.kind];
    return null;
  };
  const rows = movs.map((x) => {
    const r = recBy.get(x.id);
    const auto = r ? null : reason(x);
    return { ...x, amountN: Number(x.amount), rec: r, auto, done: !!r || !!auto };
  });
  const pending = rows.filter((x) => !x.done);
  const done = rows.filter((x) => x.done);
  const noDir = rows.filter((x) => !x.direction).length;

  // Saldos: cierre del mes anterior y del mes
  const daily = new Map<string, number>();
  for (const b of (balData ?? []) as { as_of: string; balance: string }[]) daily.set(closeDay(b.as_of), Number(b.balance));
  const days = [...daily.keys()].sort();
  const openDay = days.filter((d) => d < from).at(-1);
  const closeD = days.filter((d) => d < to).at(-1);
  const opening = openDay ? daily.get(openDay)! : null;
  const closing = closeD && closeD >= from ? daily.get(closeD)! : null;
  const net = rows.filter((x) => !closeD || x.mov_date <= closeD).reduce((a, x) => a + (x.direction === "in" ? 1 : x.direction === "out" ? -1 : 0) * x.amountN, 0);
  const diff = opening !== null && closing !== null ? Math.round((closing - opening - net) * 100) / 100 : null;
  const pct = rows.length ? Math.round((done.length / rows.length) * 100) : 100;

  return (
    <>
      <PageHeader title="Conciliación bancaria" description="Cada movimiento del Banco Ciudad contra lo que corresponde: cobros, pagos a proveedores, gastos fijos, cheques y caja. Lo que el sistema ya explicó queda conciliado solo; lo demás lo confirmás con un clic."
        actions={<div className="flex gap-2 text-sm">
          <Link href={`/tesoreria/conciliacion?m=${shift(m, -1)}`} className="rounded-full border border-card-border bg-field px-3 py-1.5 text-fg-muted hover:text-fg">← {monthLabel(shift(m, -1))}</Link>
          {m < today.slice(0, 7) && <Link href={`/tesoreria/conciliacion?m=${shift(m, 1)}`} className="rounded-full border border-card-border bg-field px-3 py-1.5 text-fg-muted hover:text-fg">{monthLabel(shift(m, 1))} →</Link>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CheckCircle2} label={`Conciliado ${monthLabel(m)}`} value={`${pct}%`} sub={`${done.length} de ${rows.length} movimientos`} tone={pct === 100 ? "accent" : undefined} />
        <Stat icon={CircleDashed} label="Por conciliar" value={String(pending.length)} sub={formatMoney(pending.reduce((a, x) => a + x.amountN, 0))} tone={pending.length ? "warn" : undefined} />
        <Stat icon={Landmark} label="Saldo según el banco" value={closing !== null ? formatMoney(closing) : "—"} sub={closeD ? `cierre ${formatDate(closeD)}` : "sin aviso de saldo en el mes"} />
        <Stat icon={Scale} label="Diferencia de saldos" value={diff === null ? "—" : formatMoney(diff)} tone={diff !== null && Math.abs(diff) > 1 ? "danger" : diff !== null ? "accent" : undefined}
          sub={diff === null ? "faltan avisos de saldo" : Math.abs(diff) > 1 ? "falta algún movimiento en los avisos" : "saldo inicial + movimientos = saldo final"} />
      </div>

      {opening !== null && closing !== null && (
        <Card className="mt-5">
          <CardHeader title="Control de saldos" description="Si la diferencia no es cero, hay movimientos que no llegaron en los avisos del banco (o se marcaron con el sentido equivocado)." />
          <div className="grid gap-2 px-5 pb-5 text-sm sm:grid-cols-4">
            <p>Saldo inicial ({formatDate(openDay!)}): <b className="tabular">{formatMoney(opening)}</b></p>
            <p>+ Entradas − salidas: <b className="tabular">{formatMoney(net)}</b></p>
            <p>= Saldo calculado: <b className="tabular">{formatMoney(opening + net)}</b></p>
            <p>Saldo del banco ({formatDate(closeD!)}): <b className="tabular">{formatMoney(closing)}</b></p>
            {noDir > 0 && <p className="text-warn sm:col-span-4">{noDir} movimientos sin saber si entraron o salieron: marcalos en <Link href="/banco?v=dudosos" className="underline">Banco</Link>.</p>}
          </div>
        </Card>
      )}

      <Card className="mt-5 overflow-hidden">
        <CardHeader title={`Por conciliar · ${pending.length}`} description="Las sugerencias son por mismo importe y fecha cercana. “Otro…” para decir a mano qué es." />
        {!pending.length ? <EmptyState icon={<CheckCircle2 />} title="Todo conciliado" description={`Todos los movimientos de ${monthLabel(m)} tienen su explicación.`} /> : (
          <ul className="divide-y divide-border">
            {pending.map((x) => {
              const sug = x.direction ? suggestMatches({ amount: x.amountN, mov_date: x.mov_date, direction: x.direction }, cands) : [];
              return (
                <li key={x.id} className="flex flex-col gap-2 px-5 py-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm"><span className="tabular text-fg-muted">{formatDate(x.mov_date)}</span> · <span className={cn("font-medium tabular", x.direction === "in" ? "text-accent" : "")}>{x.direction === "in" ? "+" : x.direction === "out" ? "−" : "?"}{formatMoney(x.amount)}</span></p>
                    <p className="truncate text-xs text-fg-subtle">{x.counterpart_name ? `${x.counterpart_name} · ` : ""}{x.detail}</p>
                  </div>
                  {edit && x.direction && <ReconcileControls movementId={x.id} direction={x.direction} suggestions={sug.map((g) => ({ kind: g.kind, ref_id: g.ref_id, label: g.label }))} />}
                  {!x.direction && <Link href="/banco?v=dudosos" className="text-xs text-warn underline">Marcar si entró o salió</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <details className="glass mt-5 rounded-2xl">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Conciliados · {done.length}</summary>
        <ul className="divide-y divide-border border-t border-border">
          {done.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
              <span className="w-20 tabular text-fg-muted">{formatDate(x.mov_date)}</span>
              <span className={cn("w-32 text-right tabular", x.direction === "in" && "text-accent")}>{x.direction === "in" ? "+" : "−"}{formatMoney(x.amount)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{x.detail}</span>
              {x.rec ? <><Badge tone="info">{RECON_LABEL[x.rec.kind] ?? x.rec.kind}{x.rec.note ? `: ${x.rec.note}` : ""}</Badge>{edit && <UnreconcileButton movementId={x.id} />}</>
                : <Badge tone="accent">{x.auto}</Badge>}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
