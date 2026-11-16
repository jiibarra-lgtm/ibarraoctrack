"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV, activeHref, activeItem } from "./nav";
import { ModeSwitch, useUiMode } from "./ui-mode";

export function Brand({ orgName }: { orgName: string }) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-[oklch(0.55_0.12_240)] text-white shadow-md">
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7h16M4 12h10M4 17h6" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold tracking-tight">OC Track</p>
        <p className="truncate text-[11px] text-side-muted">{orgName}</p>
      </div>
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [mode] = useUiMode();
  const current = activeItem(pathname);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => mode === "completo" || i.simple || i === current) })).filter((g) => g.items.length);

  return (
    <nav className="flex flex-1 flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-side-muted/80">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active ? "bg-brand font-medium text-brand-fg shadow-[0_6px_18px_-6px_var(--brand)]" : "text-side-muted hover:bg-white/10 hover:text-side-fg",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <ModeSwitch className="mt-auto border-t border-white/10 pt-4" />
    </nav>
  );
}

/** Pestañas de la sección actual (ej. Entregas: Pendientes · Estado por OC · Remitos). */
export function SectionTabs() {
  const pathname = usePathname();
  const [mode] = useUiMode();
  const item = activeItem(pathname);
  const best = activeHref(pathname);
  if (!item?.tabs) return null;
  const tabs = item.tabs.filter((t) => mode === "completo" || t.simple || t.href === best);
  if (tabs.length < 2) return null;
  return (
    <div className="-mt-1 mb-5 flex gap-1 overflow-x-auto border-b border-border pb-px" role="tablist" aria-label={item.label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} role="tab" aria-selected={t.href === best}
          className={cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            t.href === best ? "border-brand text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
