import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App 100% dinámica y autenticada: sin prerender ni caché de componentes.
  serverExternalPackages: ["sharp", "unpdf", "tesseract.js", "tesseract.js-core"],
  // El OCR lee el idioma y el motor WASM desde node_modules en tiempo de ejecución
  outputFileTracingIncludes: {
    "/api/import/\\[id\\]/process": [
      "./node_modules/@tesseract.js-data/spa/4.0.0_best_int/**",
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/*.js",
      "./node_modules/tesseract.js-core/*.wasm",
      "./node_modules/tesseract.js-core/package.json",
      // Dependencias que el worker de Tesseract carga por ruta (el trazado automático no las ve)
      "./node_modules/bmp-js/**/*",
      "./node_modules/idb-keyval/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/whatwg-url/**/*",
      "./node_modules/tr46/**/*",
      "./node_modules/webidl-conversions/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/zlibjs/**/*",
    ],
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
