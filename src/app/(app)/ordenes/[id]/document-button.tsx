"use client";
import * as React from "react";
import { Download, FileSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDocumentUrl } from "../actions";

export function DocumentButton({ documentId, label, download = false, variant = "secondary", size = "md" }: {
  documentId: string; label?: string; download?: boolean; variant?: "secondary" | "ghost"; size?: "md" | "sm" | "icon-sm";
}) {
  const [loading, setLoading] = React.useState(false);
  const open = async () => {
    setLoading(true);
    // Abrir la ventana antes del await evita el bloqueo de popups en Safari/iOS
    const win = download ? null : window.open("about:blank", "_blank");
    const res = await getDocumentUrl(documentId, download);
    setLoading(false);
    if (!res.ok) {
      win?.close();
      toast.error(res.error);
      return;
    }
    if (download) window.location.href = res.url;
    else if (win) win.location.href = res.url;
  };
  return (
    <Button variant={variant} size={size} onClick={open} loading={loading} aria-label={label ?? (download ? "Descargar" : "Ver")}>
      {!loading && (download ? <Download /> : <FileSearch />)}
      {label}
    </Button>
  );
}
