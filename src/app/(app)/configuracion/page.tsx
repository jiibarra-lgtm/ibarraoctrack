import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { aiAvailable } from "@/lib/bac/ai";
import { env } from "@/lib/env";
import { OrgForm } from "./org-form";
import { FinanceForm } from "./finance-form";
import { GmailConnect } from "./gmail-connect";
import { StorageUsage } from "./storage-usage";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const s = await requireOrg();
  const [{ data: org }, { data: fs }, { data: tok }, { data: usage }] = await Promise.all([
    s.supabase.from("organizations").select("id, name, legal_name, cuit").eq("id", s.org.org_id).single(),
    s.supabase.from("financial_settings").select("*").eq("org_id", s.org.org_id).maybeSingle(),
    s.supabase.from("inbound_tokens").select("last_used_at, total_events, created_at").eq("org_id", s.org.org_id).maybeSingle(),
    s.supabase.rpc("storage_usage", { p_org: s.org.org_id }),
  ]);
  const hdrs = await headers();
  const appUrl = `${hdrs.get("x-forwarded-proto") ?? "https"}://${hdrs.get("x-forwarded-host") ?? hdrs.get("host")}`;
  const ai = aiAvailable();
  return (
    <>
      <PageHeader title="Configuración" description="Datos de la empresa y estado del sistema." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Empresa" description="Razón social con la que se adjudican las órdenes" />
          <CardBody><OrgForm org={org!} editable={s.org.role === "admin"} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Criterios de rentabilidad" description="Cómo se calculan ventas netas, costos y márgenes" />
          <CardBody>
            <FinanceForm editable={s.org.role === "admin" || s.org.role === "finanzas"}
              fs={fs ?? { vat_recoverable: true, sales_include_vat: true, default_vat_rate: "21", min_margin_pct: "15", default_allocation: "importe", collection_days: 30 }} />
          </CardBody>
        </Card>
        <Card id="gmail">
          <CardHeader title="Conexión con Gmail" description="Avisos de BAC y SIGAF + correos con organismos, solos" />
          <CardBody><GmailConnect status={tok} admin={s.org.role === "admin"} appUrl={appUrl} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Espacio usado" description="Base de datos y archivos" />
          <CardBody><StorageUsage u={usage as never} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Importador BAC" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <Row label="PDF con texto" value="Activo" ok />
            <Row label="Capturas y fotos (OCR propio)" value="Activo" ok />
            <Row label="Doble verificación con IA" value={ai ? `Activa · ${env.anthropicModel}` : "Opcional (ANTHROPIC_API_KEY)"} ok={ai} />
            <Row label="Almacenamiento" value="Privado · URLs firmadas" ok />
            <Row label="Zona horaria" value="America/Argentina/Buenos_Aires" ok />
            <Row label="Moneda principal" value="ARS (sin mezclar monedas)" ok />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="flex items-center gap-2 text-right"><span className={`size-2 rounded-full ${ok ? "bg-accent" : "bg-warn"}`} />{value}</span>
    </div>
  );
}
