import Link from "next/link";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/** Aviso cuando la cuenta de ML no está conectada. */
export function NotConnected() {
  return (
    <Card>
      <EmptyState icon={<Link2 className="size-5" />} title="Mercado Libre no está conectado"
        description="Conectá la cuenta para ver publicaciones, ventas, preguntas y métricas."
        action={<Button asChild><Link href="/configuracion#mercadolibre">Conectar</Link></Button>} />
    </Card>
  );
}

/** Barra de progreso horizontal simple. */
export function Bar({ value, max = 100, tone = "brand", className }: { value: number; max?: number; tone?: "brand" | "accent" | "warn" | "danger"; className?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  const color = { brand: "bg-brand", accent: "bg-accent", warn: "bg-warn", danger: "bg-danger" }[tone];
  return <div className={cn("h-2 w-full overflow-hidden rounded-full bg-field", className)}><div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} /></div>;
}

/** Salud de la publicación (0-1 o 0-100) como badge de color. */
export function HealthBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-xs text-fg-subtle">—</span>;
  const v = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return <Badge tone={v >= 80 ? "accent" : v >= 60 ? "warn" : "danger"}>{v}</Badge>;
}

/** Mini gráfico de barras (sparkline) en SVG, sin librerías. */
export function Spark({ values, className }: { values: number[]; className?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const w = 4, gap = 2;
  return (
    <svg viewBox={`0 0 ${values.length * (w + gap)} 24`} className={cn("h-6 w-auto text-brand", className)} aria-hidden>
      {values.map((v, i) => { const h = Math.max(1, (v / max) * 24); return <rect key={i} x={i * (w + gap)} y={24 - h} width={w} height={h} rx={1} fill="currentColor" opacity={0.85} />; })}
    </svg>
  );
}

/** Gráfico de barras con etiquetas (para reportes). */
export function Bars({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[90px_1fr_110px] items-center gap-2 text-xs">
          <span className="truncate text-fg-muted">{d.label}</span>
          <div className="h-3 overflow-hidden rounded bg-field"><div className="h-full rounded bg-brand" style={{ width: `${(d.value / max) * 100}%` }} /></div>
          <span className="text-right tabular">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: d })} %`);
export const int = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("es-AR"));
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
};
