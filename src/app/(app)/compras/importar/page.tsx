import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { DocUploader } from "@/components/doc-uploader";

export const metadata: Metadata = { title: "Subir factura de proveedor" };

export default async function ImportInvoicePage() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect("/compras");
  return (
    <>
      <PageHeader breadcrumb={<Link href="/compras" className="hover:text-fg">Compras</Link>} title="Subir factura de proveedor"
        description="Leemos proveedor, número, totales y renglones, y sugerimos a qué orden corresponde cada producto. Vos confirmás." />
      <div className="max-w-2xl">
        <DocUploader orgId={s.org.org_id} kind="factura_proveedor" folder="facturas-proveedor"
          title="Arrastrá la factura o sacale una foto" hint="PDF de la factura electrónica o foto nítida del comprobante. Máximo 25 MB."
          jobHref={(id) => `/compras/importar/${id}`} />
      </div>
    </>
  );
}
