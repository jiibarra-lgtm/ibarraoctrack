import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardList, Download, FileSignature, FileText, MessageCircle, TriangleAlert } from "lucide-react";
import { RemitoSheet } from "@/components/remito/remito-sheet";
import { formatMoney } from "@/lib/format";
import { invoiceLabel } from "@/lib/billing";
import { baParts } from "@/lib/remitos";
import { QR_MENU, type QrMenuKey } from "@/lib/qr";
import { anonDb, loadQrPublic, waUrl, type QrPublic } from "@/lib/qr-public";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Remito · Ibarra Insumos", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const VIEWS = ["remito", "oc", "factura", "firmado", "conformidad", "reclamo"] as const;
type View = (typeof VIEWS)[number];
const ICON: Record<QrMenuKey, typeof FileText> = { remito: FileText, oc: ClipboardList, factura: Download, firmado: FileSignature, conformidad: CheckCircle2, reclamo: TriangleAlert, whatsapp: MessageCircle };
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export default async function QrLanding({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ver?: string }> }) {
  const { code } = await params;
  const { ver } = await searchParams;
  const q = await loadQrPublic(code);
  if (!q) notFound();

  // registro del escaneo (ciudad y país aproximados, sin datos personales)
  const h = await headers();
  const city = h.get("x-vercel-ip-city"), country = h.get("x-vercel-ip-country");
  const ua = h.get("user-agent") ?? "";
  const device = /iphone|ipad/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "Otro";
  const view = VIEWS.includes(ver as View) ? (ver as View) : null;
  await anonDb().rpc("qr_scan", { p_code: code, p_choice: view, p_city: city ? decodeURIComponent(city) : null, p_country: country, p_device: device }).then(() => null, () => null);

  const wa = waUrl(q.whatsapp, `Hola, tengo una consulta sobre el remito ${q.remito?.label ?? ""}${q.remito?.po_number ? ` (OC ${q.remito.po_number})` : ""}`);
  const signed = q.remito?.signed_document_id ?? null;
  const invoices = q.invoices ?? [];

  // Un solo destino: va directo
  if (!view && q.mode === "single") {
    if (q.target === "whatsapp" && wa) redirect(wa);
    if (q.target === "url" && q.custom_url) redirect(q.custom_url);
    if (q.target === "firmado" && signed) redirect(`/r/${code}/doc/${signed}`);
    if (q.target === "factura" && invoices.length === 1 && invoices[0].document_id) redirect(`/r/${code}/doc/${invoices[0].document_id}`);
  }
  const shown: View | "menu" = view ?? (q.mode === "single" && q.target !== "whatsapp" && q.target !== "url" ? q.target : "menu");

  // Opciones del menú que tienen sentido para este remito
  const available = (k: QrMenuKey) => k === "remito" ? !!q.remito : k === "oc" ? !!q.po : k === "factura" ? invoices.length > 0 : k === "firmado" ? !!signed : k === "whatsapp" ? !!wa : true;
  const options = q.menu.filter(available);

  return (
    <div className="min-h-dvh bg-[#f4f5f2] text-[#111]" style={{ ["--qr" as string]: q.color }}>
      <header className="px-4 pb-6 pt-[max(20px,env(safe-area-inset-top))] text-white" style={{ background: q.color }}>
        <div className="mx-auto flex max-w-xl items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/remito-logo.jpg" alt="Ibarra Insumos" className="h-9 w-auto rounded" />
        </div>
        <div className="mx-auto mt-4 max-w-xl">
          <p className="text-xs uppercase tracking-wider opacity-80">{q.remito?.provisional ? "Remito provisorio" : "Remito"}</p>
          <h1 className="text-2xl font-semibold">{q.remito?.label ?? q.label ?? "Ibarra Insumos"}</h1>
          <p className="mt-1 text-sm opacity-90">
            {q.remito?.recipient.name}{q.remito ? ` · ${date(q.remito.issued_at)}` : ""}
          </p>
          {q.remito?.po_number && <p className="mt-2 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">O.C. N° {q.remito.po_number}</p>}
          {q.remito?.status === "anulado" && <p className="mt-2 inline-block rounded-full bg-red-600 px-3 py-1 text-xs font-semibold">Este remito está anulado</p>}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-5">
        {shown !== "menu" && options.length > 1 && (
          <Link href={`/r/${code}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: q.color }}><ArrowLeft className="size-4" /> Volver</Link>
        )}

        {shown === "menu" && (
          <ul className="grid gap-2.5">
            {options.map((k) => {
              const Icon = ICON[k];
              const href = k === "whatsapp" ? wa! : k === "firmado" ? `/r/${code}/doc/${signed}` : `/r/${code}?ver=${k}`;
              return (
                <li key={k}>
                  <a href={href} target={k === "whatsapp" || k === "firmado" ? "_blank" : undefined} rel="noreferrer"
                    className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-4 py-4 text-[15px] font-medium shadow-sm active:scale-[0.99]">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: q.color }}><Icon className="size-5" /></span>
                    {QR_MENU[k]}
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {shown === "remito" && q.remito && <RemitoView q={q} />}
        {shown === "oc" && <OcView q={q} />}
        {shown === "factura" && <InvoicesView q={q} code={code} />}
        {shown === "firmado" && <Box title="Remito firmado">{signed ? <a className="font-medium underline" href={`/r/${code}/doc/${signed}`}>Abrir el remito firmado</a> : "Todavía no se cargó el remito firmado."}</Box>}
        {(shown === "conformidad" || shown === "reclamo") && (
          <Box title={shown === "reclamo" ? "Hacer un reclamo" : "Confirmar que recibí"}>
            <ClaimForm code={code} kind={shown} color={q.color} />
          </Box>
        )}

        <p className="mt-8 text-center text-xs text-black/40">Ibarra Insumos · {q.remito?.issuer?.phones ?? ""}</p>
      </main>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <div className="text-sm text-black/70">{children}</div>
    </section>
  );
}

function RemitoView({ q }: { q: QrPublic }) {
  const r = q.remito!;
  const { hm } = baParts(r.issued_at);
  return (
    <>
      <Box title="Lo que se entregó">
        <ul className="divide-y divide-black/5">
          {r.items.map((i, n) => (
            <li key={n} className="flex gap-3 py-2.5">
              <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-black">{Number(i.quantity).toLocaleString("es-AR")}</span>
              <span className="min-w-0">{i.description}{i.detail ? <span className="block text-xs text-black/50">{i.detail}</span> : null}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-black/50">Emitido el {date(r.issued_at)} a las {hm} hs{r.recipient.address ? ` · ${r.recipient.address}` : ""}</p>
      </Box>
      <details className="mt-4 rounded-2xl border border-black/5 bg-white shadow-sm">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Ver el remito como papel</summary>
        <div className="overflow-x-auto px-2 pb-3">
          <div className="w-[816px] [zoom:0.42] sm:[zoom:0.7]">
            <RemitoSheet data={{ label: r.label, provisional: r.provisional, issuedAt: r.issued_at, recipient: { name: r.recipient.name, address: r.recipient.address ?? "", iva: r.recipient.iva ?? "", cuit: r.recipient.cuit ?? "" },
              items: r.items.map((i) => ({ description: i.description, quantity: String(i.quantity), detail: i.detail ?? "", unit_price: i.unit_price === null ? null : String(i.unit_price) })),
              notes: r.notes ?? "", issuer: r.issuer, poNumber: r.po_number, voided: r.status === "anulado" }} qrCaption={q.caption} />
          </div>
        </div>
      </details>
    </>
  );
}

function OcView({ q }: { q: QrPublic }) {
  if (!q.po) return <Box title="Orden de compra">Este remito no está vinculado a una orden de compra.</Box>;
  return (
    <Box title={`Orden de compra ${q.po.number}`}>
      <dl className="grid grid-cols-[110px_1fr] gap-y-2">
        <dt className="text-black/50">Organismo</dt><dd className="text-black">{q.po.customer ?? "—"}</dd>
        <dt className="text-black/50">Fecha</dt><dd className="text-black">{date(q.po.issue_date)}</dd>
        {q.po.delivery_place && <><dt className="text-black/50">Entrega en</dt><dd className="text-black">{q.po.delivery_place}</dd></>}
        <dt className="text-black/50">Facturas</dt><dd className="text-black">{q.invoices.length ? q.invoices.map(invoiceLabel).join(", ") : "Todavía sin facturar"}</dd>
      </dl>
    </Box>
  );
}

function InvoicesView({ q, code }: { q: QrPublic; code: string }) {
  if (!q.invoices.length) return <Box title="Factura">Todavía no se facturó esta orden.</Box>;
  return (
    <Box title={q.invoices.length > 1 ? "Facturas" : "Factura"}>
      <ul className="divide-y divide-black/5">
        {q.invoices.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="font-mono font-medium text-black">{invoiceLabel(i)}</p>
              <p className="text-xs text-black/50">{date(i.issue_date)} · {formatMoney(Number(i.total))}{i.cae ? ` · CAE ${i.cae}` : ""}</p>
            </div>
            {i.document_id
              ? <a href={`/r/${code}/doc/${i.document_id}`} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: q.color }}><Download className="size-3.5" /> PDF</a>
              : <span className="text-xs text-black/40">PDF no disponible</span>}
          </li>
        ))}
      </ul>
    </Box>
  );
}
