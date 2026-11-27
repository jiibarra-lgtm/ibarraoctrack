"use client";
import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";

const KEY = "ml-menu";

/** Botón para esconder o mostrar el menú lateral en Mercado Libre (por defecto escondido: pantalla completa). */
export function WideToggle() {
  const [hidden, setHidden] = React.useState(true);
  React.useEffect(() => {
    let v = "hidden";
    try { v = localStorage.getItem(KEY) ?? "hidden"; } catch { /* sin almacenamiento */ }
    document.documentElement.dataset.mlMenu = v;
    const t = window.setTimeout(() => setHidden(v === "hidden"), 0);
    return () => { window.clearTimeout(t); delete document.documentElement.dataset.mlMenu; };
  }, []);
  const toggle = () => {
    const v = hidden ? "shown" : "hidden";
    try { localStorage.setItem(KEY, v); } catch { /* sin almacenamiento */ }
    document.documentElement.dataset.mlMenu = v;
    setHidden(!hidden);
  };
  return (
    <button type="button" onClick={toggle} title={hidden ? "Mostrar el menú" : "Pantalla completa"}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-fg-muted hover:text-fg lg:flex">
      {hidden ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      {hidden ? "Mostrar menú" : "Pantalla completa"}
    </button>
  );
}
