import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ibarra OC Track",
    short_name: "OC Track",
    description: "Órdenes de compra públicas: entregas, costos, cobros y avisos de BAC.",
    lang: "es-AR",
    dir: "ltr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0f2f40",
    theme_color: "#2f6d88",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Importar OC", short_name: "Importar", url: "/ordenes/importar", icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }] },
      { name: "Órdenes BAC", short_name: "BAC", url: "/bac", icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }] },
      { name: "Correos", url: "/correos", icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }] },
      { name: "Alertas", url: "/alertas", icons: [{ src: "/icons/shortcut-96.png", sizes: "96x96" }] },
    ],
  };
}
