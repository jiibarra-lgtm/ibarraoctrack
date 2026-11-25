import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrg, canWrite } from "@/lib/session";
import { geminiReady } from "@/lib/gemini";
import { Studio } from "./studio";

export const metadata: Metadata = { title: "Mercado Libre · Estudio de fotos" };
export const dynamic = "force-dynamic";

export default async function MlStudio() {
  const s = await requireOrg();
  return (
    <>
      <PageHeader title="Estudio de fotos y videos" description="Con Gemini: fondo blanco para la portada, fotos en ambiente, infografías con medidas y clips cortos, listos para subir a Mercado Libre." />
      {canWrite(s.org.role) ? <Studio ready={geminiReady()} /> : <p className="text-sm text-fg-muted">No tenés permiso.</p>}
    </>
  );
}
