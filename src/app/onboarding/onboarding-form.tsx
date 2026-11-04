"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { createOrganization, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createOrganization, null);
  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <Field label="Nombre comercial" htmlFor="name">
        <Input id="name" name="name" placeholder="Ibarra Insumos" required />
      </Field>
      <Field label="Razón social" htmlFor="legal_name" hint="Como figura en BAC como adjudicatario">
        <Input id="legal_name" name="legal_name" placeholder="JUAN ERNESTO IBARRA" />
      </Field>
      <Field label="CUIT" htmlFor="cuit">
        <Input id="cuit" name="cuit" placeholder="20-04424052-2" inputMode="numeric" />
      </Field>
      {state?.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Button type="submit" size="lg" loading={pending}>Crear empresa</Button>
    </form>
  );
}
