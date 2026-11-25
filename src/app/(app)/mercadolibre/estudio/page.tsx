import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrg, canWrite } from "@/lib/session";
import { geminiReady } from "@/lib/gemini";
import { openaiReady } from "@/lib/openai-images";
import { cloudflareReady } from "@/lib/cloudflare-images";
import { Studio } from "./studio";

export const metadata: Metadata = { title: "Mercado Libre · Estudio de fotos" };
export const dynamic = "force-dynamic";
export const maxDuration = 120; // generar una foto tarda hasta ~1 minuto

export default async function MlStudio() {
  const s = await requireOrg();
  return (
    <>
      <PageHeader title="Estudio de fotos y videos" description="Con IA (gratis con Cloudflare): fondo blanco para la portada, fotos en ambiente, infografías con medidas y clips cortos, listos para subir a Mercado Libre." />
      {canWrite(s.org.role) ? <Studio ready={cloudflareReady() || openaiReady() || geminiReady()} video={geminiReady()} /> : <p className="text-sm text-fg-muted">No tenés permiso.</p>}
    </>
  );
}
