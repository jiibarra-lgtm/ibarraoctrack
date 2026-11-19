import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download, Package, Percent, Receipt, RotateCcw, ShoppingBag, Truck } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { duplicates, matchInvoices, rubroLabel, sellers, summarize } from "@/lib/ml-purchases";
import { currentArYm, lastMonths, loadMlPurchases } from "@/lib/ml-purchases-load";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Compras en Mercado Libre" };

const VIEWS = [["resumen", "Resumen"], ["envios", "Envíos"], ["devoluciones", "Devoluciones"], ["vendedores", "Vendedores"], ["duplicados", "Duplicadas"]] as const;
const STAGE: Record<string, [string, string]> = {
  puede_devolver: ["Podés iniciar la devolución", "text-warn"],
  despachar: ["Tenés que despacharla", "text-danger"],
  protegida: ["Compra protegida", "text-warn"],
  abierta: ["Abierta", "text-fg-muted"],
  reembolsada: ["Te devolvieron la plata", "text-accent"],
};
const dm = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "—");

export default async function MlComprasPage({ searchParams }: { searchParams: Promise<{ mes?: string; v?: string }> }) {
  const sp = await searchParams;
  const cur = currentArYm();
  const ym = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : cur;
  const v = VIEWS.some(([k]) => k === sp.v) ? sp.v! : "resumen";
  const s = await requireOrg();
  const { orders, invoices, returns } = await loadMlPurchases(s.supabase, s.org.org_id, ym);
  const sum = summarize(orders, invoices);
  const invBy = matchInvoices(orders, invoices);
  const dups = duplicates(orders);
  const sell = sellers(orders, returns, invBy);
  const onTheWay = orders.filter((o) => o.status === "en_camino" || o.status === "comprada");
  const openReturns = returns.filter((r) => r.stage !== "reembolsada");
  const href = (p: Record<string, string>) => `/mercadolibre/compras?${new URLSearchParams({ mes: ym, v, ...p })}`;
  const isCur = ym === cur;

  return (
    <>
      <PageHeader title="Compras en Mercado Libre" description="Cuánto gastás, cuánto IVA recuperás, qué está por llegar y qué devoluciones tenés abiertas, mes por mes."
        actions={<Button asChild variant="secondary"><a href={`/api/ml/compras/export?mes=${ym}`}><Download className="size-4" /> Planilla para el contador</a></Button>} />

      <div className="flex flex-wrap items-center gap-1.5">
        <Link href="/mercadolibre?t=compra" className="mr-2 text-xs font-medium text-fg-muted hover:text-fg">← Todas las operaciones</Link>
        {lastMonths(6).reverse().map((m) => (
          <Link key={m} href={href({ mes: m })} className={cn("rounded-full px-3 py-1 text-xs font-semibold capitalize", m === ym ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>
            {monthLabel(m)}{m === cur ? " (este mes)" : ""}
          </Link>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ShoppingBag} label={`Gastado en ${monthLabel(ym)}`} value={formatMoney(sum.total)} sub={`${sum.n} compras${sum.shipping ? ` · ${formatMoney(sum.shipping)} de envíos` : ""}`} />
        <Stat icon={Percent} label="IVA que podés tomar" value={formatMoney(sum.vat)} sub={`${sum.withA} con factura A${sum.perc ? ` · ${formatMoney(sum.perc)} de percepciones` : ""}`} tone="accent" />
        <Stat icon={Receipt} label="IVA que se pierde" value={formatMoney(sum.lostVat)} sub={`${sum.n - sum.withA} sin factura A${sum.noInvoice ? ` · ${sum.noInvoice} sin factura` : ""}`} tone={sum.lostVat ? "warn" : undefined} />
        <Stat icon={RotateCcw} label="Devoluciones abiertas" value={String(openReturns.length)} sub={isCur ? `${onTheWay.length} compras por llegar` : undefined} tone={openReturns.length ? "warn" : undefined} href={href({ v: "devoluciones" })} />
      </div>

      <div className="mt-5 flex rounded-full bg-field p-0.5 w-fit max-w-full overflow-x-auto">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={href({ v: k })} className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold", v === k ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>
            {l}{k === "duplicados" && dups.length ? ` · ${dups.length}` : k === "devoluciones" && openReturns.length ? ` · ${openReturns.length}` : k === "envios" && onTheWay.length ? ` · ${onTheWay.length}` : ""}
          </Link>
        ))}
      </div>

      {v === "resumen" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Por rubro</h2>
            {!sum.byRubro.length ? <p className="mt-3 text-sm text-fg-muted">No compraste nada en ML este mes.</p> : (
              <ul className="mt-3 space-y-2.5">
                {sum.byRubro.map(([k, x]) => (
                  <li key={k}>
                    <div className="flex justify-between text-sm"><span>{rubroLabel(k)} <span className="text-fg-subtle">· {x.n}</span></span><span className="tabular font-medium">{formatMoney(x.total)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-field"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(2, (x.total / (sum.byRubro[0][1].total || 1)) * 100)}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-fg-subtle">Los envíos se separan cuando la factura cobra más que el producto.</p>
          </Card>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left font-medium">Compra</th><th className="px-2 text-left font-medium">Factura</th><th className="px-2 text-right font-medium">Total</th><th className="px-2 text-right font-medium">IVA crédito</th><th className="px-4 text-right font-medium">Percep.</th>
              </tr></thead>
              <tbody className="tabular">
                {sum.rows.map((r) => (
                  <tr key={r.o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><span className="line-clamp-1">{r.o.title}</span><span className="text-[11px] text-fg-subtle">{dm(r.o.ordered_at)} · {r.o.counterpart ?? "—"} · {rubroLabel(r.rubro)}</span></td>
                    <td className="px-2">{r.letter ? <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", r.letter === "A" ? "bg-accent-soft text-accent" : "bg-field text-fg-muted")}>{r.letter}</span> : <span className="text-[11px] text-warn">Sin factura</span>}</td>
                    <td className="px-2 text-right">{formatMoney(r.total)}</td>
                    <td className="px-2 text-right">{r.vat ? formatMoney(r.vat) : <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-4 text-right">{r.perc ? formatMoney(r.perc) : <span className="text-fg-subtle">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sum.rows.length && <EmptyState icon={<Package />} title="Sin compras este mes" />}
          </Card>
        </div>
      )}

      {v === "envios" && (
        <Card className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-4 py-2.5 text-left font-medium">Compra</th><th className="px-2 text-left font-medium">Estado</th><th className="px-2 text-right font-medium">Comprada</th><th className="px-2 text-right font-medium">Llega / llegó</th><th className="px-4 text-right font-medium">Días</th></tr></thead>
            <tbody className="tabular">
              {[...orders].sort((a, b) => Number(b.status === "en_camino" || b.status === "comprada") - Number(a.status === "en_camino" || a.status === "comprada")).map((o) => {
                const pending = o.status === "en_camino" || o.status === "comprada";
                const late = pending && !!o.eta && /^\d{4}-\d{2}-\d{2}/.test(o.eta) && o.eta.slice(0, 10) < new Date().toISOString().slice(0, 10);
                const d = o.delivered_at && o.ordered_at ? Math.round((Date.parse(o.delivered_at) - Date.parse(o.ordered_at)) / 864e5) : null;
                return (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><span className="line-clamp-1">{o.title}</span><span className="text-[11px] text-fg-subtle">{o.counterpart ?? "—"}</span></td>
                    <td className={cn("px-2 text-xs font-medium", late ? "text-danger" : pending ? "text-warn" : "text-accent")}>{late ? "Atrasada" : pending ? "En camino" : o.status === "entregada" ? "Llegó" : o.status}</td>
                    <td className="px-2 text-right">{dm(o.ordered_at)}</td>
                    <td className="px-2 text-right">{o.delivered_at ? dm(o.delivered_at) : o.eta ? (/^\d{4}-\d{2}-\d{2}/.test(o.eta) ? dm(o.eta) : o.eta) : "—"}</td>
                    <td className="px-4 text-right">{d ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!orders.length && <EmptyState icon={<Truck />} title="Sin compras este mes" />}
        </Card>
      )}

      {v === "devoluciones" && (
        <Card className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-4 py-2.5 text-left font-medium">Producto</th><th className="px-2 text-left font-medium">Estado</th><th className="px-2 text-right font-medium">Fecha límite</th><th className="px-4 text-right font-medium">En el banco</th></tr></thead>
            <tbody className="tabular">
              {returns.map((r) => {
                const [label, tone] = STAGE[r.stage] ?? [r.stage, ""];
                const limit = r.ship_deadline ?? r.start_deadline ?? r.protected_until;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><span className="line-clamp-1">{r.title}</span></td>
                    <td className={cn("px-2 text-xs font-medium", tone)}>{label}</td>
                    <td className="px-2 text-right">{r.stage === "reembolsada" ? dm(r.refunded_at) : dm(limit)}</td>
                    <td className="px-4 text-right text-xs">{r.stage !== "reembolsada" ? "—" : r.bank_movement_id ? <span className="text-accent">Acreditado</span> : <span className="text-fg-subtle">No lo veo (va a la cuenta de Mercado Pago)</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!returns.length && <EmptyState icon={<RotateCcw />} title="Sin devoluciones" description="Cuando ML te mande un mail de devolución, aparece acá y te aviso un día antes de cada fecha límite." />}
        </Card>
      )}

      {v === "vendedores" && (
        <Card className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-4 py-2.5 text-left font-medium">Vendedor</th><th className="px-2 text-right font-medium">Compras</th><th className="px-2 text-right font-medium">Gastado</th><th className="px-2 text-right font-medium">Demora</th><th className="px-2 text-right font-medium">Factura</th><th className="px-2 text-right font-medium">Devol.</th><th className="px-4 text-right font-medium">Puntaje</th></tr></thead>
            <tbody className="tabular">
              {sell.map((x) => (
                <tr key={x.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{x.name}</td>
                  <td className="px-2 text-right">{x.n}</td>
                  <td className="px-2 text-right">{formatMoney(x.total)}</td>
                  <td className="px-2 text-right">{x.avgDelay != null ? `${x.avgDelay} d` : "—"}</td>
                  <td className="px-2 text-right">{Math.round(x.invRate * 100)}%{x.invA ? <span className="text-[11px] text-fg-subtle"> · {x.invA} A</span> : null}</td>
                  <td className="px-2 text-right">{x.returns || "—"}</td>
                  <td className={cn("px-4 text-right font-semibold", x.score >= 80 ? "text-accent" : x.score >= 55 ? "text-warn" : "text-danger")}>{x.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-4 py-2.5 text-xs text-fg-subtle">El puntaje baja si tarda más de 2 días en entregar, si hubo devoluciones y si no manda factura.</p>
        </Card>
      )}

      {v === "duplicados" && (
        <Card className="mt-4">
          {!dups.length ? <EmptyState icon={<AlertTriangle />} title="Sin compras repetidas" description="Te marco si comprás lo mismo, al mismo vendedor, el mismo día." /> : (
            <ul className="divide-y divide-border">
              {dups.map((g) => (
                <li key={g[0].id} className="px-4 py-3">
                  <p className="text-sm font-medium">{g[0].title}</p>
                  <p className="text-xs text-fg-muted">{g.length} veces el {dm(g[0].ordered_at)} a {g[0].counterpart ?? "—"} · {g.map((o) => formatMoney(Number(o.total_amount ?? 0))).join(" + ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
