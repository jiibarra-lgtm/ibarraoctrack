"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { History, GitCommitHorizontal, ArrowRight } from "lucide-react";
import { OrderBilling } from "./order-billing";
import type { CollectionRow, InvoiceBalance, PoBilling } from "@/lib/billing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { PO_STATUS_LABEL, type PoStatus } from "@/lib/po/schema";
import { sum } from "@/lib/money";
import { OrderDocuments } from "./order-documents";
import { ProfitSummary, PurchasesTab, CostsTab, type ItemProfit, type AllocationRow, type CostAllocRow } from "./order-finance";
import type { ProfitRow } from "@/lib/profitability";
import type { OrderOption } from "@/app/(app)/costos/cost-dialog";
import { DeliveriesPanel, type DeliveryRow } from "@/components/delivery/deliveries-panel";
import type { DeliveryItemOption } from "@/components/delivery/delivery-form";

type Row = Record<string, unknown> & { id: string };
type Props = {
  initialTab?: string;
  po: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  items: Row[];
  documents: (Row & { uploader: string | null })[];
  history: (Row & { actor: string | null })[];
  revisions: (Row & { actor: string | null })[];
  itemAudit: Row[];
  createdBy: string | null;
  orgId: string;
  canWrite: boolean;
  canDeliver: boolean;
  profit: ProfitRow | null;
  itemProfit: ItemProfit[];
  allocations: AllocationRow[];
  costAllocs: CostAllocRow[];
  categories: { id: string; name: string; kind: string }[];
  orderOption: OrderOption;
  deliveryItems: DeliveryItemOption[];
  deliveries: DeliveryRow[];
  billing: PoBilling | null;
  invoices: InvoiceBalance[];
  collections: CollectionRow[];
  canBill: boolean;
};

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "productos", label: "Productos" },
  { id: "compras", label: "Compras" },
  { id: "costos", label: "Costos" },
  { id: "entregas", label: "Entregas" },
  { id: "facturacion", label: "Facturación y cobro" },
  { id: "documentos", label: "Documentos" },
  { id: "historial", label: "Historial" },
] as const;

