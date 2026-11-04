import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { aiAvailable } from "@/lib/bac/ai";
import { env } from "@/lib/env";
import { OrgForm } from "./org-form";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const s = await requireOrg();
  const { data: org } = await s.supabase.from("organizations").select("id, name, legal_name, cuit").eq("id", s.org.org_id).single();
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
          <CardHeader title="Importador BAC" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <Row label="PDF con texto" value="Activo" ok />
            <Row label="Capturas y escaneos (IA)" value={ai ? `Activo · ${env.anthropicModel}` : "Sin configurar (ANTHROPIC_API_KEY)"} ok={ai} />
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
