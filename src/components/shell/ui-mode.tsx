"use client";
import * as React from "react";

/** Modo simple (lo justo) o completo (todas las pantallas). Se guarda en este navegador. */
export type UiMode = "simple" | "completo";
const KEY = "oc-ui-mode";
const EVENT = "oc-ui-mode";

function read(): UiMode {
  try { return localStorage.getItem(KEY) === "simple" ? "simple" : "completo"; } catch { return "completo"; }
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
};

export function useUiMode(): [UiMode, (m: UiMode) => void] {
  const mode = React.useSyncExternalStore(subscribe, read, () => "completo" as UiMode);
  const set = React.useCallback((m: UiMode) => {
    try { localStorage.setItem(KEY, m); } catch { /* sin almacenamiento: queda en completo */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [mode, set];
}

export function ModeSwitch({ className }: { className?: string }) {
  const [mode, setMode] = useUiMode();
  return (
    <div className={className}>
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-side-muted/80">Vista</p>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1" role="radiogroup" aria-label="Modo de vista">
        {(["simple", "completo"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-colors ${mode === m ? "bg-brand text-brand-fg" : "text-side-muted hover:text-side-fg"}`}>
            {m}
          </button>
        ))}
      </div>
      <p className="mt-1.5 px-1 text-[11px] leading-snug text-side-muted">{mode === "simple" ? "Solo lo del día a día." : "Todas las secciones."}</p>
    </div>
  );
}
