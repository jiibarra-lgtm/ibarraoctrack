import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Landmark, Mail, Receipt, ShoppingBasket, Sparkles, TrendingDown, Wallet } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { cn } from "@/lib/utils";
import { ActiveToggle, AddArcaButton, CATEGORY_LABEL, CostDialog, EditCost, PaidToggle } from "./cost-ui";
import { CostInsights } from "./insights";
import { CategorySelect, IgnoreToggle, VAR_CATEGORIES } from "./payee-ui";

export const metadata: Metadata = { title: "Gastos fijos" };

type Cost = { id: string; name: string; category: string; amount: string; frequency: number; due_day: number | null; active: boolean; source: string; supplier_cuit: string | null; notes: string | null; is_personal?: boolean };
type Bill = { id: string; cost_id: string; period: string; due_date: string | null; amount: string | null; paid: boolean; paid_at: string | null; source: string };

const curMonth = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const shift = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); };
const SOURCE: Record<string, { label: string; icon: React.ElementType }> = { mail: { label: "Mail", icon: Mail }, arca: { label: "ARCA", icon: Receipt }, manual: { label: "Manual", icon: Wallet }, banco: { label: "Banco (se repite todos los meses)", icon: Landmark } };
type Pay = { id: string; kind: string; paid_at: string; amount: string; payee: string; payee_key: string; concept: string | null; card: string | null; final_category: string; ignored: boolean; cost_id: string | null; cost_name: string | null };
const KIND: Record<string, string> = { transferencia: "Transferencia", tarjeta: "Tarjeta de débito", debito_automatico: "Débito automático", resumen_tarjeta: "Resumen de tarjeta" };

