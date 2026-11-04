"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ChevronDown, FileText, Plus, ScanLine, TriangleAlert, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, Field, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlays";
import { DELIVERY_STATUSES, DELIVERY_STATUS_LABEL, DELIVERY_TONE, deliveryNumber, type DeliveryStatus } from "@/lib/delivery";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { uploadPrivate } from "@/lib/upload";
import { compressPhoto } from "@/components/doc-uploader";
import { attachDocument } from "@/app/(app)/ordenes/actions";
import { addIncident, setDeliveryStatus } from "@/app/(app)/entregas/actions";
import { DocumentButton } from "@/app/(app)/ordenes/[id]/document-button";
import { DeliveryForm, type DeliveryItemOption } from "./delivery-form";

export type DeliveryRow = {
  id: string; internal_number: number; status: DeliveryStatus; planned_date: string | null; actual_date: string | null;
  remito_number: string | null; delivery_place: string | null; responsible: string | null; transport: string | null; notes: string | null; version: number;
  items: { purchase_order_item_id: string; quantity: string; line_number: number }[];
  documents: { id: string; title: string; created_at: string }[];
  incidents: { id: string; kind: string; description: string; created_at: string }[];
};

export function DeliveriesPanel({ poId, orgId, items, deliveries, defaultPlace, canEdit }: {
  poId: string; orgId: string; items: DeliveryItemOption[]; deliveries: DeliveryRow[]; defaultPlace: string; canEdit: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const totalQty = items.reduce((a, i) => a + Number(i.quantity), 0);
  const delivered = deliveries.filter((d) => ["entregada", "recibida_provisional", "conformada"].includes(d.status))
    .reduce((a, d) => a + d.items.reduce((x, i) => x + Number(i.quantity), 0), 0);
  const pct = totalQty ? Math.round((delivered / totalQty) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div className="flex-1">
            <p className="text-sm text-fg-muted">Avance de entrega</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
              <span className="text-sm font-semibold tabular">{pct}%</span>
            </div>
            <p className="mt-1 text-xs text-fg-subtle tabular">{formatQty(delivered)} de {formatQty(totalQty)} unidades entregadas</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary"><Link href={`/entregas/remito?oc=${poId}`}><ScanLine /> Leer remito</Link></Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button><Plus /> Nueva entrega</Button></DialogTrigger>
                <DialogContent title="Nueva entrega" className="max-w-2xl">
                  <DeliveryForm poId={poId} items={items} defaults={{ delivery_place: defaultPlace }} onDone={() => setOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </Card>

      {deliveries.length === 0 ? (
        <Card><EmptyState icon={<Truck />} title="Sin entregas" description="Registrá entregas parciales o totales; el sistema controla que no superen lo adjudicado." /></Card>
      ) : deliveries.map((d) => <DeliveryCard key={d.id} d={d} poId={poId} orgId={orgId} items={items} canEdit={canEdit} />)}
    </div>
  );
}

function DeliveryCard({ d, poId, orgId, items, canEdit }: { d: DeliveryRow; poId: string; orgId: string; items: DeliveryItemOption[]; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [incident, setIncident] = React.useState(false);
  const cam = React.useRef<HTMLInputElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const byId = new Map(items.map((i) => [i.id, i]));

  const changeStatus = async (s: DeliveryStatus) => {
    let reason = "";
    if (s === "rechazada" || s === "cancelada") {
      reason = prompt(`Motivo (${DELIVERY_STATUS_LABEL[s].toLowerCase()}):`) ?? "";
      if (!reason.trim()) return;
    }
    const r = await setDeliveryStatus(d.id, s, reason, poId);
    if (!r.ok) return toast.error(r.error);
    toast.success(DELIVERY_STATUS_LABEL[s]);
    router.refresh();
  };

  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const small = await compressPhoto(f);
      const up = await uploadPrivate(small, orgId, `entregas/${d.id}`);
      const r = await attachDocument({ purchaseOrderId: poId, deliveryId: d.id, docType: "remito", storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
      if (!r.ok) throw new Error(r.error);
      toast.success("Remito guardado");
      router.refresh();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader
        title={<span className="flex flex-wrap items-center gap-2">{deliveryNumber(d.internal_number)} <Badge tone={DELIVERY_TONE[d.status]}>{DELIVERY_STATUS_LABEL[d.status]}</Badge>{d.remito_number && <span className="text-xs font-normal text-fg-subtle">Remito {d.remito_number}</span>}</span>}
        description={[d.actual_date ? `Entregada ${formatDate(d.actual_date)}` : d.planned_date ? `Prevista ${formatDate(d.planned_date)}` : null, d.delivery_place, d.responsible, d.transport].filter(Boolean).join(" · ")}
        action={canEdit && (
          <div className="flex items-center gap-1">
            <Menu>
              <MenuTrigger asChild><Button variant="secondary" size="sm">Estado <ChevronDown /></Button></MenuTrigger>
              <MenuContent>
                {DELIVERY_STATUSES.filter((s) => s !== d.status).map((s) => <MenuItem key={s} onSelect={() => changeStatus(s)}>{DELIVERY_STATUS_LABEL[s]}</MenuItem>)}
              </MenuContent>
            </Menu>
            <Dialog open={edit} onOpenChange={setEdit}>
              <DialogTrigger asChild><Button variant="ghost" size="sm">Editar</Button></DialogTrigger>
              <DialogContent title={`Editar ${deliveryNumber(d.internal_number)}`} className="max-w-2xl">
                <DeliveryForm poId={poId} items={items} onDone={() => setEdit(false)}
                  defaults={{ id: d.id, version: d.version, status: d.status, planned_date: d.planned_date ?? "", actual_date: d.actual_date ?? "",
                    delivery_place: d.delivery_place ?? "", responsible: d.responsible ?? "", transport: d.transport ?? "", remito_number: d.remito_number ?? "",
                    notes: d.notes ?? "", quantities: Object.fromEntries(d.items.map((i) => [i.purchase_order_item_id, String(Number(i.quantity))])) }} />
              </DialogContent>
            </Dialog>
          </div>
        )}
      />
      <ul className="divide-y divide-border">
        {d.items.map((i) => (
          <li key={i.purchase_order_item_id} className="flex justify-between gap-3 px-4 py-2 text-sm sm:px-5">
            <span className="min-w-0 truncate"><span className="text-fg-subtle tabular">R{i.line_number}</span> {byId.get(i.purchase_order_item_id)?.description}</span>
            <span className="shrink-0 font-medium tabular">{formatQty(i.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          {d.documents.map((doc) => (
            <span key={doc.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2/60 py-0.5 pl-2 text-xs">
              <FileText className="size-3.5 text-fg-muted" /> <span className="max-w-40 truncate">{doc.title}</span>
              <DocumentButton documentId={doc.id} variant="ghost" size="icon-sm" />
            </span>
          ))}
          {canEdit && (
            <>
              <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={file} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
              <Button size="sm" variant="secondary" loading={busy} onClick={() => cam.current?.click()}><Camera /> Foto del remito firmado</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => file.current?.click()}>Subir archivo</Button>
              <Button size="sm" variant="ghost" onClick={() => setIncident((x) => !x)}><TriangleAlert /> Incidencia</Button>
            </>
          )}
        </div>
        {d.incidents.map((x) => (
          <p key={x.id} className="flex items-start gap-2 rounded-md bg-warn-soft/50 px-2.5 py-1.5 text-xs"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" /><span><span className="font-medium capitalize">{x.kind}</span>: {x.description} <span className="text-fg-subtle">· {formatDateTime(x.created_at)}</span></span></p>
        ))}
        {incident && <IncidentForm deliveryId={d.id} poId={poId} onDone={() => { setIncident(false); router.refresh(); }} />}
      </div>
    </Card>
  );
}

function IncidentForm({ deliveryId, poId, onDone }: { deliveryId: string; poId: string; onDone: () => void }) {
  const [kind, setKind] = React.useState("faltante");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid grid-cols-[140px_1fr_auto] items-end gap-2">
      <Field label="Tipo"><NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}>{["faltante", "rotura", "rechazo", "demora", "diferencia", "otro"].map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect></Field>
      <Field label="Descripción"><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <Button size="md" loading={busy} disabled={!text.trim()} onClick={async () => {
        setBusy(true);
        const r = await addIncident(deliveryId, kind, text, poId);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        onDone();
      }}>Agregar</Button>
    </div>
  );
}
