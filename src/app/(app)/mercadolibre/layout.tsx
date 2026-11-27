/** Toda la sección Mercado Libre usa el tema oscuro "Stats" (ver .ml-theme en globals.css). */
export default function MercadoLibreLayout({ children }: { children: React.ReactNode }) {
  return <div className="ml-theme">{children}</div>;
}
