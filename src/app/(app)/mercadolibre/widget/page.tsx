import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireOrg } from "@/lib/session";
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
  const { data: info } = await s.supabase.rpc("widget_token_info", { p_org: s.org.org_id });
  const i = info as { created_at: string; last_used_at: string | null } | null;
  return (
    <>
      <PageHeader title="Widget del iPhone" description="Tus números de Mercado Libre en la pantalla de inicio: ventas de hoy, ayer, 7 días y el mes, gráfico de la semana, preguntas, reclamos y stock." />
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
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Qué muestra" />
          <CardBody className="space-y-2 text-sm text-fg-muted">
            <p><b className="text-fg">Chico:</b> facturación y ventas de hoy, total del mes y avisos.</p>
            <p><b className="text-fg">Mediano:</b> lo anterior más el gráfico de los últimos 7 días, ayer, 7 días y el mes contra el mes pasado.</p>
            <p><b className="text-fg">Grande:</b> todo, más preguntas sin responder, reclamos, publicaciones sin stock y la última venta.</p>
            {i && <p className="pt-2 text-xs text-fg-subtle">Clave creada el {new Date(i.created_at).toLocaleDateString("es-AR")}{i.last_used_at ? ` · última lectura ${new Date(i.last_used_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : " · todavía no se usó"}.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
