"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { signIn, type AuthState } from "./actions";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, initialError ? { error: initialError } : null);

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Ingresar</h1>
      <p className="mt-1 text-sm text-fg-muted">Acceso privado. Las cuentas las crea el administrador.</p>

      <form action={action} className="mt-8 flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
        </Field>
        {state?.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
        <Button type="submit" size="lg" loading={pending}>Ingresar</Button>
      </form>
    </div>
  );
}
