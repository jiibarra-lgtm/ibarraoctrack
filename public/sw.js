/* OC Track · service worker
 * - Archivos estáticos de la app (/_next/static, íconos): caché primero (tienen hash).
 * - Páginas: red primero; si no hay conexión, la última versión guardada o la pantalla "sin conexión".
 * - Nunca guarda datos de la API, de Supabase ni documentos privados.
 */
const VERSION = "v2";
const STATIC = `oct-static-${VERSION}`;
const PAGES = `oct-pages-${VERSION}`;
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png", "/icons/icon-512.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // Supabase, Google, etc.: directo a la red
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic" && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE))),
    );
  }
});

// Avisos (actualización de precios de los convenios, etc.)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "OC Track", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "OC Track", {
    body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
