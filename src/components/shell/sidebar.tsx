"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

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
  // Activo = el ítem con la ruta más específica que coincide (evita marcar /analitica y /analitica/ranking a la vez)
  const all = NAV.flatMap((g) => g.items.map((i) => i.href));
  const matches = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const best = all.filter(matches).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === best;

  return (
    <nav className="flex flex-col gap-5">
      {NAV.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-side-muted/80">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              if (item.phase) {
                return (
                  <li key={item.href}>
                    <span
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-side-muted/60"
                      title={`Disponible en la Fase ${item.phase}`}
                    >
                      <Icon className="size-4 shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="rounded-full bg-white/10 px-1.5 text-[10px] tabular">F{item.phase}</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
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
    </nav>
  );
}
