"use client";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        title="Algo salió mal"
        description={error.digest ? `Código: ${error.digest}` : "No se pudo cargar esta pantalla."}
        action={<Button onClick={reset}>Reintentar</Button>}
      />
    </Card>
  );
}
