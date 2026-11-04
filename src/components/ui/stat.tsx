import Link from "next/link";
import { cn } from "@/lib/utils";

/** Indicador con ícono, número grande y descripción (estilo vidrio). */
export function Stat({ icon: Icon, label, value, sub, href, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string; href?: string; tone?: "danger" | "warn" | "accent";
}) {
  const inner = (
    <>
      <span className={cn("grid size-8 place-items-center rounded-full border border-card-border bg-field text-fg-muted shadow-xs",
        tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "accent" && "text-accent")}><Icon className="size-4" /></span>
      <p className={cn("mt-3 truncate text-xl font-semibold tracking-tight tabular sm:text-2xl", tone === "danger" && "text-danger")}>{value}</p>
      <p className="mt-0.5 truncate text-sm font-medium">{label}</p>
      {sub && <p className="truncate text-xs text-fg-subtle">{sub}</p>}
    </>
  );
  const cls = "glass block min-w-0 rounded-2xl px-4 py-4";
  return href
    ? <Link href={href} className={cn(cls, "transition-transform hover:-translate-y-0.5")}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}
