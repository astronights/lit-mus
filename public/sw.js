/*
 * Service worker.
 *
 * It exists for two reasons, and neither is offline support: Chrome and Edge
 * will not offer "Install app" without a registered worker that has a `fetch`
 * handler, and a standalone window that hits airplane mode should say something
 * better than the browser's dinosaur.
 *
 * What it deliberately does NOT do is cache pages or API responses. Every screen
 * in this app is a database read -- your box positions, what is due, which books
 * exist -- and a cached one is a *wrong* one, silently. A stale drill card that
 * reschedules a book you already answered is a worse failure than a spinner. So
 * only the offline page and its icon are precached, and everything else goes to
 * the network exactly as it would without a worker.
 */

const CACHE = "lit-mus-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Take over immediately. This app deploys often, and a worker waiting for
      // every tab to close would keep an old offline page around for days.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Navigations only. Everything else -- API calls, fonts, covers -- is left to
  // the browser, which handles it better than we would and without the risk of
  // serving something stale.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(OFFLINE_URL)) ?? Response.error();
    }),
  );
});
