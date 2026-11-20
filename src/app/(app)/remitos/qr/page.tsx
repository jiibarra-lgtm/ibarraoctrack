import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, MessageSquareWarning, QrCode } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { QR_MENU, QR_TARGETS, qrUrl } from "@/lib/qr";
import { appOrigin, loadQrSettings } from "@/lib/remito-load";
import { cn } from "@/lib/utils";
import { ClaimButtons, QrBulk, QrCodeEditor, QrSettingsForm, type QrRow } from "./qr-ui";

export const metadata: Metadata = { title: "QR de remitos" };

const VIEWS = [["codigos", "Códigos"], ["plantilla", "Plantilla"], ["avisos", "Reclamos y conformidades"]] as const;

export default async function QrPage({ searchParams }: { searchParams: Promise<{ v?: string; q?: string }> }) {
  const sp = await searchParams;
  const v = VIEWS.some(([k]) => k === sp.v) ? sp.v! : "codigos";
  const q = (sp.q ?? "").trim();
  const s = await requireOrg();
  const org = s.org.org_id;
  const canEdit = canWrite(s.org.role) || s.org.role === "logistica";
  const origin = await appOrigin();
  const [settings, { data: codes }, { data: claims }, { count: newClaims }] = await Promise.all([
    loadQrSettings(s.supabase, org),
    s.supabase.from("qr_codes").select("id, code, label, mode, target, menu, custom_url, active, scans, last_scan_at, remito_id, created_at")
      .eq("org_id", org).order("created_at", { ascending: false }).limit(500),
    v === "avisos" ? s.supabase.from("qr_claims").select("id, kind, name, contact, message, status, created_at, remito_id").eq("org_id", org).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    s.supabase.from("qr_claims").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "nuevo"),
  ]);
  type Rem = { id: string; label: string | null; recipient_name: string | null; po_number: string | null; status: string | null };
  const remIds = [...new Set([...(codes ?? []), ...((claims ?? []) as { remito_id: string | null }[])].map((x) => x.remito_id).filter(Boolean))] as string[];
  const { data: rems } = remIds.length ? await s.supabase.from("remitos_overview").select("id, label, recipient_name, po_number, status").in("id", remIds) : { data: [] };
  const remBy = new Map(((rems ?? []) as Rem[]).map((r) => [r.id, r]));
  const rows = ((codes ?? []) as unknown as (QrRow & { scans: number; last_scan_at: string | null; remito_id: string | null })[])
    .map((r) => ({ ...r, rem: r.remito_id ? remBy.get(r.remito_id) ?? null : null }))
    .filter((r) => !q || [r.code, r.label, r.rem?.label, r.rem?.recipient_name, r.rem?.po_number].some((x) => x?.toLowerCase().includes(q.toLowerCase())));
  const does = (r: QrRow) => {
    const mode = r.mode ?? settings.mode;
    if (mode === "menu") return `Menú: ${(r.menu ?? settings.menu).map((k) => QR_MENU[k].replace(/^(Ver|Descargar|Hablar por|Hacer|Confirmar que) /i, "")).join(", ")}`;
    return QR_TARGETS[r.target ?? settings.target];
  };

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/remitos" className="hover:text-fg">Remitos</Link>}
        title="QR de remitos"
        description="Cada remito sale con un QR propio. Lo que muestra al escanearlo (el remito, la OC, la factura, el remito firmado, un formulario o un menú con opciones) se cambia acá cuando quieras: el papel impreso sigue sirviendo."
      />
      <div className="mb-5 inline-flex flex-wrap rounded-full border border-card-border bg-field p-1">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={`/remitos/qr?v=${k}`} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", v === k ? "bg-surface-solid text-brand shadow-sm" : "text-fg-muted hover:text-fg")}>
            {l}{k === "avisos" && newClaims ? ` · ${newClaims}` : ""}
          </Link>
        ))}
      </div>

      {v === "plantilla" && (
        <Card>
          <CardHeader title="Plantilla de todos los QR" description="Diseño (color, logo y texto) y qué muestran por defecto. Los QR que cambiaste uno por uno mantienen lo suyo." />
          <QrSettingsForm initial={settings} sampleUrl={qrUrl(origin, rows[0]?.code ?? "EJEMPLO1")} canEdit={canEdit} />
        </Card>
      )}

      {v === "codigos" && (
        <Card className="overflow-hidden">
          <form className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <input type="hidden" name="v" value="codigos" />
            <input name="q" defaultValue={q} placeholder="Buscar por remito, OC, hospital o código" className="h-9 min-w-0 flex-1 rounded-lg border border-card-border bg-field px-3 text-sm" />
            <span className="text-xs text-fg-subtle">{rows.length} QR</span>
          </form>
          <QrBulk ids={rows.map((r) => r.id)} canEdit={canEdit} />
          {!rows.length ? (
            <EmptyState icon={<QrCode />} title="Todavía no hay QR" description="Se crean solos la primera vez que abrís o imprimís un remito." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
                  <th className="px-5 py-2.5 text-left font-medium">Remito</th><th className="px-2 text-left font-medium">Muestra</th>
                  <th className="px-2 text-right font-medium">Escaneos</th><th className="px-2 text-left font-medium">Código</th><th className="px-5 text-right font-medium" />
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const link = qrUrl(origin, r.code);
                    return (
                      <tr key={r.id} className={cn("border-b border-border last:border-0", !r.active && "opacity-50")}>
                        <td className="px-5 py-2.5">
                          {r.remito_id ? <Link href={`/remitos/${r.remito_id}`} className="font-mono font-medium hover:underline">{r.rem?.label ?? r.label}</Link> : <span className="font-medium">{r.label}</span>}
                          <p className="text-xs text-fg-subtle">{r.rem?.recipient_name}{r.rem?.po_number ? ` · OC ${r.rem.po_number}` : ""}</p>
                        </td>
                        <td className="px-2 text-xs">{r.active ? does(r) : "Desactivado"}{(r.mode || r.target || r.menu) && <span className="ml-1 rounded bg-warn-soft px-1.5 py-px text-[10px] font-semibold text-warn">propio</span>}</td>
                        <td className="px-2 text-right tabular">{r.scans}<p className="text-[11px] text-fg-subtle">{r.last_scan_at ? formatDateTime(r.last_scan_at) : "nunca"}</p></td>
                        <td className="px-2"><a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline">{r.code} <ExternalLink className="size-3" /></a></td>
                        <td className="px-5 text-right"><QrCodeEditor row={r} defaults={settings} link={link} canEdit={canEdit} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {v === "avisos" && (
        <Card className="overflow-hidden">
          {!(claims ?? []).length ? <EmptyState icon={<MessageSquareWarning />} title="Sin reclamos ni conformidades" description="Cuando alguien escanea un remito y deja un reclamo o confirma que recibió, aparece acá y te llega un aviso." /> : (
            <ul className="divide-y divide-border">
              {((claims ?? []) as unknown as { id: string; kind: string; name: string; contact: string | null; message: string | null; status: string; created_at: string; remito_id: string | null }[]).map((c) => {
                const rem = c.remito_id ? remBy.get(c.remito_id) : null;
                return (
                  <li key={c.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", c.kind === "reclamo" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>{c.kind === "reclamo" ? "Reclamo" : "Conformidad"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{c.name}{c.contact ? <span className="font-normal text-fg-muted"> · {c.contact}</span> : null}</p>
                      {c.message && <p className="mt-0.5 whitespace-pre-line text-sm text-fg-muted">{c.message}</p>}
                      <p className="mt-1 text-xs text-fg-subtle">{formatDateTime(c.created_at)} · {c.remito_id ? <Link href={`/remitos/${c.remito_id}`} className="hover:underline">Remito {rem?.label}</Link> : "—"}{rem?.po_number ? ` · OC ${rem.po_number}` : ""}{c.status !== "nuevo" ? ` · ${c.status}` : ""}</p>
                    </div>
                    <ClaimButtons id={c.id} status={c.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
