import { ExternalLink, Store } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DefaultRuleForm, ItemRule, RestockNowButton } from "./publications-ui";

type Item = { item_id: string; title: string; available: number | null; sold: number | null; price: string | null; status: string | null; logistic: string | null; permalink: string | null; thumbnail: string | null; variations: number; last_restock_at: string | null; last_restock_qty: number | null; last_error: string | null; seen_at: string };
type Rule = { item_id: string; enabled: boolean; min_qty: number; target_qty: number };

/** Publicaciones con su stock y la reposición automática ("que siempre haya 10"). */
export async function MlPublications({ sb, org, canEdit, connected }: { sb: SupabaseClient; org: string; canEdit: boolean; connected: boolean }) {
  const [{ data: it }, { data: ru }] = await Promise.all([
    sb.from("ml_items").select("*").eq("org_id", org).neq("status", "no_activa").order("title").limit(2000),
    sb.from("ml_stock_rules").select("*").eq("org_id", org),
  ]);
  const items = (it ?? []) as Item[];
  const rules = (ru ?? []) as Rule[];
  const def = rules.find((r) => r.item_id === "*");
  const toRule = (r?: Rule) => (r ? { enabled: r.enabled, min: r.min_qty, target: r.target_qty } : null);
  const byId = new Map(rules.filter((r) => r.item_id !== "*").map((r) => [r.item_id, r]));
  const lastCheck = items.reduce<string | null>((a, x) => (!a || x.seen_at > a ? x.seen_at : a), null);
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title="Stock de tus publicaciones" description={`Cuando vendés y una publicación baja del mínimo, la app la repone sola. Se revisa cada 10 minutos${lastCheck ? ` · última revisión ${formatDate(lastCheck)}` : ""}.`}
        action={canEdit && connected && <RestockNowButton />} />
      <div className="border-b border-border px-5 pb-4"><DefaultRuleForm rule={toRule(def)} disabled={!canEdit} /></div>
      {!items.length ? (
        <EmptyState icon={<Store />} title={connected ? "Todavía no se revisaron las publicaciones" : "Conectá Mercado Libre"} description={connected ? "Tocá “Revisar publicaciones ahora”." : "Configuración → Mercado Libre (con acceso offline)."} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((x) => {
            const full = x.logistic === "fulfillment";
            return (
              <li key={x.item_id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                {x.thumbnail ? <img src={x.thumbnail.replace(/^http:/, "https:")} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <div className="size-10 shrink-0 rounded-lg bg-field" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{x.title}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {x.item_id} · {formatMoney(x.price)} · {x.sold ?? 0} vendidas{x.variations ? ` · ${x.variations} variantes` : ""}{full ? " · Full (stock de ML)" : ""}{x.status !== "active" ? ` · ${x.status}` : ""}
                    {x.last_restock_at && <span className="text-accent"> · repuesta a {x.last_restock_qty} el {formatDate(x.last_restock_at)}</span>}
                    {x.last_error && <span className="text-danger"> · {x.last_error}</span>}
                  </p>
                </div>
                <div className={cn("w-16 text-right font-semibold tabular", (x.available ?? 0) === 0 && "text-danger")}>{x.variations ? "—" : x.available ?? "—"}<span className="block text-[10px] font-normal text-fg-subtle">disponible</span></div>
                <div className="w-48">{!full && canEdit ? <ItemRule id={x.item_id} rule={toRule(byId.get(x.item_id))} inherited={toRule(def)} /> : <p className="text-right text-xs text-fg-subtle">{full ? "lo maneja ML" : ""}</p>}</div>
                {x.permalink && <a href={x.permalink} target="_blank" rel="noreferrer" className="text-fg-subtle hover:text-fg"><ExternalLink className="size-4" /></a>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
