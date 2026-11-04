import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="text-xl font-semibold">No encontramos esa página</h1>
      <Button asChild variant="secondary"><Link href="/dashboard">Ir al dashboard</Link></Button>
    </div>
  );
}
