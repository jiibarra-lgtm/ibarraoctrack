import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { aiAvailable } from "@/lib/bac/ai";
import { env } from "@/lib/env";
import { OrgForm } from "./org-form";
import { FinanceForm } from "./finance-form";
import { GmailConnect } from "./gmail-connect";
import { StorageUsage } from "./storage-usage";
import { MlConnect, type MlStatus } from "./ml-connect";
import { ArcaConnect, type ArcaStatus } from "./arca-connect";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ml?: string; ml_error?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const [{ data: org }, { data: fs }, { data: tok }, { data: usage }] = await Promise.all([
    s.supabase.from("organizations").select("id, name, legal_name, cuit").eq("id", s.org.org_id).single(),
    s.supabase.from("financial_settings").select("*").eq("org_id", s.org.org_id).maybeSingle(),
    s.supabase.from("inbound_tokens").select("last_used_at, total_events, created_at").eq("org_id", s.org.org_id).maybeSingle(),
    s.supabase.rpc("storage_usage", { p_org: s.org.org_id }),
  ]);
  const [{ data: ml }, { data: arca }, { data: rset }] = await Promise.all([
    s.supabase.rpc("ml_conn", { p_action: "status", p_org: s.org.org_id }),
    s.supabase.rpc("arca_conn", { p_action: "status", p_org: s.org.org_id }),
    s.supabase.from("remito_settings").select("cuit").eq("org_id", s.org.org_id).maybeSingle(),
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
        <Card id="mercadolibre">
          <CardHeader title="Mercado Libre" description="Precios de compras y ventas, comisiones y operaciones, directo de tu cuenta" />
          <CardBody><MlConnect status={(ml ?? { has_app: false, connected: false }) as MlStatus} admin={s.org.role === "admin"} redirectUri={`${appUrl}/api/ml/callback`} flash={{ ok: sp.ml, error: sp.ml_error }} /></CardBody>
        </Card>
        <Card id="arca">
          <CardHeader title="ARCA (factura electrónica)" description="Certificado del web service para emitir y consultar facturas con CAE" />
          <CardBody><ArcaConnect status={(arca ?? { alias: "octrack", has_csr: false, has_cert: false }) as ArcaStatus} admin={s.org.role === "admin"} defaultCuit={rset?.cuit ?? org?.cuit ?? ""} /></CardBody>
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
