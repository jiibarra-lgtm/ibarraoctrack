import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ClipboardList, PackageSearch, Truck } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import { AddOrderButton, BoardList, NewItemButton, type BoardItem } from "./board-ui";

export const metadata: Metadata = { title: "Entregas pendientes" };

const weekAgo = () => new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

export default async function DeliveryBoardPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const edit = canWrite(s.org.role) || s.org.role === "logistica";
  const [{ data: pend }, { data: done }, { data: orders }, { data: summary }] = await Promise.all([
    s.supabase.from("delivery_board_overview").select("*").eq("org_id", org).eq("status", "pendiente").order("position").order("created_at").limit(500),
    s.supabase.from("delivery_board_overview").select("*").eq("org_id", org).eq("status", "entregado").order("delivered_on", { ascending: false }).order("position").limit(1000),
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, dependencia, issue_date, status")
      .eq("org_id", org).not("status", "in", "(anulada,cerrada,borrador,completada)").order("issue_date", { ascending: false }).limit(300),
    s.supabase.from("po_delivery_summary").select("purchase_order_id, delivered_pct, due_date, is_late").eq("org_id", org),
  ]);
  const pending = (pend ?? []) as BoardItem[];
  const delivered = (done ?? []) as BoardItem[];

  // OC con entregas pendientes que no están en la hoja de ruta
  const onBoard = new Set(pending.flatMap((i) => i.oc_refs));
  const sum = new Map((summary ?? []).map((x) => [x.purchase_order_id as string, x]));
  const missing = ((orders ?? []) as { id: string; bac_number: string | null; display_number: string | null; customer_name: string | null; dependencia: string | null; issue_date: string | null }[])
    .filter((o) => Number(sum.get(o.id)?.delivered_pct ?? 0) < 100 && !(o.bac_number && onBoard.has(o.bac_number.toUpperCase())));

  // Entregados por mes
  const months = [...new Set(delivered.map((i) => (i.delivered_on ?? "").slice(0, 7)).filter(Boolean))];
  const mes = sp.mes && months.includes(sp.mes) ? sp.mes : sp.mes === "todos" ? "todos" : months[0] ?? "todos";
  const shownDelivered = mes === "todos" ? delivered : delivered.filter((i) => i.delivered_on?.startsWith(mes));
  const since = weekAgo();
  const thisWeek = delivered.filter((i) => i.delivered_on && i.delivered_on > since).length;
  const linked = pending.filter((i) => i.orders.length).length;
  const noDoc = pending.reduce((a, i) => a + (i.missing?.length ?? 0), 0);

  return (
    <>
      <PageHeader breadcrumb={<Link href="/entregas" className="hover:text-fg">Entregas</Link>} title="Entregas pendientes"
        description="Lo que hay que llevar y lo que ya se llevó. Cada tarjeta se vincula sola con su OC por el número."
        actions={edit && <NewItemButton />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Truck} label="Pendientes de entregar" value={String(pending.length)} sub={`${linked} vinculadas · a ${noDoc} les falta el documento de la OC`} />
        <Stat icon={PackageSearch} label="OC sin entregar que faltan acá" value={String(missing.length)} tone={missing.length ? "warn" : undefined} sub="abajo las podés sumar" />
        <Stat icon={CheckCircle2} label="Entregados últimos 7 días" value={String(thisWeek)} tone="accent" />
        <Stat icon={ClipboardList} label="Entregados en total" value={String(delivered.length)} sub={delivered.length ? `desde ${formatDate(delivered[delivered.length - 1].delivered_on!)}` : undefined} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="self-start overflow-hidden">
          <CardHeader title={`Para llevar (${pending.length})`} description="Marcá «Entregado» con la fecha cuando lo lleves. Tocando la dirección se abre el mapa." />
          <BoardList items={pending} canEdit={edit} empty="No hay entregas pendientes." />
        </Card>

        <Card className="self-start overflow-hidden">
          <CardHeader title={`Ya entregados (${shownDelivered.length})`} description="Por mes de entrega" />
          <div className="flex flex-wrap gap-1.5 px-4 pb-3 sm:px-5">
            {[...months.slice(0, 8), "todos"].map((k) => (
              <Link key={k} href={`/entregas/pendientes?mes=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize", mes === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>
                {k === "todos" ? "Todos" : monthName(k)}
              </Link>
            ))}
          </div>
          <BoardList items={shownDelivered} canEdit={edit} empty="No hay entregas en este mes." />
        </Card>
      </div>

      {missing.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader title="OC cargadas que todavía no están en esta lista" description="Están cargadas en el sistema y todavía no se entregaron completas. Sumalas para no olvidarlas." />
          <ul className="divide-y divide-border">
            {missing.slice(0, 60).map((o) => {
              const x = sum.get(o.id);
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/ordenes/${o.id}?tab=entregas`} className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium">{o.bac_number ?? o.display_number}</span>
                    <span className="text-fg-subtle"> · {o.dependencia || o.customer_name}{o.issue_date ? ` · ${formatDate(o.issue_date)}` : ""}</span>
                  </Link>
                  <span className={cn("text-xs", x?.is_late ? "text-danger" : "text-fg-subtle")}>
                    {Math.round(Number(x?.delivered_pct ?? 0))}% entregado{x?.due_date ? ` · vence ${formatDate(x.due_date as string)}` : ""}
                  </span>
                  <CopyButton text={String(o.bac_number ?? o.display_number)} />
                  {edit && <AddOrderButton poId={o.id} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
