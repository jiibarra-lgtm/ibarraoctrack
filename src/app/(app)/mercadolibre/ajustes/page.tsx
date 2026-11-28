import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { mlPage } from "@/lib/ml/page";
import { labelPrefs, profitRules } from "@/lib/ml/prefs";
import { LabelSettings, ProfitSettings } from "./settings-ui";

export const metadata: Metadata = { title: "Mercado Libre · Ajustes" };
export const dynamic = "force-dynamic";

export default async function MlSettings() {
  const { sb, org, edit } = await mlPage();
  const { data } = await sb.from("ml_settings").select("label_prefs, profit_rules").eq("org_id", org).maybeSingle();
  return (
    <>
      <PageHeader title="Ajustes" description="Cómo se imprimen las etiquetas y cómo se calcula tu ganancia real en Mercado Libre." />
      <div className="grid gap-5 xl:grid-cols-2">
        <ProfitSettings initial={profitRules(data?.profit_rules)} canEdit={edit} />
        <LabelSettings initial={labelPrefs(data?.label_prefs)} canEdit={edit} />
      </div>
    </>
  );
}
