import Link from "next/link";
import { ClipboardList, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemitoSheet } from "@/components/remito/remito-sheet";
import { baParts, type RemitoIssuer, type RemitoSheetData } from "@/lib/remitos";
import { findOrderForRemito } from "@/app/(app)/remitos/actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmitDraftButton } from "./remito-draft-button";

/**
 * Remito armado solo con lo que falta entregar de la OC, con el mismo formato de siempre.
 * Es opcional: se emite tal cual con un clic, se edita antes, o se ignora.
 */
export async function RemitoDraft({ sb, org, orderNumber }: { sb: SupabaseClient; org: string; orderNumber: string }) {
  const [oc, { data: set }] = await Promise.all([
    findOrderForRemito(orderNumber),
    sb.from("remito_settings").select("*").eq("org_id", org).maybeSingle(),
  ]);
  if (!oc) return null;
  const pending = oc.items.filter((i) => Number(i.pending) > 0);
  if (!pending.length) return null;
  const issuer: RemitoIssuer = {
    name: set?.issuer_name ?? "", address: set?.address_line ?? "", phones: set?.phones_line ?? "", iva: set?.iva_condition ?? "",
    cuit: set?.cuit ?? "", iibb: set?.iibb ?? "", start: set?.start_date ?? "", whatsapp: set?.whatsapp ?? null,
  };
  const recipient = {
    name: oc.dependencia?.replace(/^\d+\s*-\s*/, "") || oc.customer_name || "",
    address: oc.delivery_place || oc.customer_address || "", cuit: oc.customer_cuit ?? "", iva: "",
  };
  const now = new Date().toISOString();
  const p = baParts(now);
  const sheet: RemitoSheetData = {
    label: null, provisional: true, issuedAt: now, recipient, notes: "", issuer, poNumber: oc.number, voided: false,
    items: pending.map((i) => ({ description: i.description, quantity: i.pending, detail: "", unit_price: null })),
  };
  const payload = {
    recipient_name: recipient.name, recipient_address: recipient.address, recipient_cuit: recipient.cuit, recipient_iva: "",
    customer_id: oc.customer_id ?? "", purchase_order_id: oc.id, register_delivery: true, provisional: true,
    date: `${p.y}-${p.m}-${p.d}`, time: p.hm, notes: "", oc_number: "",
    items: pending.map((i) => ({ description: i.description, quantity: String(Number(i.pending)).replace(".", ","), detail: "", purchase_order_item_id: i.id })),
  };
  return (
    <details className="group mb-4 overflow-hidden rounded-2xl border border-card-border bg-surface-solid">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <ClipboardList className="size-5 text-brand" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Remito listo para esta OC</span>
          <span className="block text-xs text-fg-muted">{pending.length} renglón{pending.length === 1 ? "" : "es"} pendiente{pending.length === 1 ? "" : "s"} de entregar, con el mismo formato de siempre. Es opcional: usalo si te sirve.</span>
        </span>
        <span className="text-xs font-medium text-brand group-open:hidden">Ver remito</span>
      </summary>
      <div className="border-t border-border p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <EmitDraftButton payload={payload} />
          <Button asChild variant="secondary"><Link href={`/remitos?oc=${encodeURIComponent(oc.number)}`}><Pencil /> Editar antes de emitir</Link></Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
          <div className="w-[816px] [zoom:0.42] sm:[zoom:0.7] lg:[zoom:0.85]">
            <RemitoSheet data={sheet} qrCaption="Se genera al emitir" />
          </div>
        </div>
      </div>
    </details>
  );
}
