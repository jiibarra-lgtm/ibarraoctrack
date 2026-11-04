import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[oklch(0.18_0.03_235/0.55)] text-white backdrop-blur-sm lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-brand to-[oklch(0.55_0.12_240)]">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h10M4 17h6" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">OC Track</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Cada orden de compra, de la adjudicación al cobro.</p>
          <p className="mt-4 text-primary-fg/75">Importá la OC de BAC, controlá renglones, costos, entregas y cuánto ganás de verdad en cada operación con organismos públicos.</p>
        </div>
        <dl className="relative grid grid-cols-3 gap-6 text-sm">
          {[["BAC", "Importación automática"], ["ARS", "Cálculos exactos"], ["RLS", "Datos aislados por empresa"]].map(([k, v]) => (
            <div key={k}><dt className="font-mono text-xs text-primary-fg/60">{k}</dt><dd className="mt-1 text-primary-fg/90">{v}</dd></div>
          ))}
        </dl>
      </section>
      <section className="flex items-center justify-center px-5 py-12">
        <div className="glass w-full max-w-sm rounded-3xl p-7 sm:p-8">
          <LoginForm next={next} initialError={error} />
        </div>
      </section>
    </div>
  );
}