export default async function GastosFijosPage({ searchParams }: { searchParams: Promise<{ m?: string; v?: string }> }) {
  const sp = await searchParams;
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : curMonth();
  const view = sp.v === "variables" ? "variables" : sp.v === "movimientos" ? "movimientos" : sp.v === "analisis" ? "analisis" : "fijos";
  const s = await requireOrg();
  const canEdit = ["admin", "finanzas", "compras"].includes(s.org.role);
  const next = `${shift(m, 1)}-01`;
  const [{ data: costs }, { data: bills }, { data: sugg }, { data: monthly }, { data: pays }] = await Promise.all([
    s.supabase.from("fixed_costs").select("*").eq("org_id", s.org.org_id).order("category").order("name"),
    s.supabase.from("fixed_cost_bills").select("*").eq("org_id", s.org.org_id).eq("period", m),
    s.supabase.from("arca_recurring_suppliers").select("*").eq("org_id", s.org.org_id).order("is_service", { ascending: false }).order("months", { ascending: false }).order("avg_month", { ascending: false }).limit(40),
    s.supabase.from("arca_monthly").select("direction, net").eq("org_id", s.org.org_id).eq("month", m),
    s.supabase.from("payments_out_overview").select("id, kind, paid_at, amount, payee, payee_key, concept, card, final_category, ignored, cost_id, cost_name").eq("org_id", s.org.org_id).gte("paid_at", `${m}-01`).lt("paid_at", next).order("paid_at", { ascending: false }).limit(1000),
  ]);
  const payList = (pays ?? []) as Pay[];
  // Variables: lo que no es gasto fijo, ni resumen de tarjeta (ya incluye consumos), ni pago a proveedores, ni marcado personal
  const variables = payList.filter((p) => !p.cost_id && !p.ignored && p.kind !== "resumen_tarjeta" && !["proveedores", "compras"].includes(p.final_category));
  const varTotal = variables.reduce((a, p) => a + Number(p.amount), 0);
  const varByCat = Object.entries(variables.reduce<Record<string, { total: number; n: number; payees: Record<string, { name: string; total: number; n: number }> }>>((a, p) => {
    const c = (a[p.final_category] ??= { total: 0, n: 0, payees: {} });
    c.total += Number(p.amount); c.n++;
    const y = (c.payees[p.payee_key] ??= { name: p.payee, total: 0, n: 0 });
    y.total += Number(p.amount); y.n++;
    return a;
  }, {})).sort((a, b) => b[1].total - a[1].total);
  const list = (costs ?? []) as Cost[];
  const cuits = list.filter((c) => c.supplier_cuit).map((c) => c.supplier_cuit!);
  const { data: arcaMonth } = cuits.length
    ? await s.supabase.from("arca_vouchers_overview").select("doc_number, total, sign").eq("org_id", s.org.org_id).eq("direction", "recibido").in("doc_number", cuits).gte("issue_date", `${m}-01`).lt("issue_date", next)
    : { data: [] as { doc_number: string; total: string; sign: number }[] };
  const arcaBy = new Map<string, number>();
  (arcaMonth ?? []).forEach((v) => arcaBy.set(v.doc_number, (arcaBy.get(v.doc_number) ?? 0) + Number(v.total) * Number(v.sign)));
  const billBy = new Map(((bills ?? []) as Bill[]).map((b) => [b.cost_id, b]));

  const rows = list.map((c) => {
    const bill = billBy.get(c.id);
    const real = bill?.amount != null ? Number(bill.amount) : c.supplier_cuit && arcaBy.has(c.supplier_cuit) ? arcaBy.get(c.supplier_cuit)! : null;
    const expected = Number(c.amount) / c.frequency;
    return { c, bill, real, month: c.active ? (real ?? expected) : 0, expected };
  });
  const active = rows.filter((r) => r.c.active);
  const personalTotal = active.filter((r) => r.c.is_personal).reduce((a, r) => a + r.month, 0);
  const total = active.reduce((a, r) => a + r.month, 0);
  const paid = active.filter((r) => r.bill?.paid).reduce((a, r) => a + r.month, 0);
  const byCat = Object.entries(active.reduce<Record<string, number>>((a, r) => { a[r.c.category] = (a[r.c.category] ?? 0) + r.month; return a; }, {})).sort((a, b) => b[1] - a[1]);
  const ventas = Number((monthly ?? []).find((x) => x.direction === "emitido")?.net ?? 0);
  const compras = Number((monthly ?? []).find((x) => x.direction === "recibido")?.net ?? 0);
  const tabHref = (v: string) => `/gastos-fijos?${new URLSearchParams({ m, ...(v !== "fijos" ? { v } : {}) })}`;
  const groups = Object.keys(CATEGORY_LABEL).map((k) => [k, rows.filter((r) => r.c.category === k)] as const).filter(([, l]) => l.length);

  return (
    <>
      <PageHeader title="Gastos fijos" description="Lo que pagás todos los meses y en qué se va la plata. Servicios, débitos automáticos, sueldos y seguros se detectan solos desde tus mails y el banco; lo demás lo agregás vos."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-card-border bg-field p-1 text-sm">
              <Link href={`/gastos-fijos?m=${shift(m, -1)}`} className="rounded-full px-3 py-1 hover:bg-surface-solid">‹</Link>
              <span className="px-2 font-medium capitalize">{monthLabel(m)}</span>
              <Link href={`/gastos-fijos?m=${shift(m, 1)}`} className="rounded-full px-3 py-1 hover:bg-surface-solid">›</Link>
            </div>
            {canEdit && <CostDialog />}
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Wallet} label="Gastos fijos del mes" value={formatMoney(total)} sub={`${active.length} gastos activos`} />
        <Stat icon={CheckCircle2} label="Pagado" value={formatMoney(paid)} sub={`Falta ${formatMoney(Math.max(0, total - paid))}`} tone="accent" />
        <Stat icon={CalendarClock} label="Por vencer" value={String(active.filter((r) => r.bill && !r.bill.paid && r.bill.due_date).length)} sub="facturas recibidas sin pagar" tone="warn" />
        <Stat icon={ShoppingBasket} label="Gastos variables" value={formatMoney(varTotal)} sub={`${variables.length} pagos con tarjeta y transferencias`} href={tabHref("variables")} />
        <Stat icon={TrendingDown} label="Resultado del mes" value={formatMoney(ventas - compras - (total - personalTotal) - varTotal)} tone={ventas - compras - (total - personalTotal) - varTotal < 0 ? "danger" : undefined} sub={`ventas − compras − fijos − variables (sin IVA)${personalTotal ? " · sin los personales" : ""}`} />
      </div>

      <div className="mt-5 inline-flex rounded-full border border-card-border bg-field p-1 text-sm">
        {([["fijos", `Fijos (${active.length})`], ["variables", `Variables (${variables.length})`], ["movimientos", `Movimientos (${payList.length})`], ["analisis", "Detección y detalle"]] as const).map(([k, l]) => (
          <Link key={k} href={tabHref(k)} className={cn("rounded-full px-4 py-1.5 font-medium", view === k ? "bg-surface-solid text-brand shadow-sm" : "text-fg-muted hover:text-fg")}>{l}</Link>
        ))}
      </div>

      {view === "analisis" && <CostInsights sb={s.supabase} org={s.org.org_id} m={m} canEdit={canEdit} />}

      {view === "variables" && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader title="Gastos variables por rubro" description="Pagos con tarjeta y transferencias del mes que no son gastos fijos. Corregí el rubro o marcá como personal y queda para siempre." />
          {!varByCat.length ? <EmptyState icon={<ShoppingBasket />} title="Sin gastos variables este mes" description="Aparecen cuando el script de Gmail lea los avisos de Santander y Red Link." /> : (
            <ul className="divide-y divide-border">
              {varByCat.map(([cat, c]) => (
                <li key={cat} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{VAR_CATEGORIES[cat] ?? cat} <span className="font-normal text-fg-subtle">· {c.n} pagos</span></span>
                    <span className="tabular font-semibold">{formatMoney(c.total)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-field"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${varTotal ? Math.round((c.total / varTotal) * 100) : 0}%` }} /></div>
                  <ul className="mt-2 grid gap-1">
                    {Object.entries(c.payees).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([k, y]) => (
                      <li key={k} className="flex items-center gap-2 text-xs text-fg-muted">
                        <span className="min-w-0 flex-1 truncate">{y.name}{y.n > 1 ? ` (${y.n})` : ""}</span>
                        <span className="tabular">{formatMoney(y.total)}</span>
                        {canEdit && <><CategorySelect payeeKey={k} value={cat} /><IgnoreToggle payeeKey={k} ignored={false} /></>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {view === "movimientos" && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader title="Pagos del mes" description="Todo lo que salió de tus cuentas según los avisos del banco" />
          {!payList.length ? <EmptyState icon={<Landmark />} title="Sin pagos leídos este mes" /> : (
            <ul className="divide-y divide-border">
              {payList.map((p) => (
                <li key={p.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5", p.ignored && "opacity-50")}>
                  <span className="w-20 text-xs text-fg-subtle">{formatDate(p.paid_at)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate">{p.payee}</span>
                    <span className="text-xs text-fg-subtle">{KIND[p.kind] ?? p.kind}{p.concept ? ` · ${p.concept}` : ""}{p.card ? ` · tarjeta ${p.card}` : ""}{p.cost_name ? ` · fijo: ${p.cost_name}` : ""}{p.ignored ? " · personal" : ""}</span></span>
                  <span className="tabular font-medium">{formatMoney(p.amount)}</span>
                  {canEdit && <><CategorySelect payeeKey={p.payee_key} value={p.final_category} /><IgnoreToggle payeeKey={p.payee_key} ignored={p.ignored} /></>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {view === "fijos" && <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 overflow-hidden">
          {!rows.length ? (
            <EmptyState icon={<Wallet />} title="Todavía no hay gastos fijos"
              description="Agregá sueldos, alquiler y lo que pagues siempre. Las facturas de servicios aparecen solas cuando el script de Gmail las lea." />
          ) : groups.map(([cat, items]) => (
            <div key={cat} className="border-b border-border last:border-0">
              <p className="bg-surface-2/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle sm:px-5">{CATEGORY_LABEL[cat]}</p>
              <ul className="divide-y divide-border">
                {items.map(({ c, bill, real, expected }) => {
                  const S = SOURCE[c.source] ?? SOURCE.manual;
                  return (
                    <li key={c.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_150px_150px_120px] sm:px-5", !c.active && "opacity-50")}>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{c.name}</span>
                          {canEdit && <><EditCost id={c.id} initial={{ name: c.name, category: c.category as never, amount: String(Number(c.amount)).replace(".", ","), frequency: c.frequency, due_day: c.due_day ? String(c.due_day) : "", notes: c.notes ?? "" }} /><ActiveToggle id={c.id} active={c.active} /></>}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-fg-subtle"><S.icon className="size-3" />{S.label}
                          {c.frequency > 1 && ` · cada ${c.frequency} meses`}{c.due_day ? ` · vence el ${c.due_day}` : ""}{!c.active ? " · pausado" : ""}</p>
                      </div>
                      <div className="text-right text-sm tabular sm:text-left">
                        <p className="font-medium">{real != null ? formatMoney(real) : formatMoney(expected)}</p>
                        <p className="text-xs text-fg-subtle">{real != null ? (bill?.due_date ? `vence ${formatDate(bill.due_date)}` : "este mes") : c.frequency > 1 ? "prorrateado" : "estimado"}</p>
                      </div>
                      <p className="hidden text-xs text-fg-subtle sm:block">{real != null && Number(c.amount) && Math.abs(real - Number(c.amount)) > 1 ? `Habitual ${formatMoney(c.amount)}` : ""}</p>
                      <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
                        {c.active && canEdit && <PaidToggle costId={c.id} period={m} paid={!!bill?.paid} amount={String(real ?? expected)} billId={bill?.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </Card>

        <div className="flex flex-col gap-5 self-start">
          {byCat.length > 0 && (
            <Card>
              <CardHeader title="Por categoría" description={monthLabel(m)} />
              <ul className="divide-y divide-border">
                {byCat.map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{CATEGORY_LABEL[k] ?? k}</span>
                      <span className="mt-1 block h-1.5 rounded-full bg-field"><span className="block h-1.5 rounded-full bg-brand" style={{ width: `${total ? Math.round((v / total) * 100) : 0}%` }} /></span>
                    </span>
                    <span className="tabular font-medium">{formatMoney(v)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {canEdit && !!sugg?.length && (() => {
            type Sg = { cuit: string; name: string; months: number; avg_month: string; category: string | null; is_service: boolean };
            const all = sugg as Sg[];
            const services = all.filter((x) => x.is_service);
            const others = all.filter((x) => !x.is_service).slice(0, 8);
            const item = (x: Sg) => (
              <li key={x.cuit} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{x.name}</span>
                  <span className="text-xs text-fg-subtle">{x.category ? `${CATEGORY_LABEL[x.category] ?? x.category} · ` : ""}{x.months} de los últimos 6 meses · {formatMoney(x.avg_month)}/mes</span>
                </span>
                <AddArcaButton cuit={x.cuit} name={x.name} avg={String(x.avg_month)} category={x.category ?? "otros"} />
              </li>
            );
            return (
              <Card>
                <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4" /> Te facturan todos los meses</span>} description="Según ARCA. Los servicios se reconocen solos; marcá los que son gasto fijo." />
                {services.length > 0 && <ul className="divide-y divide-border">{services.map(item)}</ul>}
                {others.length > 0 && (
                  <details className="border-t border-border">
                    <summary className="cursor-pointer px-5 py-2.5 text-xs text-fg-subtle hover:text-fg">{others.length} proveedores frecuentes (probablemente mercadería, no gasto fijo)</summary>
                    <ul className="divide-y divide-border">{others.map(item)}</ul>
                  </details>
                )}
              </Card>
            );
          })()}
        </div>
      </div>}
    </>
  );
}
