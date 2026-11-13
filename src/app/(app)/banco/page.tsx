import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CircleHelp, Landmark, Scale } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DirectionButtons } from "./ui";
import { VAR_CATEGORIES } from "@/lib/expense-categories";

export const metadata: Metadata = { title: "Banco" };

type Mov = { id: string; account: string; mov_date: string; detail: string; amount: string; kind: string; direction: "in" | "out" | null; direction_source: string | null;
  counterpart_cuit: string | null; counterpart_name: string | null; explained: boolean; invoice_paid: string | null; supplier_invoice: string | null; invoices: string | null };
type Bal = { account: string; as_of: string; balance: string };
type CardAlert = { message_id: string; at: string; card: string; kind: string; debited: string | null; missing: string | null };
type Statement = { card: string; due_date: string; total: string; paid: string; closed_at: string };
type Consumo = { paid_at: string; amount: string; payee: string; payee_key: string; final_category: string; ignored: boolean; card: string | null };
type Pay = { kind: string; paid_at: string; amount: string; card: string | null; due_date: string | null; payee: string };

const KIND_LABEL: Record<string, string> = {
  gcba: "Pago GCBA", sircreb: "SIRCREB", pago_recibido: "Pago recibido", transferencia: "Transferencia", deposito: "Depósito", cheque_depositado: "Cheque depositado",
  cheque_pagado: "Cheque pagado", cheque_rechazado: "Cheque rechazado", compra: "Compra con débito", debito_automatico: "Débito automático", extraccion: "Extracción",
  imp_cheque: "Impuesto al cheque", comision: "Comisión", iva_banco: "IVA / percepción", interes_descubierto: "Interés por descubierto", interes_ganado: "Interés ganado",
  plazo_fijo_constitucion: "Plazo fijo (alta)", plazo_fijo_acreditacion: "Plazo fijo (cobro)", devolucion: "Devolución", embargo: "Embargo", otro: "Otro",
};
const BANK_COSTS = ["imp_cheque", "comision", "iva_banco", "interes_descubierto", "sircreb"];
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const VIEWS = [{ v: "todos", l: "Todos" }, { v: "entradas", l: "Entradas" }, { v: "salidas", l: "Salidas" }, { v: "sin", l: "Sin explicar" }, { v: "dudosos", l: "¿Entró o salió?" }];

