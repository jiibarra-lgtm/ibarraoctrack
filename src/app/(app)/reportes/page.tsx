import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { REPORTS } from "@/lib/reports";
import { ReportList } from "./report-list";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage() {
  await requireOrg();
  const list = Object.entries(REPORTS).map(([key, d]) => ({ key, label: d.label, description: d.description }));
  return (
    <>
      <PageHeader title="Reportes" description="Descargá tus datos para Excel. Se abren con doble clic, con acentos y decimales correctos." />
      <ReportList reports={list} />
    </>
  );
}