export function OrderTabs(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const valid = TABS.find((t) => t.id === p.initialTab);
  const [tab, setTab] = React.useState<string>(valid?.id ?? "resumen");
  // Enlaces internos (?tab=…) cambian la pestaña sin recargar
  const [prevInitial, setPrevInitial] = React.useState(p.initialTab);
  if (p.initialTab !== prevInitial) { setPrevInitial(p.initialTab); if (valid) setTab(valid.id); }
  const cur = p.po.currency ?? "ARS";

  const change = (v: string) => {
    setTab(v);
    router.replace(`${pathname}?tab=${v}`, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={change}>
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {t.id === "productos" && <span className="rounded bg-surface-2 px-1.5 text-[11px] tabular text-fg-muted">{p.items.length}</span>}
              {t.id === "documentos" && p.documents.length > 0 && <span className="rounded bg-surface-2 px-1.5 text-[11px] tabular text-fg-muted">{p.documents.length}</span>}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="resumen" className="mt-5 flex flex-col gap-5"><Summary {...p} cur={cur} /></TabsContent>
      <TabsContent value="productos" className="mt-5"><Items items={p.items} cur={cur} /></TabsContent>
      <TabsContent value="compras" className="mt-5"><PurchasesTab items={p.itemProfit} allocations={p.allocations} cur={cur} canWrite={p.canWrite} /></TabsContent>
      <TabsContent value="costos" className="mt-5"><CostsTab rows={p.costAllocs} cur={cur} categories={p.categories} order={p.orderOption} canWrite={p.canWrite} /></TabsContent>
      <TabsContent value="entregas" className="mt-5"><DeliveriesPanel poId={p.po.id} orgId={p.orgId} items={p.deliveryItems} deliveries={p.deliveries} defaultPlace={p.po.delivery_place ?? ""} canEdit={p.canDeliver} /></TabsContent>
      <TabsContent value="facturacion" className="mt-5">
        <OrderBilling billing={p.billing} invoices={p.invoices} collections={p.collections} orgId={p.orgId} canBill={p.canBill} cur={cur}
          order={{ id: String(p.po.id), label: p.orderOption.label, customer: p.orderOption.customer, to_invoice: p.billing?.to_invoice ?? "0", currency: cur }} />
      </TabsContent>
      <TabsContent value="documentos" className="mt-5"><OrderDocuments documents={p.documents as never} poId={String(p.po.id)} orgId={p.orgId} canWrite={p.canWrite || p.canDeliver} /></TabsContent>
      <TabsContent value="historial" className="mt-5"><Timeline {...p} /></TabsContent>
    </Tabs>
  );
}

function Kpi({ label, value, sub, muted }: { label: string; value: React.ReactNode; sub?: React.ReactNode; muted?: boolean }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold tabular ${muted ? "text-fg-subtle" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-fg-subtle">{sub}</p>}
    </Card>
  );
}

function Def({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  const v = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${mono ? "font-mono text-[13px]" : ""} ${v === "—" ? "text-fg-subtle" : "text-fg"}`}>{v}</dd>
    </div>
  );
}

function Summary({ po, items, cur, profit, billing }: Props & { cur: string }) {
  const units = items.reduce((acc, it) => acc + Number(it.quantity ?? 0), 0);
  const itemsSum = sum(items.map((i) => String(i.total_amount)));
  const declared = po.total_amount ?? po.net_amount;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total adjudicado" value={formatMoney(declared ?? itemsSum, cur)} sub={po.discount_amount && Number(po.discount_amount) > 0 ? `Bonificado ${formatMoney(po.discount_amount, cur)}` : `Neto ${formatMoney(po.net_amount, cur)}`} />
        <Kpi label="Renglones" value={items.length} sub={`${formatQty(units)} unidades en total`} />
        <Kpi label="Autorización" value={formatDate(po.issue_date)} sub={po.perfected_date ? `Perfeccionada ${formatDate(po.perfected_date)}` : "Sin perfeccionamiento"} />
        <Kpi label="Plazo de entrega" value={po.delivery_term_days ? `${po.delivery_term_days} días` : "—"} sub={po.delivery_term_text ?? (po.due_date ? `Límite ${formatDate(po.due_date)}` : undefined)} />
      </div>

      <ProfitSummary p={profit} cur={cur} billing={billing} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Orden y proceso" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Def label="Número OC" value={po.bac_number} mono />
              <Def label="Tipo / Ejercicio" value={[po.bac_type, po.fiscal_year].filter(Boolean).join(" · ")} />
              <Def label="Estado en BAC" value={po.bac_status} />
              <Def label="Duración del contrato" value={po.contract_duration} />
              <Def label="Procedimiento" value={po.process_number} mono />
              <Def label="Modalidad" value={[po.process_type, po.modality].filter(Boolean).join(" · ")} />
              <div className="col-span-2"><Def label="Expediente" value={po.expediente_number} mono /></div>
              <div className="col-span-2"><Def label="Acto de adjudicación" value={po.award_act_number} mono /></div>
              {po.legal_framework && <div className="col-span-2"><Def label="Encuadre legal" value={po.legal_framework} /></div>}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Comprador y adjudicatario" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <div className="col-span-2"><Def label="Organismo" value={po.customer_name} /></div>
              <Def label="Jurisdicción" value={po.jurisdiction} />
              <Def label="Teléfono" value={po.buyer_phone} />
              <div className="col-span-2"><Def label="Dirección" value={po.buyer_address} /></div>
              {po.buyer_notes && <div className="col-span-2"><Def label="Observaciones" value={po.buyer_notes} /></div>}
              <Def label="Adjudicatario" value={po.awardee_name} />
              <Def label="CUIT" value={po.awardee_cuit} mono />
              {Array.isArray(po.authorizers) && po.authorizers.length > 0 && (
                <div className="col-span-2">
                  <Def label="Autorizó" value={po.authorizers.map((a: { nombre: string; cargo?: string; fecha?: string }) => `${a.nombre}${a.cargo ? ` (${a.cargo})` : ""}${a.fecha ? ` · ${formatDate(a.fecha)}` : ""}`).join(" · ")} />
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
      </div>
      {po.notes && <Card><CardHeader title="Observaciones internas" /><CardBody className="whitespace-pre-wrap text-sm">{po.notes}</CardBody></Card>}
    </>
  );
}

function Items({ items, cur }: { items: Row[]; cur: string }) {
  if (!items.length) return <Card><EmptyState title="Sin renglones" /></Card>;
  const total = sum(items.map((i) => String(i.total_amount)));
  return (
    <Card className="overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-fg-muted">
              <th className="px-4 py-2.5 font-medium">Renglón</th>
              <th className="px-4 py-2.5 font-medium">Código</th>
              <th className="px-4 py-2.5 font-medium">Descripción</th>
              <th className="px-4 py-2.5 text-right font-medium">Cantidad</th>
              <th className="px-4 py-2.5 text-right font-medium">Precio unit.</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">Entrega</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-border align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-3 tabular">{String(it.line_number)}<span className="text-fg-subtle">.{String(it.option_number)}</span></td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-fg-muted">{String(it.bac_code ?? "—")}</td>
                <td className="max-w-xl px-4 py-3"><ExpandableText text={String(it.description_original)} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular">{formatQty(it.quantity as string)} <span className="text-xs text-fg-subtle">{String(it.unit ?? "")}</span></td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular">{formatMoney(it.unit_price as string, cur)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular">{formatMoney(it.total_amount as string, cur)}</td>
                <td className="max-w-56 px-4 py-3 text-xs text-fg-muted">
                  {[it.delivery_address, it.delivery_term].filter(Boolean).join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-2/50">
              <td colSpan={5} className="px-4 py-3 text-right text-sm text-fg-muted">Total renglones</td>
              <td className="px-4 py-3 text-right font-semibold tabular">{formatMoney(total, cur)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {items.map((it) => (
          <li key={it.id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
              <span>Renglón {String(it.line_number)}.{String(it.option_number)} · <span className="font-mono">{String(it.bac_code ?? "")}</span></span>
            </div>
            <ExpandableText text={String(it.description_original)} />
            <div className="flex items-end justify-between text-sm">
              <span className="text-fg-muted tabular">{formatQty(it.quantity as string)} {String(it.unit ?? "")} × {formatMoney(it.unit_price as string, cur)}</span>
              <span className="font-medium tabular">{formatMoney(it.total_amount as string, cur)}</span>
            </div>
          </li>
        ))}
        <li className="flex justify-between bg-surface-2/50 px-4 py-3 text-sm"><span className="text-fg-muted">Total</span><span className="font-semibold tabular">{formatMoney(total, cur)}</span></li>
      </ul>
    </Card>
  );
}

function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > 160;
  return (
    <div>
      <p className={open || !long ? "whitespace-pre-wrap" : "line-clamp-2"}>{text}</p>
      {long && <button className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(!open)}>{open ? "Ver menos" : "Ver más"}</button>}
    </div>
  );
}

function Timeline({ history, revisions, itemAudit, po, createdBy }: Props) {
  type Ev = { at: string; icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode };
  const evs: Ev[] = [];
  history.forEach((h) => evs.push({
    at: String(h.changed_at),
    icon: <History className="size-3.5" />,
    title: h.from_status
      ? <span className="inline-flex flex-wrap items-center gap-1.5">Estado <Badge>{PO_STATUS_LABEL[h.from_status as PoStatus]}</Badge><ArrowRight className="size-3" /><Badge tone="primary">{PO_STATUS_LABEL[h.to_status as PoStatus]}</Badge></span>
      : <>Orden creada ({po.source === "importacion" ? "importada de BAC" : "carga manual"}) como <Badge tone="primary">{PO_STATUS_LABEL[h.to_status as PoStatus]}</Badge></>,
    sub: [h.actor, h.reason ? `“${h.reason}”` : null].filter(Boolean).join(" · "),
  }));
  revisions.forEach((r) => evs.push({
    at: String(r.changed_at), icon: <GitCommitHorizontal className="size-3.5" />,
    title: <>Cabecera modificada (versión {Number(r.revision) + 1})</>, sub: r.actor ?? undefined,
  }));
  itemAudit.forEach((a) => {
    const d = (a.new_data ?? a.old_data) as Record<string, unknown> | null;
    const verb = a.action === "INSERT" ? "agregado" : a.action === "DELETE" ? "eliminado" : "modificado";
    let change = "";
    if (a.action === "UPDATE" && a.old_data && a.new_data) {
      const o = a.old_data as Record<string, unknown>, n = a.new_data as Record<string, unknown>;
      change = (["quantity", "unit_price", "total_amount"] as const).filter((k) => String(o[k]) !== String(n[k])).map((k) => `${k === "quantity" ? "cantidad" : k === "unit_price" ? "precio" : "total"}: ${o[k]} → ${n[k]}`).join(" · ");
    }
    evs.push({ at: String(a.at), icon: <GitCommitHorizontal className="size-3.5" />, title: <>Renglón {String(d?.line_number ?? "")} {verb}</>, sub: change || undefined });
  });
  evs.sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <Card>
      <CardHeader title="Historial" description={createdBy ? `Creada por ${createdBy} el ${formatDateTime(po.created_at)}` : undefined} />
      <CardBody>
        {evs.length === 0 ? <p className="text-sm text-fg-subtle">Sin movimientos.</p> : (
          <ol className="relative ml-2 border-l border-border">
            {evs.map((e, i) => (
              <li key={i} className="mb-5 ml-5 last:mb-0">
                <span className="absolute -left-[11px] grid size-[22px] place-items-center rounded-full border border-border bg-surface text-fg-muted">{e.icon}</span>
                <p className="text-sm">{e.title}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">{formatDateTime(e.at)}{e.sub ? ` · ${e.sub}` : ""}</p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
