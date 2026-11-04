import { Badge } from "@/components/ui/primitives";
import { PO_STATUS_LABEL, type PoStatus } from "@/lib/po/schema";

const TONE: Record<PoStatus, "neutral" | "primary" | "accent" | "warn" | "danger" | "info"> = {
  borrador: "neutral",
  recibida: "info",
  perfeccionada: "primary",
  en_ejecucion: "warn",
  completada: "accent",
  cerrada: "accent",
  anulada: "danger",
};

export function StatusBadge({ status }: { status: PoStatus }) {
  return (
    <Badge tone={TONE[status] ?? "neutral"}>
      <span className="size-1.5 rounded-full bg-current" />
      {PO_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
