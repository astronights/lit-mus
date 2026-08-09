"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`.
 *
 * Renders nothing; it is a side effect that has to happen in the browser, and
 * an effect in a tiny client component is the whole of it.
 *
 * Registration is deliberately not awaited or reported: if it fails the app is
 * completely unaffected -- the worker adds an install prompt and an offline
 * page, not behaviour -- so a failure is worth a console line and nothing more.
 *
 * Development is skipped. A worker that outlives `next dev` serves an offline
 * page from a port you have since restarted, which looks like the dev server
 * being broken.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.warn("[pwa] service worker registration failed", error));
  }, []);

  return null;
}
