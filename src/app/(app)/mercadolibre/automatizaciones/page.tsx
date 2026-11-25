import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { mlPage } from "@/lib/ml/page";
import { BlockBuyerButton, GoalsForm, HoursForm, SettingToggle, TemplateForm, VacationButton } from "../pro-ui";
import { NotConnected, ago } from "../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Automatizaciones" };
export const dynamic = "force-dynamic";

const DEFAULT_TEMPLATE = `{titulo}

✔ Producto nuevo, original y con garantía.
✔ Emitimos factura A y B.
✔ Despachamos en el día comprando antes de las 13 hs (días hábiles).

📦 QUÉ INCLUYE
-

📐 CARACTERÍSTICAS
-

🏢 VENTAS MAYORISTAS
Consultanos por cantidades: tenemos precio especial.

Ibarra Insumos`;

export default async function MlAutomations() {
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Automatizaciones" /><NotConnected /></>);
  const [settingsQ, blockedQ, rulesQ] = await Promise.all([
    sb.from("ml_settings").select("*").eq("org_id", org).maybeSingle(),
    sb.from("ml_blocked_buyers").select("*").eq("org_id", org).order("created_at", { ascending: false }),
    sb.from("ml_auto_answers").select("id, active").eq("org_id", org),
  ]);
  const s = settingsQ.data;
  if (!s) return (
    <><PageHeader title="Automatizaciones" />
      <Card><CardBody className="text-sm text-fg-muted">Falta activar la base de datos de esta sección (la actualización de Supabase pendiente). Apenas se aplique, aparecen acá los ajustes.</CardBody></Card></>
  );
  const activeRules = (rulesQ.data ?? []).filter((r) => r.active).length;

  return (
    <>
      <PageHeader title="Automatizaciones" description="Lo que la app hace sola cada 10 minutos con tu cuenta de Mercado Libre." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Automático" />
          <CardBody className="divide-y divide-border">
            <SettingToggle field="auto_answers" value={s.auto_answers} label="Responder preguntas automáticamente" hint={`${activeRules} respuestas activas + mensaje fuera de horario. Editalas en Preguntas › Respuestas automáticas.`} />
            <SettingToggle field="repricing" value={s.repricing} label="Precio automático" hint="Aplica las reglas de Precios › Precio automático." />
          </CardBody>
          <CardHeader title="Avisos al celular" description="Notificaciones push (activá las notificaciones en este dispositivo desde Configuración)." />
          <CardBody className="divide-y divide-border">
            <SettingToggle field="push_sales" value={s.push_sales} label="Cada venta nueva" />
            <SettingToggle field="push_questions" value={s.push_questions} label="Cada pregunta nueva" />
            <SettingToggle field="push_claims" value={s.push_claims} label="Reclamos, bajas de publicaciones y cambios de la competencia" />
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Modo vacaciones" description="Pausa todas las publicaciones activas y al volver reactiva exactamente esas." />
            <CardBody className="space-y-2">
              {s.vacation && <p className="text-sm">Estás de vacaciones: {s.vacation_items.length} publicaciones pausadas.</p>}
              {edit && <VacationButton on={s.vacation} />}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Horario de atención" description="Fuera de este horario, si las respuestas automáticas están activas, se contesta con este mensaje." />
            <CardBody>{edit ? <HoursForm from={s.hours_from} to={s.hours_to} days={s.work_days} offAnswer={s.off_hours_answer ?? ""} /> : <p className="text-sm">{s.hours_from} a {s.hours_to} hs</p>}</CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card id="metas">
          <CardHeader title="Metas del mes" description="Las ves en el Resumen con el avance día a día." />
          <CardBody>{edit && <GoalsForm sales={s.goal_sales} units={s.goal_units} profit={s.goal_profit} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title={`Compradores bloqueados · ${(blockedQ.data ?? []).length}`} description="No te pueden comprar ni preguntar. Se bloquea desde Preguntas." />
          {(blockedQ.data ?? []).length === 0 ? <CardBody className="text-sm text-fg-muted">Nadie bloqueado.</CardBody> : (
            <ul className="divide-y divide-border text-sm">
              {(blockedQ.data ?? []).map((b) => (
                <li key={b.user_id} className="flex items-center justify-between px-5 py-2">
                  <span>{b.nickname ?? b.user_id} <span className="text-xs text-fg-subtle">· {ago(b.created_at)}{b.reason ? ` · ${b.reason}` : ""}</span></span>
                  {edit && <BlockBuyerButton userId={b.user_id} blocked />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Plantilla de descripción" description="Se usa al crear publicaciones nuevas (botón “Usar mi plantilla” en Publicar)." />
        <CardBody>{edit && <TemplateForm value={s.desc_template ?? DEFAULT_TEMPLATE} />}</CardBody>
      </Card>
      <p className="mt-4 text-xs text-fg-subtle">Los datos de tus compras en Mercado Libre se guardan solo de las últimas 100. <Link href="/mercadolibre/compras" className="underline">Ver compras</Link></p>
    </>
  );
}
