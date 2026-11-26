import type { Metadata } from "next";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { isUuid } from "@/lib/utils";
import { Badge, Card, CardBody, EmptyState, Input, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeleteCostButton, EditCostButton, LinkDialog, ManualCostDialog, UnlinkButton, type ManualCost } from "./ui";

export const metadata: Metadata = { title: "Costos manuales" };
export const dynamic = "force-dynamic";

type LinkRow = { id: string; manual_cost_id: string; purchase_order_id: string; purchase_order_item_id: string | null; quantity: string | null };

export default async function ManualCostsPage({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; f?: string; oc?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const sb = s.supabase;
  const edit = canWrite(s.org.role);
  const q = (sp.q ?? "").trim().toLowerCase(), prov = sp.p ?? "", f = sp.f ?? "";

  const [costsQ, linksQ, ocQ] = await Promise.all([
    sb.from("manual_costs").select("id, sku, description, supplier, cost, includes_vat, vat_pct, cost_net, cost_gross, notes").eq("org_id", s.org.org_id).eq("active", true).order("supplier").order("description"),
    sb.from("manual_cost_links").select("id, manual_cost_id, purchase_order_id, purchase_order_item_id, quantity").eq("org_id", s.org.org_id),
    sp.oc && isUuid(sp.oc) ? sb.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name").eq("id", sp.oc).eq("org_id", s.org.org_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (costsQ.error?.code === "42P01" || costsQ.error?.message?.includes("manual_costs")) {
    return (<><PageHeader title="Costos manuales" /><Card><CardBody className="text-sm text-fg-muted">Falta crear la base de datos de esta sección (la actualización de Supabase pendiente).</CardBody></Card></>);
  }
  const costs = (costsQ.data ?? []) as ManualCost[];
  const links = (linksQ.data ?? []) as LinkRow[];
  const oc = ocQ.data ? { id: ocQ.data.id as string, label: String(ocQ.data.bac_number ?? ocQ.data.display_number), customer: ocQ.data.customer_name as string | null } : null;

  // etiquetas de las OC vinculadas
  const poIds = [...new Set(links.map((l) => l.purchase_order_id))];
  const { data: pos } = poIds.length ? await sb.from("purchase_orders_overview").select("id, bac_number, display_number").in("id", poIds) : { data: [] };
  const poLabel = new Map((pos ?? []).map((p) => [p.id, String(p.bac_number ?? p.display_number)]));
  const byCost = new Map<string, LinkRow[]>();
  for (const l of links) byCost.set(l.manual_cost_id, [...(byCost.get(l.manual_cost_id) ?? []), l]);

  const suppliers = [...new Set(costs.map((c) => c.supplier).filter(Boolean))] as string[];
  const list = costs.filter((c) =>
    (!q || c.description.toLowerCase().includes(q) || (c.sku ?? "").includes(q)) &&
    (!prov || c.supplier === prov) &&
    (f !== "sin_costo" || c.cost === null) &&
    (f !== "vinculados" || byCost.has(c.id)));
  const href = (p: Record<string, string>) => `/costos-manuales?${new URLSearchParams({ ...(q ? { q } : {}), ...(prov ? { p: prov } : {}), ...(f ? { f } : {}), ...(oc ? { oc: oc.id } : {}), ...p })}`;

  return (
    <>
      <PageHeader title="Costos manuales" description="Tu lista de costos por producto, aparte de facturas, compras y banco. Se vinculan a una orden de compra solo cuando vos lo hacés."
        actions={edit ? <ManualCostDialog suppliers={suppliers} /> : null} />

      {oc && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 text-sm">
          <span><Link2 className="mr-1 inline size-4" /> Vinculando costos a la OC <b>{oc.label}</b>{oc.customer ? ` · ${oc.customer}` : ""}. Tocá <b>Vincular</b> en el costo que corresponda.</span>
          <span className="flex gap-3"><Link href={`/ordenes/${oc.id}`} className="underline">Volver a la OC</Link><Link href="/costos-manuales" className="underline">Terminar</Link></span>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card><CardBody><p className="text-2xl font-semibold tabular">{costs.length}</p><p className="text-sm text-fg-muted">productos con costo cargado</p></CardBody></Card>
        <Card><CardBody><p className="text-2xl font-semibold tabular">{suppliers.length}</p><p className="text-sm text-fg-muted">proveedores</p></CardBody></Card>
        <Link href={href({ f: f === "sin_costo" ? "" : "sin_costo" })}><Card className={cn(f === "sin_costo" && "border-brand")}><CardBody><p className={cn("text-2xl font-semibold tabular", costs.some((c) => c.cost === null) && "text-warn")}>{costs.filter((c) => c.cost === null).length}</p><p className="text-sm text-fg-muted">sin costo todavía</p></CardBody></Card></Link>
        <Link href={href({ f: f === "vinculados" ? "" : "vinculados" })}><Card className={cn(f === "vinculados" && "border-brand")}><CardBody><p className="text-2xl font-semibold tabular">{links.length}</p><p className="text-sm text-fg-muted">vínculos con órdenes</p></CardBody></Card></Link>
      </div>

      <Card>
        <form action="/costos-manuales" className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {oc && <input type="hidden" name="oc" value={oc.id} />}
          {f && <input type="hidden" name="f" value={f} />}
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por descripción o SKU…" className="h-9 max-w-xs" />
          <select name="p" defaultValue={prov} className="h-9 rounded-lg border border-card-border bg-field px-2 text-sm">
            <option value="">Todos los proveedores</option>{suppliers.map((x) => <option key={x}>{x}</option>)}
          </select>
          <Button size="sm" variant="secondary" type="submit">Ver</Button>
          {(q || prov || f) && <Link href={oc ? `/costos-manuales?oc=${oc.id}` : "/costos-manuales"} className="text-xs underline">Limpiar</Link>}
        </form>
        {list.length === 0 ? (
          <EmptyState title={costs.length ? "No hay costos con ese filtro" : "Todavía no cargaste costos"} description={costs.length ? undefined : "Agregá tu primer costo con el botón de arriba."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="text-left text-xs text-fg-subtle">
                <tr className="border-b border-border">
                  <th className="px-4 py-2">SKU</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2 text-right">Costo cargado</th><th className="px-3 py-2 text-right">Neto</th><th className="px-3 py-2 text-right">Con IVA</th>
                  <th className="px-3 py-2">Órdenes vinculadas</th><th className="w-1 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const ls = byCost.get(c.id) ?? [];
                  return (
                    <tr key={c.id} className="border-b border-border align-top last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-subtle">{c.sku ?? "—"}</td>
                      <td className="px-3 py-2.5">{c.description}{c.notes && <span className="block text-xs text-fg-subtle">{c.notes}</span>}</td>
                      <td className="px-3 py-2.5 text-xs">{c.supplier ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular">{c.cost === null ? <Badge tone="warn">sin costo</Badge> : <>{formatMoney(c.cost)} <span className="text-xs text-fg-subtle">{c.includes_vat ? "c/IVA" : "+IVA"}</span></>}</td>
                      <td className="px-3 py-2.5 text-right tabular">{c.cost_net === null ? "" : formatMoney(c.cost_net)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{c.cost_gross === null ? "" : formatMoney(c.cost_gross)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {ls.map((l) => (
                            <span key={l.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-field px-2 py-0.5 text-xs">
                              <Link href={`/ordenes/${l.purchase_order_id}`} className="hover:underline">{poLabel.get(l.purchase_order_id) ?? "OC"}</Link>
                              {l.quantity && <span className="text-fg-subtle">× {Number(l.quantity).toLocaleString("es-AR")}</span>}
                              {edit && <UnlinkButton id={l.id} />}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {edit && (
                          <span className="inline-flex items-center gap-1">
                            <LinkDialog cost={c} defaultOrder={oc ?? undefined} />
                            <EditCostButton row={c} suppliers={suppliers} />
                            <DeleteCostButton id={c.id} links={ls.length} />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <CardBody className="border-t border-border text-xs text-fg-subtle">
          Neto = sin IVA (si cargaste el costo con IVA se le saca el {`21 %`} o el IVA que pongas). Estos costos no cambian la ganancia automática de las órdenes: en cada OC los ves aparte, solo como referencia.
        </CardBody>
      </Card>
    </>
  );
}
