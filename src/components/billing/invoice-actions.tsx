"use client";
import { Ban, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentButton } from "@/app/(app)/ordenes/[id]/document-button";
import { voidCollection, voidInvoice } from "@/app/(app)/facturacion/actions";
import { CollectionDialog, type CollectableInvoice } from "./collection-dialog";
import { VoidDialog } from "./void-dialog";

export function InvoiceActions({ invoice, canBill, canVoid, documentId }: { invoice: CollectableInvoice; canBill: boolean; canVoid: boolean; documentId: string | null }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {documentId && <DocumentButton documentId={documentId} variant="ghost" size="icon-sm" />}
      {canBill && Number(invoice.balance) > 0 && (
        <CollectionDialog invoice={invoice} trigger={<Button size="sm"><HandCoins /> Cobrar</Button>} />
      )}
      {canBill && canVoid && (
        <VoidDialog title={`Anular ${invoice.label}`} description="La factura queda registrada como anulada y libera el saldo de la orden."
          action={(r) => voidInvoice(invoice.id, r)} trigger={<Button variant="ghost" size="icon-sm" aria-label="Anular factura"><Ban /></Button>} />
      )}
    </div>
  );
}

export function VoidCollectionButton({ id }: { id: string }) {
  return (
    <VoidDialog title="Anular cobro" description="El cobro queda registrado como anulado y la factura vuelve a tener saldo."
      action={(r) => voidCollection(id, r)} trigger={<Button variant="ghost" size="icon-sm" aria-label="Anular cobro"><Ban /></Button>} />
  );
}
