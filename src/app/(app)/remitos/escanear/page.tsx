import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg, canWrite } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { loadScanSettings } from "@/lib/remito-load";
import { RemitoScanner, ScanSettingsForm } from "./scanner";

export const metadata: Metadata = { title: "Escanear remitos" };

/** Confirmar entregas escaneando el código de barras del remito, sin subir la foto. */
export default async function ScanPage() {
  const s = await requireOrg();
  const settings = await loadScanSettings(s.supabase, s.org.org_id);
  const canEdit = canWrite(s.org.role) || s.org.role === "logistica";
  return (
    <>
      <PageHeader title="Escanear remitos" description="Escaneá el código de barras de abajo del remito y queda confirmado al instante. También funciona con un lector de códigos USB o Bluetooth." />
      <div className="mb-4 flex gap-3 text-sm"><Link href="/remitos" className="text-fg-muted hover:text-fg">← Remitos</Link><Link href="/remitos/firmar" className="text-fg-muted hover:text-fg">Subir foto firmada</Link></div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {canEdit ? <RemitoScanner /> : <p className="text-sm text-fg-muted">Tu rol no permite confirmar remitos.</p>}
        <ScanSettingsForm initial={settings} canEdit={canEdit} />
      </div>
    </>
  );
}
