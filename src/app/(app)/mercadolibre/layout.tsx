import { WideToggle } from "./wide-toggle";

/** Mercado Libre usa todo el ancho de la pantalla; el menú lateral se puede esconder para ganar lugar. */
export default function MercadoLibreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-wide">
      <div className="-mt-2 mb-3 hidden justify-end lg:flex"><WideToggle /></div>
      {children}
    </div>
  );
}
