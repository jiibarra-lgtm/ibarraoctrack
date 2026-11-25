import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { mlPage } from "@/lib/ml/page";
import { mlItemForCopy } from "../pro-actions";
import { NotConnected } from "../pro-shared";
import { Publisher } from "./publisher";

export const metadata: Metadata = { title: "Mercado Libre · Publicar" };
export const dynamic = "force-dynamic";

export default async function MlPublish({ searchParams }: { searchParams: Promise<{ copiar?: string; fotos?: string }> }) {
  const sp = await searchParams;
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Publicar" /><NotConnected /></>);
  if (!edit) return (<><PageHeader title="Publicar" description="No tenés permiso para publicar." /></>);
  const [copyR, settings] = await Promise.all([
    sp.copiar && /^MLA\d+$/.test(sp.copiar) ? mlItemForCopy(sp.copiar) : Promise.resolve(null),
    sb.from("ml_settings").select("desc_template").eq("org_id", org).maybeSingle(),
  ]);
  const copy = copyR?.ok ? (copyR.item as Parameters<typeof Publisher>[0]["copy"]) : null;
  const studio = (sp.fotos ?? "").split(",").filter((x) => /^[\w-]{6,80}$/.test(x)).slice(0, 12).map((id) => ({ id, url: `https://http2.mlstatic.com/D_${id}-O.jpg` }));
  return (
    <>
      <PageHeader title={copy ? "Duplicar publicación" : "Nueva publicación"}
        description="Categoría sugerida, ficha técnica, fotos, comisión y ganancia antes de publicar. Revisá con Mercado Libre y publicá." />
      <Publisher copy={copy} template={settings.data?.desc_template ?? null} studio={studio} />
    </>
  );
}
