import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";
import { loadRemito } from "@/lib/remito-load";
import { RemitoSheet } from "@/components/remito/remito-sheet";
import { PrintBar } from "./print-bar";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Remito" };
  const s = await requireOrg();
  const { data } = await s.supabase.from("remitos_overview").select("label, recipient_name").eq("id", id).maybeSingle();
  // El título es el nombre sugerido del PDF al guardar
  return { title: { absolute: data ? `Remito ${data.label} - ${data.recipient_name}` : "Remito" } };
}

/** Hoja lista para imprimir o "Guardar como PDF" (tamaño carta, sin márgenes del navegador). */
export default async function PrintRemito({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const s = await requireOrg();
  const data = await loadRemito(s.supabase, s.org.org_id, id);
  if (!data) notFound();
  return (
    <div className="remito-print-root">
      <style>{`
        @page { size: letter; margin: 0; }
        html, body { background: #e9ece9 !important; }
        .remito-print-root { min-height: 100vh; padding: 72px 0 40px; display: flex; justify-content: center; }
        .remito-print-root .remito-sheet { box-shadow: 0 10px 40px rgba(0,0,0,.15); }
        @media print {
          html, body { background: #fff !important; }
          .remito-print-root { padding: 0; display: block; min-height: 0; }
          .remito-print-root .remito-sheet { box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <PrintBar id={id} label={data.row.label} />
      <RemitoSheet data={data.sheet} qrSvg={data.qrSvg} />
    </div>
  );
}
