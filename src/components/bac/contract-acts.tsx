import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, FilePlus2, Gavel } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActReview } from "./act-review";

type Act = { id: string; act: string; bac_number: string | null; contract_number: string | null; act_number: string | null; process_number: string | null;
  process_name: string | null; received_at: string; reviewed_at: string | null; purchase_order_id: string | null };

const ACT: Record<string, { label: string; tone: "danger" | "warn" | "info"; icon: React.ElementType; todo: string }> = {
  ampliacion: { label: "Ampliación aprobada", tone: "warn", icon: FilePlus2, todo: "Cargá las cantidades ampliadas en la orden y coordiná la entrega extra." },
  prorroga: { label: "Prórroga aprobada", tone: "info", icon: CalendarPlus, todo: "El contrato sigue vigente más tiempo: revisá precios y stock para el período nuevo." },
  rescision: { label: "Rescisión", tone: "danger", icon: AlertTriangle, todo: "Se rescindió el contrato: no entregues más y revisá si hay penalidad o garantía en juego." },
  penalidad: { label: "Penalidad / multa", tone: "danger", icon: Gavel, todo: "Revisá el acto: podés presentar reconsideración dentro de los 10 días." },
  disminucion: { label: "Disminución", tone: "warn", icon: FilePlus2, todo: "Bajaron las cantidades: ajustá la orden y lo que tenías comprado." },
  otro: { label: "Acto administrativo", tone: "info", icon: Gavel, todo: "Revisalo en Buenos Aires Compras." },
};
const daysAgoIso = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

/** Ampliaciones, prórrogas, rescisiones y penalidades que avisó el BAC (de una OC o todas las recientes). */
export async function ContractActs({ sb, org, bacNumber, canEdit }: { sb: SupabaseClient; org: string; bacNumber?: string | null; canEdit: boolean }) {
  let q = sb.from("bac_contract_acts_overview").select("*").eq("org_id", org);
  q = bacNumber ? q.eq("bac_number", bacNumber.toUpperCase()) : q.gte("received_at", daysAgoIso(120));
  const { data } = await q.order("received_at", { ascending: false }).limit(60);
  const acts = (data ?? []) as Act[];
  if (!acts.length) return null;
  const open = acts.filter((a) => !a.reviewed_at);
  return (
    <Card className={cn("overflow-hidden", bacNumber ? "mb-5" : "mt-5")}>
      <CardHeader title={bacNumber ? "Avisos del BAC sobre esta orden" : `Actos administrativos (${open.length} sin revisar)`}
        description="Ampliaciones, prórrogas, rescisiones y penalidades publicadas en Buenos Aires Compras" />
      <ul className="divide-y divide-border">
        {acts.map((a) => {
          const k = ACT[a.act] ?? ACT.otro, I = k.icon;
          return (
            <li key={a.id} className={cn("flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", a.reviewed_at && "opacity-60")}>
              <div className="flex min-w-0 items-start gap-3">
                <I className={cn("mt-0.5 size-4 shrink-0", k.tone === "danger" ? "text-danger" : k.tone === "warn" ? "text-warn" : "text-info")} />
                <div className="min-w-0">
                  <p className="font-medium">{k.label}{a.bac_number ? <> · {a.purchase_order_id ? <Link className="underline" href={`/ordenes/${a.purchase_order_id}`}>{a.bac_number}</Link> : a.bac_number}</> : a.contract_number ? ` · convenio ${a.contract_number}` : ""}</p>
                  <p className="text-xs text-fg-subtle">{formatDate(a.received_at)}{a.act_number ? ` · ${a.act_number}` : ""}{a.process_name ? ` · ${a.process_number ?? ""} ${a.process_name}` : ""}</p>
                  {!a.reviewed_at && <p className="mt-0.5 text-xs text-fg-muted">{k.todo}{a.bac_number && !a.purchase_order_id ? " (La orden todavía no está cargada.)" : ""}</p>}
                </div>
              </div>
              {canEdit && !a.reviewed_at && <ActReview id={a.id} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
