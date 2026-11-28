import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireOrg, canWrite } from "@/lib/session";
import { widgetPrefs, type WidgetData } from "@/lib/ml/widget-prefs";
import { WidgetDesigner } from "./designer";
import { WidgetSetup } from "./widget-ui";

export const metadata: Metadata = { title: "Mercado Libre · Widget" };
export const dynamic = "force-dynamic";

const STEPS = [
  ["Instalá Scriptable", "Es gratis, en la App Store (de Simon Støvring). Es la forma de tener un widget propio sin publicar una app."],
  ["Generá y copiá el script", "Tocá el botón de abajo y después «Copiar script»."],
  ["Pegalo en Scriptable", "Abrí Scriptable, tocá «+», pegá el script y ponele de nombre «Mercado Libre». Tocá ▶ para probarlo."],
  ["Agregá el widget", "En la pantalla de inicio mantené apretado → «+» → Scriptable → elegí el tamaño (chico, mediano o grande) → «Agregar widget»."],
  ["Elegí el script", "Mantené apretado el widget → «Editar widget» → Script: «Mercado Libre». Al tocarlo abre las Stats."],
];

export default async function MlWidget() {
  const s = await requireOrg();
  const [{ data: info }, { data: wd }] = await Promise.all([
    s.supabase.rpc("widget_token_info", { p_org: s.org.org_id }),
    s.supabase.rpc("widget_ml_me", { p_org: s.org.org_id }),
  ]);
  const i = info as { created_at: string; last_used_at: string | null } | null;
  const data = wd as (WidgetData & { prefs?: unknown }) | null;
  return (
    <>
      <PageHeader title="Widget del iPhone" description="Tus números de Mercado Libre en la pantalla de inicio: ventas de hoy, ayer, 7 días y el mes, gráfico de la semana, preguntas, reclamos y stock." />
      {data && <div className="mb-5"><WidgetDesigner data={data} initial={widgetPrefs(data.prefs)} canEdit={canWrite(s.org.role)} /></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Cómo instalarlo" description="Lleva 2 minutos. Se actualiza solo cada 15 minutos aprox. (lo decide el iPhone)." />
          <CardBody className="space-y-4">
            <ol className="space-y-3">
              {STEPS.map(([t, d], n) => (
                <li key={t} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white text-xs font-semibold text-black">{n + 1}</span>
                  <div><p className="text-sm font-medium">{t}</p><p className="text-xs text-fg-muted">{d}</p></div>
                </li>
              ))}
            </ol>
            <WidgetSetup hasKey={Boolean(i)} />
            {i && <p className="text-xs text-fg-subtle">Si lo instalaste antes del 28/11, generá el script de nuevo una sola vez para que tome el diseño. Después, los cambios llegan solos.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tamaños" />
          <CardBody className="space-y-2 text-sm text-fg-muted">
            <p><b className="text-fg">Chico:</b> el número grande, una cajita y los avisos.</p>
            <p><b className="text-fg">Mediano:</b> número grande, gráfico de 7 días y las primeras 3 cajitas.</p>
            <p><b className="text-fg">Grande:</b> todo, hasta 6 cajitas y la última venta.</p>
            {i && <p className="pt-2 text-xs text-fg-subtle">Clave creada el {new Date(i.created_at).toLocaleDateString("es-AR")}{i.last_used_at ? ` · última lectura ${new Date(i.last_used_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : " · todavía no se usó"}.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
