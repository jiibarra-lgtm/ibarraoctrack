import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { DatabaseBackup } from "lucide-react";
import { REPORTS } from "@/lib/reports";
import { ReportList } from "./report-list";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage() {
  const s = await requireOrg();
  const canBackup = s.org.role === "admin" || s.org.role === "finanzas";
  const list = Object.entries(REPORTS).map(([key, d]) => ({ key, label: d.label, description: d.description }));
  return (
    <>
      <PageHeader title="Reportes" description="Descargá tus datos para Excel. Se abren con doble clic, con acentos y decimales correctos. La copia de seguridad completa también se guarda sola en tu Drive todos los lunes (script de Gmail)."
        actions={canBackup && <Button asChild variant="secondary"><a href="/api/backup" download><DatabaseBackup /> Copia de seguridad completa</a></Button>} />
      <ReportList reports={list} />
    </>
  );
}
