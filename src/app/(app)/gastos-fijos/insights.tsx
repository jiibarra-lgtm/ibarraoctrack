import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, CalendarClock, FileWarning, Percent, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { businessDaysInMonth } from "@/lib/taxes";
import { cn } from "@/lib/utils";
import { CostSettings, PersonalToggle } from "./insights-ui";

type Cost = { id: string; name: string; category: string; amount: string; frequency: number; due_day: number | null; active: boolean; supplier_cuit: string | null; is_personal: boolean };
type Bill = { cost_id: string | null; period: string; due_date: string | null; amount: string | null; paid: boolean };
type V = { doc_number: string; issue_date: string; voucher_type: number; vat: string; total: string; credit_note: boolean; name: string };

const shift = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); };
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const LETTER_A = new Set([1, 2, 3, 51, 52, 53, 201, 202, 203]);
const LETTER_B = new Set([6, 7, 8, 206, 207, 208]);

/** Detección y detalle de gastos fijos: aumentos, faltantes, vencidos, renovaciones, IVA recuperable y proyección. */
export async function CostInsights({ sb, org, m, canEdit }: { sb: SupabaseClient; org: string; m: string; canEdit: boolean }) {
  const today = todayAr();
  const from = shift(m, -24);
  const [{ data: costData }, { data: billData }, { data: setData }] = await Promise.all([
    sb.from("fixed_costs").select("id, name, category, amount, frequency, due_day, active, supplier_cuit, is_personal").eq("org_id", org),
    sb.from("fixed_cost_bills").select("cost_id, period, due_date, amount, paid").eq("org_id", org).gte("period", from).limit(5000),
    sb.from("tax_settings").select("inflation_monthly, cost_alert_pct").eq("org_id", org).maybeSingle(),
  ]);
  const costs = ((costData ?? []) as Cost[]).filter((c) => c.active);
  const bills = (billData ?? []) as Bill[];
  const inf = Number(setData?.inflation_monthly ?? 2.5) / 100;
  const alertPct = Number(setData?.cost_alert_pct ?? 10) / 100;
  const cuits = [...new Set(costs.map((c) => c.supplier_cuit).filter(Boolean))] as string[];
  const { data: vData } = cuits.length
    ? await sb.from("arca_vouchers").select("doc_number, issue_date, voucher_type, vat, total, credit_note, name").eq("org_id", org).eq("direction", "recibido").in("doc_number", cuits).gte("issue_date", `${shift(m, -13)}-01`).limit(5000)
    : { data: [] };
  const vouchers = (vData ?? []) as V[];

  // Serie mensual de cada gasto: factura del mes, o lo facturado en ARCA por ese CUIT
  const series = new Map<string, Map<string, number>>();
  for (const c of costs) {
    const s = new Map<string, number>();
    for (const b of bills) if (b.cost_id === c.id && b.amount != null) s.set(b.period, (s.get(b.period) ?? 0) + Number(b.amount));
    if (c.supplier_cuit) for (const v of vouchers) if (v.doc_number === c.supplier_cuit) {
      const p = v.issue_date.slice(0, 7);
      if (!bills.some((b) => b.cost_id === c.id && b.period === p && b.amount != null)) s.set(p, (s.get(p) ?? 0) + Number(v.total) * (v.credit_note ? -1 : 1));
    }
    series.set(c.id, s);
  }
  const lastTwo = (s: Map<string, number>, upTo: string) => {
    const ps = [...s.keys()].filter((p) => p <= upTo && (s.get(p) ?? 0) > 0).sort().reverse();
    return ps.length ? { cur: ps[0], curV: s.get(ps[0])!, prev: ps[1], prevV: ps[1] ? s.get(ps[1])! : null } : null;
  };

  // 67: aumentos mayores al umbral / a la inflación; 68: contra el mismo mes del año pasado
  const increases = costs.flatMap((c) => {
    const s = series.get(c.id)!, lt = lastTwo(s, m);
    if (!lt || !lt.prev || !lt.prevV || lt.cur < shift(m, -2)) return [];
    const ch = lt.curV / lt.prevV - 1;
    const infCh = Math.pow(1 + inf, Math.max(1, monthsBetween(lt.prev, lt.cur))) - 1;
    const yAgo = s.get(shift(lt.cur, -12));
    if (ch <= alertPct && ch <= infCh + 0.02) return [];
    return [{ c, ...lt, ch, infCh, yoy: yAgo ? lt.curV / yAgo - 1 : null }];
  }).sort((a, b) => b.ch - a.ch);

  // 76: ranking de los que más crecieron en el año (promedio últimos 3 meses vs. mismos meses hace un año)
  const avg = (s: Map<string, number>, ps: string[]) => { const v = ps.map((p) => s.get(p)).filter((x): x is number => !!x); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const last3 = [0, 1, 2].map((i) => shift(m, -i)), year3 = last3.map((p) => shift(p, -12));
  const ranking = costs.map((c) => { const s = series.get(c.id)!; const a = avg(s, last3), b = avg(s, year3); return a && b ? { c, now: a, before: b, g: a / b - 1 } : null; })
    .filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.g - a.g).slice(0, 10);
  const yearInf = Math.pow(1 + inf, 12) - 1;

  // 70: facturas que no llegaron este mes (gastos mensuales con historia y ya pasado su día habitual)
  const isCurrent = m === today.slice(0, 7);
  const missing = isCurrent ? costs.filter((c) => {
    if (c.frequency !== 1) return false;
    const s = series.get(c.id)!;
    if (s.has(m) || !(s.has(shift(m, -1)) || s.has(shift(m, -2)))) return false;
    const prevBill = bills.find((b) => b.cost_id === c.id && b.period === shift(m, -1) && b.due_date);
    const day = c.due_day ?? (prevBill?.due_date ? Number(prevBill.due_date.slice(8)) : 20);
    return Number(today.slice(8)) > Math.min(day, 28);
  }) : [];
  // 71: vencidas sin pagar
  const costName = new Map(costs.map((c) => [c.id, c.name]));
  const overdue = bills.filter((b) => b.cost_id && costName.has(b.cost_id) && !b.paid && b.due_date && b.due_date < today && b.period >= shift(m, -3))
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!));

  // Monto mensual vigente de cada gasto
  const monthly = (c: Cost) => { const lt = lastTwo(series.get(c.id)!, m); return c.frequency === 1 ? (lt?.curV ?? Number(c.amount)) : (lt?.curV ?? Number(c.amount)) / c.frequency; };
  const business = costs.filter((c) => !c.is_personal), personal = costs.filter((c) => c.is_personal);
  const bizTotal = business.reduce((a, c) => a + monthly(c), 0), persTotal = personal.reduce((a, c) => a + monthly(c), 0);
  const bdays = businessDaysInMonth(m);

  // 75: renovaciones (anuales / semestrales) en los próximos 45 días
  const renewals = costs.filter((c) => c.frequency >= 6).map((c) => {
    const ps = [...series.get(c.id)!.keys()].sort();
    const last = ps.at(-1);
    let next = last ? shift(last, c.frequency) : null;
    while (next && next < today.slice(0, 7)) next = shift(next, c.frequency);
    const date = next ? `${next}-${String(Math.min(c.due_day ?? 10, 28)).padStart(2, "0")}` : null;
    return { c, date, amount: (last ? series.get(c.id)!.get(last)! : Number(c.amount)) * Math.pow(1 + inf, last && next ? monthsBetween(last, next) : 0) };
  }).filter((r) => r.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const soon = renewals.filter((r) => (Date.parse(r.date!) - Date.parse(today)) / 864e5 <= 45);

  // 78: IVA recuperable (facturas A de proveedores de gastos fijos); 79: los que te facturan B (pedí A)
  const monthV = vouchers.filter((v) => v.issue_date.startsWith(m));
  const ivaA = monthV.filter((v) => LETTER_A.has(v.voucher_type)).reduce((a, v) => a + Number(v.vat) * (v.credit_note ? -1 : 1), 0);
  const recent = vouchers.filter((v) => v.issue_date >= `${shift(m, -3)}-01`);
  const askA = cuits.map((cuit) => {
    const vs = recent.filter((v) => v.doc_number === cuit);
    const b = vs.filter((v) => LETTER_B.has(v.voucher_type));
    if (!b.length || vs.some((v) => LETTER_A.has(v.voucher_type))) return null;
    const total = b.reduce((a, v) => a + Number(v.total), 0);
    return { cuit, name: costs.find((c) => c.supplier_cuit === cuit)?.name ?? b[0].name, total, lostVat: total - total / 1.21, n: b.length };
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.lostVat - a.lostVat);
  // Servicios sin CUIT de ARCA: no se puede confirmar el IVA computable
  const noCuit = business.filter((c) => !c.supplier_cuit && ["servicios", "telefonia", "software", "alquiler", "seguros", "honorarios"].includes(c.category));

  // 80: proyección 6 meses con inflación (los anuales caen en su mes)
  const proj = Array.from({ length: 6 }, (_, i) => {
    const p = shift(m, i + 1);
    const base = business.filter((c) => c.frequency === 1).reduce((a, c) => a + monthly(c), 0) * Math.pow(1 + inf, i + 1);
    const extra = renewals.filter((r) => !r.c.is_personal && r.date!.startsWith(p)).reduce((a, r) => a + r.amount, 0)
      + business.filter((c) => c.frequency > 1 && c.frequency < 6).reduce((a, c) => a + monthly(c), 0) * Math.pow(1 + inf, i + 1);
    return { p, total: base + extra, extra: renewals.filter((r) => !r.c.is_personal && r.date!.startsWith(p)).map((r) => r.c.name) };
  });
  const projMax = Math.max(1, ...proj.map((x) => x.total));

  return (
    <div className="mt-4 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Wallet} label="Fijos del negocio" value={formatMoney(bizTotal)} sub={`por día hábil ${formatMoney(bizTotal / bdays)} (${bdays} días)`} />
        <Stat icon={TrendingUp} label="Aumentos a revisar" value={String(increases.length)} sub={`más de ${(alertPct * 100).toFixed(0)}% o arriba de la inflación`} tone={increases.length ? "warn" : undefined} />
        <Stat icon={Receipt} label="IVA recuperable del mes" value={formatMoney(ivaA)} sub="facturas A de tus gastos fijos (ARCA)" tone="accent" />
        <Stat icon={Percent} label="Gastos personales" value={formatMoney(persTotal)} sub={`${personal.length} gastos marcados personales`} />
      </div>

      {(missing.length > 0 || overdue.length > 0 || soon.length > 0) && (
        <Card className="overflow-hidden">
          <CardHeader title="Para hacer" description="Facturas que no llegaron, vencidas sin pagar y renovaciones que se vienen" />
          <ul className="divide-y divide-border">
            {overdue.map((b, i) => (
              <li key={`o${i}`} className="flex items-start gap-3 px-5 py-2.5 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="flex-1"><p className="font-medium">{costName.get(b.cost_id!)} venció sin pagar</p><p className="text-xs text-fg-subtle">Venció el {formatDate(b.due_date)} · {formatMoney(b.amount)} · {monthLabel(b.period)}</p></div></li>
            ))}
            {missing.map((c) => (
              <li key={`m${c.id}`} className="flex items-start gap-3 px-5 py-2.5 text-sm"><FileWarning className="mt-0.5 size-4 shrink-0 text-warn" />
                <div className="flex-1"><p className="font-medium">No llegó la factura de {c.name}</p><p className="text-xs text-fg-subtle">Todos los meses llega antes de esta fecha. Revisá si cambió el mail o si hay que pedirla.</p></div></li>
            ))}
            {soon.map((r) => (
              <li key={`r${r.c.id}`} className="flex items-start gap-3 px-5 py-2.5 text-sm"><CalendarClock className="mt-0.5 size-4 shrink-0 text-info" />
                <div className="flex-1"><p className="font-medium">Se renueva {r.c.name}</p><p className="text-xs text-fg-subtle">Alrededor del {formatDate(r.date)} · estimado {formatMoney(r.amount)} con inflación. Buen momento para pedir otra cotización.</p></div></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Aumentos" description="Última factura contra la anterior, contra la inflación del período y contra el mismo mes del año pasado" />
          <ul className="divide-y divide-border">
            {increases.map((x) => (
              <li key={x.c.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{x.c.name}</p>
                  <p className="text-xs text-fg-subtle">{formatMoney(x.prevV)} ({x.prev}) → {formatMoney(x.curV)} ({x.cur}) · inflación {pct(x.infCh)}{x.yoy !== null ? ` · vs. hace un año ${pct(x.yoy)}` : ""}</p></div>
                <Badge tone={x.ch > x.infCh * 2 ? "danger" : "warn"}>{pct(x.ch)}</Badge>
              </li>
            ))}
            {!increases.length && <li className="px-5 py-4 text-sm text-fg-subtle">Ningún gasto subió más de lo esperado.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Los que más crecieron en el año" description={`Promedio de los últimos 3 meses contra los mismos meses del año pasado · inflación anual estimada ${pct(yearInf)}`} />
          <ul className="divide-y divide-border">
            {ranking.map((x, i) => (
              <li key={x.c.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                <span className="min-w-0 truncate"><span className="mr-2 text-fg-subtle tabular">{i + 1}.</span>{x.c.name}</span>
                <span className="shrink-0 text-right tabular"><span className={cn("font-semibold", x.g > yearInf ? "text-danger" : "text-accent")}>{pct(x.g)}</span>
                  <span className="ml-2 text-xs text-fg-subtle">{formatMoney(x.before)} → {formatMoney(x.now)}</span></span>
              </li>
            ))}
            {!ranking.length && <li className="px-5 py-4 text-sm text-fg-subtle">Hace falta un año de facturas para comparar.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="IVA de tus gastos fijos" description="Con factura A el IVA se descuenta del que pagás; con factura B se pierde" />
          <ul className="divide-y divide-border">
            {askA.map((x) => (
              <li key={x.cuit} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">Pedile factura A a {x.name}</p><p className="text-xs text-fg-subtle">Te facturó {x.n} vez/veces con B en los últimos 3 meses ({formatMoney(x.total)}). Pasale tu CUIT y condición Responsable Inscripto.</p></div>
                <span className="shrink-0 text-right text-xs text-warn tabular">IVA perdido<br /><span className="text-sm font-semibold">{formatMoney(x.lostVat)}</span></span>
              </li>
            ))}
            {noCuit.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{c.name}</p><p className="text-xs text-fg-subtle">Sin CUIT asociado: no se puede confirmar en ARCA si el IVA es computable.</p></div>
              </li>
            ))}
            {!askA.length && !noCuit.length && <li className="px-5 py-4 text-sm text-fg-subtle">Todos tus gastos fijos con CUIT te facturan A.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Próximos 6 meses" description={`Gastos fijos del negocio con ${(inf * 100).toFixed(1)}% de inflación mensual; los anuales caen en su mes`}
            action={canEdit ? <CostSettings inflation={String(inf * 100)} alertPct={String(alertPct * 100)} /> : undefined} />
          <ul className="space-y-2 px-5 py-4">
            {proj.map((x) => (
              <li key={x.p} className="text-sm">
                <div className="flex justify-between"><span className="capitalize">{monthLabel(x.p)}</span><span className="tabular font-medium">{formatMoney(x.total)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-field"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${(x.total / projMax) * 100}%` }} /></div>
                {x.extra.length > 0 && <p className="mt-0.5 text-[11px] text-fg-subtle">incluye {x.extra.join(", ")}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Negocio o personal" description="Los personales no restan en el resultado del negocio ni en la proyección" />
        <ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          {costs.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 border-border px-5 py-2 text-sm sm:border-b">
              <span className="min-w-0 truncate">{c.name}</span>
              <span className="flex shrink-0 items-center gap-2"><span className="tabular text-fg-muted">{formatMoney(monthly(c))}</span>
                {canEdit ? <PersonalToggle id={c.id} personal={c.is_personal} /> : <Badge>{c.is_personal ? "Personal" : "Negocio"}</Badge>}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
