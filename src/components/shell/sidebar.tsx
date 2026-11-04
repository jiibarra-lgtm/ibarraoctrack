"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export function Brand({ orgName }: { orgName: string }) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg">
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7h16M4 12h10M4 17h6" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold tracking-tight">OC Track</p>
        <p className="truncate text-[11px] text-fg-subtle">{orgName}</p>
      </div>
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/ordenes") return pathname === "/ordenes" || (/^\/ordenes\/(?!importar)/.test(pathname));
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="flex flex-col gap-5">
      {NAV.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{group.label}</p>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              if (item.phase) {
                return (
                  <li key={item.href}>
                    <span
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg-subtle/80"
                      title={`Disponible en la Fase ${item.phase}`}
                    >
                      <Icon className="size-4 shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="rounded border border-border px-1 text-[10px] tabular">F{item.phase}</span>
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
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      active ? "bg-surface-2 font-medium text-fg shadow-[inset_2px_0_0_var(--primary)]" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "")} />
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
