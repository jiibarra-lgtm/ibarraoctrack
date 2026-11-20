import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { PAYMENT_KINDS, type EInvoiceSettings, type SaleCondition } from "@/lib/einvoice";
import { cn } from "@/lib/utils";
import { ConditionButtons, ConditionEditor, CustomerConditionSelect, EInvoiceSettingsForm } from "./conditions-ui";

export const metadata: Metadata = { title: "Condiciones de venta" };

export default async function SaleConditionsPage() {
  const s = await requireOrg();
  const org = s.org.org_id;
  const edit = canBill(s.org.role);
  const [{ data: conds }, { data: customers }, { data: used }, { data: cfg }, { data: arca }] = await Promise.all([
    s.supabase.from("sale_conditions").select("id, code, name, arca_kind, days, is_default, active, notes").eq("org_id", org).order("active", { ascending: false }).order("code"),
    s.supabase.from("customers").select("id, name, sale_condition_id").eq("org_id", org).order("name").limit(500),
    s.supabase.from("arca_emissions").select("sale_condition_id").eq("org_id", org).not("sale_condition_id", "is", null).limit(5000),
    s.supabase.from("einvoice_settings").select("fixed_receiver, receiver_cuit, receiver_name, receiver_address, iva_condition, sale_condition_id, concept, require_remito, remito_pv").eq("org_id", org).maybeSingle(),
    s.supabase.rpc("arca_conn", { p_action: "status", p_org: org, p_data: {} }).then((r) => r, () => ({ data: null })),
  ]);
  const pv = (arca as { point_of_sale?: number } | null)?.point_of_sale ?? null;
  const list = (conds ?? []) as SaleCondition[];
  const uses = new Map<string, number>();
  for (const u of (used ?? []) as { sale_condition_id: string }[]) uses.set(u.sale_condition_id, (uses.get(u.sale_condition_id) ?? 0) + 1);
  const nextCode = Math.max(0, ...list.map((c) => c.code)) + 1;
  const active = list.filter((c) => c.active);

  return (
    <>
      <PageHeader breadcrumb={<Link href="/facturacion" className="hover:text-fg">Facturación</Link>} title="Condiciones de venta"
        description="Como en Tango: cada condición tiene su tipo de ARCA (lo que sale impreso en la factura) y sus plazos (de ahí sale el vencimiento de cobro). Al facturar se propone la habitual del cliente o la predeterminada."
        actions={edit && <ConditionEditor nextCode={nextCode} />} />

      <Card className="mb-5">
        <CardHeader title="Cómo se completa siempre la factura" description={`Los casilleros de ARCA, fijos. Punto de venta del sistema: ${pv ? String(pv).padStart(5, "0") : "sin configurar"} (web service). El 00002 es de "Factura en línea" y sólo sirve en la página de ARCA; se cambia en Configuración → ARCA.`} />
        <EInvoiceSettingsForm initial={(cfg as EInvoiceSettings | null) ?? null} options={active.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }))} canEdit={edit} />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
              <th className="px-5 py-2.5 text-left font-medium">Cód.</th><th className="px-2 text-left font-medium">Nombre</th><th className="px-2 text-left font-medium">Tipo ARCA</th>
              <th className="px-2 text-left font-medium">Vencimiento</th><th className="px-2 text-right font-medium">Facturas</th><th className="px-5" />
            </tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={cn("border-b border-border last:border-0", !c.active && "opacity-50")}>
                  <td className="px-5 py-2.5 font-mono">{c.code}</td>
                  <td className="px-2 font-medium">{c.name} {c.is_default && <Badge tone="accent">Predeterminada</Badge>}{c.notes && <p className="text-xs font-normal text-fg-subtle">{c.notes}</p>}</td>
                  <td className="px-2">{PAYMENT_KINDS[c.arca_kind]?.label}{PAYMENT_KINDS[c.arca_kind]?.electronic && <span className="ml-1 text-[11px] text-fg-subtle">(electrónico)</span>}</td>
                  <td className="px-2 text-fg-muted">{!c.days.length ? "El mismo día" : c.days.length === 1 ? `A ${c.days[0]} días` : `${c.days.length} cuotas: ${c.days.join(" / ")} días`}</td>
                  <td className="px-2 text-right tabular">{uses.get(c.id) ?? 0}</td>
                  <td className="px-5 text-right">{edit && <div className="flex justify-end gap-1"><ConditionButtons row={c} /><ConditionEditor row={c} nextCode={nextCode} /></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Condición habitual de cada cliente" description="La que se propone al facturarle. También se guarda sola con la última que usaste para ese cliente." />
        <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
          {(customers ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
              <span className="min-w-0 truncate">{c.name}</span>
              {edit ? <CustomerConditionSelect customerId={c.id} value={c.sale_condition_id} options={active.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }))} />
                : <span className="text-fg-muted">{list.find((x) => x.id === c.sale_condition_id)?.name ?? "La predeterminada"}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