export default async function BancoPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const view = VIEWS.some((x) => x.v === sp.v) ? sp.v! : "todos";
  const s = await requireOrg();
  const sb = s.supabase, org = s.org.org_id;
  const canEdit = canBill(s.org.role);
  const today = nowAr(), month = today.slice(0, 7);
  const [{ data: movData }, { data: balData }, { data: alertData }, { data: payData }, { data: stData }, { data: conData }] = await Promise.all([
    sb.from("bank_movements_overview").select("id, account, mov_date, detail, amount, kind, direction, direction_source, counterpart_cuit, counterpart_name, explained, invoice_paid, supplier_invoice, invoices")
      .eq("org_id", org).gte("mov_date", daysAgo(400)).order("mov_date", { ascending: false }).limit(5000),
    sb.from("bank_balances").select("account, as_of, balance").eq("org_id", org).gte("as_of", daysAgo(120)).order("as_of", { ascending: false }).limit(500),
    sb.from("card_alerts").select("*").eq("org_id", org).gte("at", daysAgo(60)).order("at", { ascending: false }),
    sb.from("payments_out").select("kind, paid_at, amount, card, due_date, payee").eq("org_id", org).in("kind", ["tarjeta", "resumen_tarjeta", "debito_automatico"]).gte("paid_at", daysAgo(150)).order("paid_at", { ascending: false }).limit(2000),
    sb.from("card_statements").select("*").eq("org_id", org).gte("due_date", daysAgo(200)).order("due_date", { ascending: false }).limit(12),
    sb.from("payments_out_overview").select("paid_at, amount, payee, payee_key, final_category, ignored, card").eq("org_id", org).eq("kind", "tarjeta").gte("paid_at", `${month}-01`).limit(2000),
  ]);
  const statements = (stData ?? []) as Statement[];
  const consumos = ((conData ?? []) as Consumo[]);
  const movs = (movData ?? []) as Mov[];
  const bals = (balData ?? []) as Bal[];
  const alerts = (alertData ?? []) as CardAlert[];
  const pays = (payData ?? []) as Pay[];

  if (!movs.length && !bals.length) {
    return (
      <>
        <PageHeader title="Banco" description="Todos los movimientos del Banco Ciudad, leídos de los avisos diarios" />
        <Card><EmptyState icon={<Landmark />} title="Todavía no llegaron avisos completos" description="Cuando el script de Gmail lea los avisos de 'Últimos movimientos' del Banco Ciudad aparecen acá, con el saldo y cada entrada y salida." /></Card>
      </>
    );
  }

  // Saldo actual por cuenta (último aviso)
  const lastByAcc = new Map<string, Bal>();
  for (const b of bals) if (!lastByAcc.has(b.account)) lastByAcc.set(b.account, b);
  const balance = [...lastByAcc.values()].reduce((a, b) => a + Number(b.balance), 0);
  // Saldo de cierre por día (último aviso del día), últimos 30 días
  const daily = new Map<string, number>();
  for (const b of bals) { const d = new Date(Date.parse(b.as_of) - 3 * 3600e3).toISOString().slice(0, 10); if (!daily.has(d)) daily.set(d, Number(b.balance)); }
  const dailyList = [...daily.entries()].slice(0, 30).reverse();
  const maxAbs = Math.max(1, ...dailyList.map(([, v]) => Math.abs(v)));

  const monthMovs = movs.filter((m) => m.mov_date.startsWith(month));
  const sumOf = (xs: Mov[]) => xs.reduce((a, m) => a + Number(m.amount), 0);
  const inMonth = monthMovs.filter((m) => m.direction === "in"), outMonth = monthMovs.filter((m) => m.direction === "out");
  const unknown = movs.filter((m) => !m.direction);
  const unexplained = movs.filter((m) => m.direction && !m.explained && m.kind !== "gcba" && m.mov_date >= daysAgo(60));

  // Alertas
  type Alert = { tone: "danger" | "warn"; title: string; detail: string };
  const warn: Alert[] = [];
  const negDays = dailyList.filter(([, v]) => v < 0);
  if (balance < 0) warn.push({ tone: "danger", title: "Saldo negativo", detail: `La cuenta está en ${formatMoney(balance)}. Cubrila para no pagar intereses por descubierto.` });
  else if (negDays.length) warn.push({ tone: "warn", title: `Estuviste en negativo ${negDays.length} día${negDays.length === 1 ? "" : "s"}`, detail: `El peor: ${formatMoney(Math.min(...negDays.map(([, v]) => v)))}` });
  for (const m of movs.filter((x) => x.kind === "embargo" && x.mov_date >= daysAgo(90)))
    warn.push({ tone: "danger", title: "Embargo o bloqueo judicial", detail: `${formatDate(m.mov_date)} · ${formatMoney(m.amount)} · ${m.detail}` });
  for (const m of movs.filter((x) => (x.kind === "cheque_rechazado" || (x.kind === "devolucion" && /TRANSF/i.test(x.detail))) && x.mov_date >= daysAgo(30)))
    warn.push({ tone: "warn", title: m.kind === "cheque_rechazado" ? "Cheque rechazado" : "Transferencia devuelta", detail: `${formatDate(m.mov_date)} · ${formatMoney(m.amount)} · ${m.detail}` });
  const intMonth = sumOf(monthMovs.filter((m) => m.kind === "interes_descubierto"));
  if (intMonth > 0) warn.push({ tone: "warn", title: "Intereses por descubierto este mes", detail: `${formatMoney(intMonth)} pagados por estar en rojo` });
  for (const a of alerts.filter((x) => x.kind === "parcial")) warn.push({ tone: "danger", title: `${a.card}: no se pudo debitar todo`, detail: `${formatDateTime(a.at)} · debitado ${formatMoney(a.debited)} · faltan ${formatMoney(a.missing)}` });
  // Tarjeta: aviso 3 días antes del débito si no está pagada, y resúmenes vencidos con saldo
  for (const st of statements) {
    const left = Number(st.total) - Number(st.paid);
    const days = Math.round((Date.parse(st.due_date) - Date.parse(today)) / 864e5);
    if (left > 1 && days >= 0 && days <= 3)
      warn.push({ tone: "warn", title: `${st.card}: se debitan ${formatMoney(left)} ${days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`}`, detail: `Vence el ${formatDate(st.due_date)}. Dejá la plata disponible en Mercado Pago${balance ? ` (en el Ciudad tenés ${formatMoney(balance)})` : ""}.` });
    else if (left > 1 && days < 0 && days > -40)
      warn.push({ tone: "danger", title: `${st.card}: quedan ${formatMoney(left)} sin pagar`, detail: `Venció el ${formatDate(st.due_date)}; total ${formatMoney(st.total)}, debitado ${formatMoney(st.paid)}. Genera intereses.` });
  }
  if (unknown.length) warn.push({ tone: "warn", title: `${unknown.length} transferencias sin saber si entraron o salieron`, detail: "Marcalas una vez y después se reconocen solas por CUIT/CBU." });

  // Costos del banco por mes (últimos 6)
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 - i, 1)); return d.toISOString().slice(0, 7); });
  const costRows = BANK_COSTS.map((k) => ({ k, vals: months.map((mo) => sumOf(movs.filter((m) => m.kind === k && m.mov_date.startsWith(mo)))) }));
  const byKindMonth = Object.entries(outMonth.reduce<Record<string, number>>((a, m) => ({ ...a, [m.kind]: (a[m.kind] ?? 0) + Number(m.amount) }), {})).sort((a, b) => b[1] - a[1]);

  // Tarjetas: resumen vs consumos con la misma tarjeta en los 35 días antes del vencimiento
  const summaries = pays.filter((p) => p.kind === "resumen_tarjeta").slice(0, 6).map((r) => {
    const due = r.due_date ?? r.paid_at, from = new Date(Date.parse(due) - 45 * 864e5).toISOString().slice(0, 10), to = new Date(Date.parse(due) - 10 * 864e5).toISOString().slice(0, 10);
    const cons = pays.filter((p) => p.kind !== "resumen_tarjeta" && (!r.card || p.card === r.card) && p.paid_at >= from && p.paid_at <= to);
    return { ...r, due, consumos: cons.reduce((a, p) => a + Number(p.amount), 0), n: cons.length };
  });

  const list = (view === "entradas" ? movs.filter((m) => m.direction === "in") : view === "salidas" ? movs.filter((m) => m.direction === "out")
    : view === "sin" ? unexplained : view === "dudosos" ? unknown : movs).slice(0, 300);
  const SRC: Record<string, string> = { saldo: "deducido por el saldo", regla: "por contraparte conocida", usuario: "marcado por vos" };

  return (
    <>
      <PageHeader title="Banco" description="Banco Ciudad: cada movimiento, el saldo y a qué factura corresponde, leído solo de los avisos diarios" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Scale} label="Saldo" value={formatMoney(balance)} sub={lastByAcc.size ? `al ${formatDateTime([...lastByAcc.values()][0].as_of)}` : "sin aviso de saldo"} tone={balance < 0 ? "danger" : undefined} />
        <Stat icon={ArrowDownLeft} label="Entró este mes" value={formatMoney(sumOf(inMonth))} sub={`${inMonth.length} movimientos`} tone="accent" />
        <Stat icon={ArrowUpRight} label="Salió este mes" value={formatMoney(sumOf(outMonth))} sub={`${outMonth.length} movimientos`} />
        <Stat icon={CircleHelp} label="Sin explicar (60 días)" value={String(unexplained.length)} sub={unknown.length ? `${unknown.length} sin dirección` : "sin factura ni rubro"} tone={unexplained.length ? "warn" : undefined} href="/banco?v=sin" />
      </div>

      {warn.length > 0 && (
        <Card className="mb-5 overflow-hidden">
          <CardHeader title="Alertas del banco" />
          <ul className="divide-y divide-border">
            {warn.map((a, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", a.tone === "danger" ? "text-danger" : "text-warn")} />
                <div><p className="font-medium">{a.title}</p><p className="text-xs text-fg-subtle">{a.detail}</p></div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Saldo de cada día" description="Último aviso de cada día, últimos 30 días" />
          {dailyList.length ? (
            <div className="flex h-40 items-end gap-1 px-5 py-4">
              {dailyList.map(([d, v]) => (
                <div key={d} className="group relative flex h-full flex-1 flex-col justify-end" title={`${formatDate(d)}: ${formatMoney(v)}`}>
                  <div className={cn("w-full rounded-t", v < 0 ? "bg-danger" : "bg-primary/70")} style={{ height: `${Math.max(3, (Math.abs(v) / maxAbs) * 100)}%` }} />
                </div>
              ))}
            </div>
          ) : <p className="px-5 py-6 text-sm text-fg-subtle">Todavía no hay avisos con saldo.</p>}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="En qué se fue la plata este mes" />
          <ul className="divide-y divide-border">
            {byKindMonth.map(([k, v]) => (
              <li key={k} className="flex justify-between px-5 py-2 text-sm"><span>{KIND_LABEL[k] ?? k}</span><span className="tabular font-medium">{formatMoney(v)}</span></li>
            ))}
            {!byKindMonth.length && <li className="px-5 py-4 text-sm text-fg-subtle">Sin salidas este mes.</li>}
          </ul>
        </Card>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Lo que te cobra el banco" description="Impuesto al cheque, comisiones, IVA, intereses y SIRCREB por mes" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-fg-subtle"><th className="px-5 py-2 font-medium">Concepto</th>{months.map((mo) => <th key={mo} className="px-2 py-2 text-right font-medium">{mo.slice(5)}/{mo.slice(2, 4)}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {costRows.map((r) => (
                  <tr key={r.k}><td className="px-5 py-2">{KIND_LABEL[r.k]}</td>{r.vals.map((v, i) => <td key={i} className="px-2 py-2 text-right tabular">{v ? formatMoney(v) : "—"}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-2 text-xs text-fg-subtle">El impuesto al cheque sobre créditos es 33% computable a cuenta de Ganancias: está sumado en <Link className="underline" href="/impuestos">Impuestos</Link>.</p>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Tarjetas: resumen vs. consumos" description="Total del resumen comparado con los consumos que llegaron por mail en ese período" />
          <ul className="divide-y divide-border">
            {summaries.map((r, i) => {
              const diff = Number(r.amount) - r.consumos;
              return (
                <li key={i} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div><p className="font-medium">{r.payee}</p><p className="text-xs text-fg-subtle">Vence {formatDate(r.due)} · {r.n} consumos por {formatMoney(r.consumos)}</p></div>
                  <div className="text-right tabular"><p className="font-semibold">{formatMoney(r.amount)}</p>
                    {r.n > 0 && Math.abs(diff) > Number(r.amount) * 0.1 && <p className="text-[11px] text-warn">{diff > 0 ? `${formatMoney(diff)} más que los consumos (cuotas, impuestos o intereses)` : `${formatMoney(-diff)} menos que los consumos`}</p>}
                  </div>
                </li>
              );
            })}
            {!summaries.length && <li className="px-5 py-4 text-sm text-fg-subtle">No llegaron resúmenes de tarjeta en los últimos meses.</li>}
          </ul>
        </Card>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Tarjeta Mercado Pago" description="Cada cierre con su total, vencimiento y cuánto se debitó (leído de los avisos de Mercado Pago)" />
          <ul className="divide-y divide-border">
            {statements.map((st) => {
              const left = Number(st.total) - Number(st.paid);
              return (
                <li key={st.due_date} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div><p className="font-medium">Vence {formatDate(st.due_date)}</p><p className="text-xs text-fg-subtle">Cerró el {formatDate(st.closed_at)}</p></div>
                  <div className="text-right tabular"><p className="font-semibold">{formatMoney(st.total)}</p>
                    <p className={cn("text-[11px]", left <= 1 ? "text-accent" : st.due_date < today ? "font-medium text-danger" : "text-fg-subtle")}>{left <= 1 ? "pagado" : st.due_date < today ? `faltan ${formatMoney(left)}` : Number(st.paid) > 0 ? `debitado ${formatMoney(st.paid)}` : "por debitar"}</p></div>
                </li>
              );
            })}
            {!statements.length && <li className="px-5 py-4 text-sm text-fg-subtle">Todavía no llegaron avisos de cierre de la tarjeta.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Consumos con tarjeta por rubro (este mes)" description="Del negocio cuentan como gasto; los marcados personales quedan aparte" action={<Link href="/gastos-fijos?v=variables" className="text-xs underline">Clasificar</Link>} />
          <ul className="divide-y divide-border">
            {Object.entries(consumos.reduce<Record<string, { biz: number; pers: number; n: number }>>((a, c) => {
              const x = (a[c.final_category] ??= { biz: 0, pers: 0, n: 0 }); if (c.ignored) x.pers += Number(c.amount); else x.biz += Number(c.amount); x.n++; return a;
            }, {})).sort((a, b) => b[1].biz + b[1].pers - a[1].biz - a[1].pers).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                <span>{VAR_CATEGORIES[k] ?? k} <span className="text-xs text-fg-subtle">· {v.n}</span></span>
                <span className="text-right tabular"><span className="font-medium">{formatMoney(v.biz)}</span>{v.pers > 0 && <span className="ml-2 text-xs text-fg-subtle">+ {formatMoney(v.pers)} personal</span>}</span>
              </li>
            ))}
            {!consumos.length && <li className="px-5 py-4 text-sm text-fg-subtle">Sin consumos con tarjeta leídos este mes (llegan de los avisos &quot;Pagaste&quot; de Santander).</li>}
          </ul>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Movimientos" description="Cada uno con lo que explica: factura cobrada, factura de proveedor pagada o el rubro" action={
          <div className="flex flex-wrap gap-1">{VIEWS.map((x) => <Link key={x.v} href={`/banco?v=${x.v}`} className={cn("rounded-full px-2.5 py-1 text-xs", view === x.v ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg-muted")}>{x.l}</Link>)}</div>
        } />
        <ul className="divide-y divide-border">
          {list.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{m.counterpart_name ?? m.detail}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                  <span>{formatDate(m.mov_date)}</span><Badge>{KIND_LABEL[m.kind] ?? m.kind}</Badge>
                  {m.direction_source && SRC[m.direction_source] && <span>{SRC[m.direction_source]}</span>}
                  {(m.invoice_paid || m.invoices) && <Badge tone="accent">cobra {m.invoice_paid ?? m.invoices}</Badge>}
                  {m.supplier_invoice && <Badge tone="info">paga {m.supplier_invoice}</Badge>}
                  {m.counterpart_name && <span className="truncate">{m.detail}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {!m.direction && canEdit && <DirectionButtons id={m.id} />}
                <span className={cn("tabular font-semibold", m.direction === "in" ? "text-accent" : m.direction === "out" ? "" : "text-fg-muted")}>
                  {m.direction === "in" ? "+" : m.direction === "out" ? "−" : "±"}{formatMoney(m.amount)}
                </span>
              </div>
            </li>
          ))}
          {!list.length && <li className="px-5 py-6 text-sm text-fg-subtle">Nada en esta vista.</li>}
        </ul>
      </Card>
    </>
  );
}
