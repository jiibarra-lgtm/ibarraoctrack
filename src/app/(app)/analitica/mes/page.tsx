import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatMoney, formatQty, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { monthLabel, shiftMonth } from "../../dashboard/month-stages";
import { CostCell } from "./cost-cell";
import { SupplierCostPicker } from "@/components/supplier-cost-picker";
import { sourceLabels } from "@/lib/cost-sources";

export const metadata: Metadata = { title: "Ganancia del mes" };

type ItemRow = {
  purchase_order_item_id: string; purchase_order_id: string; line_number: number; description_original: string;
  quantity: string; unit_price: string; sales_gross: string; estimated_unit_cost: string | null; estimated_cost: string | null; substituted: boolean;
};

export default async function MonthProfitPage({ searchParams }: { searchParams: Promise<{ mes?: string; ver?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const current = todayISO().slice(0, 7);
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") && sp.mes! <= current ? sp.mes! : current;
  const onlyMissing = sp.ver === "sin-costo";
  const to = shiftMonth(ym, 1);

  const [{ data: pos }, { data: fs }] = await Promise.all([
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, issue_date, total_amount")
      .eq("org_id", org).eq("currency", "ARS").not("status", "in", "(anulada,borrador)")
      .gte("issue_date", `${ym}-01`).lt("issue_date", `${to}-01`).order("issue_date"),
    s.supabase.from("financial_settings").select("sales_include_vat, default_vat_rate").eq("org_id", org).maybeSingle(),
  ]);
  const ids = (pos ?? []).map((p) => p.id as string);
  const [{ data: items }, { data: links }] = ids.length
    ? await Promise.all([
      s.supabase.from("po_item_profitability").select("purchase_order_item_id, purchase_order_id, line_number, description_original, quantity, unit_price, sales_gross, estimated_unit_cost, estimated_cost, substituted").in("purchase_order_id", ids),
      s.supabase.from("purchase_order_items").select("id, convenio_line_id, bac_code, cost_source_item_id, cost_source_divisor").in("purchase_order_id", ids),
    ])
    : [{ data: [] }, { data: [] }];
  const div = (fs?.sales_include_vat ?? true) ? 1 + Number(fs?.default_vat_rate ?? 21) / 100 : 1;
  const link = new Map((links ?? []).map((l) => [l.id as string, l]));
  const sources = await sourceLabels(s.supabase, (links ?? []) as { cost_source_item_id: string | null; cost_source_divisor: string | null }[]);
  const po = new Map((pos ?? []).map((p) => [p.id as string, p]));

  const rows = ((items ?? []) as ItemRow[]).map((it) => {
    const net = Number(it.sales_gross) / div;
    const cost = it.estimated_cost === null ? null : Number(it.estimated_cost);
    return { ...it, net, cost, profit: cost === null ? null : net - cost, po: po.get(it.purchase_order_id), link: link.get(it.purchase_order_item_id) };
  }).sort((a, b) => (a.po?.issue_date ?? "").localeCompare(b.po?.issue_date ?? "") || String(a.po?.bac_number).localeCompare(String(b.po?.bac_number)) || a.line_number - b.line_number);
  const shown = onlyMissing ? rows.filter((r) => r.cost === null) : rows;

  const withCost = rows.filter((r) => r.cost !== null);
  const salesNet = rows.reduce((a, r) => a + r.net, 0);
  const salesWith = withCost.reduce((a, r) => a + r.net, 0);
  const costSum = withCost.reduce((a, r) => a + (r.cost ?? 0), 0);
  const profit = salesWith - costSum;
  const missing = rows.length - withCost.length;
  const writable = canWrite(s.org.role);
  const q = (p: Record<string, string>) => `/analitica/mes?${new URLSearchParams({ mes: ym, ...(onlyMissing ? { ver: "sin-costo" } : {}), ...p })}`;

  return (
    <>
      <PageHeader
        title="Ganancia del mes"
        description="Lo adjudicado en el mes (por fecha de autorización), sin IVA, contra tu costo. Cargá el costo unitario sin IVA y se recalcula."
        actions={
          <div className="flex items-center gap-1">
            <Link href={q({ mes: shiftMonth(ym, -1) })} className="grid size-8 place-items-center rounded-full hover:bg-surface-2" aria-label="Mes anterior"><ChevronLeft className="size-4" /></Link>
            <span className="min-w-32 text-center text-sm font-semibold capitalize">{monthLabel(ym)}</span>
            {ym < current ? <Link href={q({ mes: shiftMonth(ym, 1) })} className="grid size-8 place-items-center rounded-full hover:bg-surface-2" aria-label="Mes siguiente"><ChevronRight className="size-4" /></Link> : <span className="size-8" />}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendido sin IVA" value={formatMoney(salesNet)} sub={`${ids.length} OC · ${rows.length} renglones`} />
        <Stat label="Costo cargado" value={formatMoney(costSum)} sub={`${withCost.length} de ${rows.length} renglones`} />
        <Stat label="Ganancia estimada" value={withCost.length ? formatMoney(profit) : "—"} sub={salesWith > 0 ? `margen ${((profit / salesWith) * 100).toFixed(1)}%` : "cargá costos"} tone={profit < 0 ? "danger" : undefined} />
        <Stat label="Sin costo" value={String(missing)} sub={missing ? `${formatMoney(salesNet - salesWith)} vendidos sin costo` : "todo cargado"} tone={missing ? "warn" : undefined} />
      </div>

      <div className="mb-3 flex gap-2 text-xs font-medium">
        <Link href={`/analitica/mes?mes=${ym}`} className={cn("rounded-full border border-card-border px-3 py-1", !onlyMissing && "bg-brand text-white")}>Todos ({rows.length})</Link>
        <Link href={`/analitica/mes?mes=${ym}&ver=sin-costo`} className={cn("rounded-full border border-card-border px-3 py-1", onlyMissing && "bg-brand text-white")}>Sin costo ({missing})</Link>
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? <EmptyState title={onlyMissing ? "Todos los renglones tienen costo" : "Sin órdenes este mes"} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-4 py-2.5">OC / renglón</th><th className="px-2 py-2.5">Producto</th>
                  <th className="px-2 py-2.5 text-right">Cant.</th><th className="px-2 py-2.5 text-right">Venta s/IVA</th>
                  <th className="px-2 py-2.5 text-right">Tu costo unit. s/IVA</th><th className="px-2 py-2.5 text-right">Ganancia</th><th className="px-4 py-2.5 text-right">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => {
                  const m = r.profit !== null && r.net > 0 ? (r.profit / r.net) * 100 : null;
                  return (
                    <tr key={r.purchase_order_item_id} className={cn(r.cost === null && "bg-warn-soft/30")}>
                      <td className="px-4 py-2 align-top">
                        <Link href={`/ordenes/${r.purchase_order_id}?tab=compras`} className="font-mono text-xs font-medium hover:text-primary">{r.po?.bac_number ?? r.po?.display_number}</Link>
                        <p className="text-[11px] text-fg-subtle">Renglón {r.line_number}{r.link?.convenio_line_id ? " · convenio" : ""}</p>
                      </td>
                      <td className="max-w-72 px-2 py-2 align-top"><p className="line-clamp-2 text-xs">{r.description_original}</p><p className="truncate text-[11px] text-fg-subtle">{r.po?.customer_name}</p></td>
                      <td className="px-2 py-2 text-right align-top tabular">{formatQty(r.quantity)}</td>
                      <td className="px-2 py-2 text-right align-top tabular">{formatMoney(r.net)}<p className="text-[11px] text-fg-subtle">{formatMoney(Number(r.unit_price) / div)} c/u</p></td>
                      <td className="px-2 py-2 text-right align-top">
                        {r.substituted ? <span className="text-xs text-fg-subtle">reemplazo cargado</span>
                          : <div className="flex items-center justify-end gap-1">
                              <SupplierCostPicker itemId={r.purchase_order_item_id} convenioLineId={(r.link?.convenio_line_id as string | null) ?? null} description={r.description_original}
                                linkedLabel={sources.get(String(r.link?.cost_source_item_id)) ?? null} disabled={!writable} />
                              <CostCell itemId={r.purchase_order_item_id} lineId={(r.link?.convenio_line_id as string | null) ?? null} value={r.estimated_unit_cost} disabled={!writable} />
                            </div>}
                        {r.link?.cost_source_item_id && sources.get(String(r.link.cost_source_item_id)) && <p className="mt-0.5 max-w-44 truncate text-right text-[10px] text-accent">{sources.get(String(r.link.cost_source_item_id))}</p>}
                      </td>
                      <td className={cn("px-2 py-2 text-right align-top font-medium tabular", r.profit !== null && r.profit < 0 && "text-danger")}>{r.profit === null ? "—" : formatMoney(r.profit)}</td>
                      <td className={cn("px-4 py-2 text-right align-top tabular", m !== null && m < 10 && "text-warn")}>{m === null ? "—" : `${m.toFixed(1)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-fg-subtle">
        Los renglones de convenio guardan el costo también en Productos: la próxima OC del mismo renglón ya lo trae. Si compraste mercadería y la vinculaste a la OC, se usa el costo real de la compra.
      </p>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "danger" }) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular sm:text-xl", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{value}</p>
      {sub && <p className="truncate text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}
