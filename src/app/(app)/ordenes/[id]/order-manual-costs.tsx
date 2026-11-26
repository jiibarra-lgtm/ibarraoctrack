import Link from "next/link";
import { Plus } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { UnlinkButton } from "@/app/(app)/costos-manuales/ui";

type Item = { id: string; line_number: number; option_number: number; quantity: string | number; total_amount: string | number; description_original: string };

/** Costos manuales vinculados a mano a esta OC. Solo referencia: no entra en la ganancia automática de la orden. */
export async function OrderManualCosts({ sb, orgId, poId, items, canEdit }: { sb: SupabaseClient; orgId: string; poId: string; items: Item[]; canEdit: boolean }) {
  const { data, error } = await sb.from("manual_cost_links")
    .select("id, quantity, purchase_order_item_id, manual_costs(description, supplier, sku, cost_net, cost_gross)")
    .eq("org_id", orgId).eq("purchase_order_id", poId).order("created_at");
  if (error) return null; // la sección todavía no existe en la base
  const rows = (data ?? []) as unknown as { id: string; quantity: string | null; purchase_order_item_id: string | null; manual_costs: { description: string; supplier: string | null; sku: string | null; cost_net: string | null; cost_gross: string | null } | null }[];
  if (!rows.length && !canEdit) return null;
  const itemById = new Map(items.map((i) => [i.id, i]));

  const calc = rows.map((r) => {
    const it = r.purchase_order_item_id ? itemById.get(r.purchase_order_item_id) : undefined;
    const qty = r.quantity !== null ? Number(r.quantity) : it ? Number(it.quantity) : 0;
    const net = r.manual_costs?.cost_net !== null && r.manual_costs?.cost_net !== undefined ? Number(r.manual_costs.cost_net) * qty : null;
    return { r, it, qty, net };
  });
  const costTotal = calc.reduce((a, x) => a + (x.net ?? 0), 0);
  // venta neta de los renglones que tienen costo vinculado (para el margen de referencia)
  const linkedItems = [...new Set(calc.filter((x) => x.it).map((x) => x.it!.id))].map((id) => itemById.get(id)!);
  const salesNet = linkedItems.reduce((a, i) => a + Number(i.total_amount) / 1.21, 0);
  const itemsCost = calc.filter((x) => x.it).reduce((a, x) => a + (x.net ?? 0), 0);

  return (
    <Card className="mt-5">
      <CardHeader title="Costos manuales" description="Vinculados a mano desde tu lista de costos. Solo referencia: no cambian la ganancia de la orden."
        action={canEdit ? <Button asChild size="sm" variant="secondary"><Link href={`/costos-manuales?oc=${poId}`}><Plus /> Vincular costo</Link></Button> : null} />
      {rows.length === 0 ? (
        <CardBody className="text-sm text-fg-muted">Todavía no vinculaste costos manuales a esta orden.</CardBody>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-fg-subtle">
                <tr className="border-y border-border"><th className="px-5 py-2">Costo</th><th className="px-3 py-2">Renglón</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Neto unit.</th><th className="px-3 py-2 text-right">Total neto</th><th className="w-1 px-3" /></tr>
              </thead>
              <tbody>
                {calc.map(({ r, it, qty, net }) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2">{r.manual_costs?.description ?? "—"}<span className="block text-xs text-fg-subtle">{[r.manual_costs?.sku, r.manual_costs?.supplier].filter(Boolean).join(" · ")}</span></td>
                    <td className="px-3 py-2 text-xs">{it ? `R${it.line_number}${it.option_number > 1 ? `.${it.option_number}` : ""} · ${it.description_original.slice(0, 50)}` : "Toda la orden"}</td>
                    <td className="px-3 py-2 text-right tabular">{qty.toLocaleString("es-AR")}</td>
                    <td className="px-3 py-2 text-right tabular">{r.manual_costs?.cost_net ? formatMoney(r.manual_costs.cost_net) : "sin costo"}</td>
                    <td className="px-3 py-2 text-right tabular">{net !== null ? formatMoney(net) : "—"}</td>
                    <td className="px-3 py-2">{canEdit && <UnlinkButton id={r.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border text-sm">
            <span>Costo manual total: <b className="tabular">{formatMoney(costTotal)}</b> <span className="text-xs text-fg-subtle">sin IVA</span></span>
            {linkedItems.length > 0 && salesNet > 0 && (
              <span>Margen de referencia en esos renglones: <b className="tabular">{formatMoney(salesNet - itemsCost)}</b> ({(((salesNet - itemsCost) / salesNet) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} % sobre la venta sin IVA)</span>
            )}
          </CardBody>
        </>
      )}
    </Card>
  );
}
