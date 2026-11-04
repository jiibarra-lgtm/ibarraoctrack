import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Crear empresa" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ nueva?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { nueva } = await searchParams;
  if (s.org && !nueva) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <p className="font-mono text-xs uppercase tracking-wider text-fg-subtle">Paso 1 de 1</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tu empresa</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Los datos, documentos y usuarios quedan aislados por empresa. Vas a ser administrador y podrás sumar más razones sociales después.
        </p>
        <OnboardingForm />
      </div>
    </div>
  );
}
