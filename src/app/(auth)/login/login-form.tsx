"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, inAction, inPending] = useActionState<AuthState, FormData>(signIn, initialError ? { error: initialError } : null);
  const [upState, upAction, upPending] = useActionState<AuthState, FormData>(signUp, null);
  const state = mode === "in" ? inState : upState;

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === "in" ? "Ingresar" : "Crear cuenta"}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {mode === "in" ? "Accedé a tus órdenes y operaciones." : "Después vas a crear tu empresa (razón social)."}
      </p>

      <form action={mode === "in" ? inAction : upAction} className="mt-8 flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        {mode === "up" && (
          <Field label="Nombre y apellido" htmlFor="fullName">
            <Input id="fullName" name="fullName" autoComplete="name" />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Contraseña" htmlFor="password" hint={mode === "up" ? "Mínimo 8 caracteres" : undefined}>
          <Input id="password" name="password" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={8} />
        </Field>
        {state?.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
        {state?.message && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{state.message}</p>}
        <Button type="submit" size="lg" loading={inPending || upPending}>{mode === "in" ? "Ingresar" : "Crear cuenta"}</Button>
      </form>

      <p className="mt-6 text-center text-sm text-fg-muted">
        {mode === "in" ? "¿No tenés cuenta?" : "¿Ya tenés cuenta?"}{" "}
        <button className="font-medium text-primary hover:underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Registrate" : "Ingresá"}
        </button>
      </p>
    </div>
  );
}
