"use client";

import { useRouter } from "next/navigation";

/**
 * The only interactive part of Book Detail, so it is the only part shipped to
 * the browser as JavaScript.
 *
 * Book Detail is reached from Browse *and* from Search, so the hard-coded
 * `/search` link this replaces sent half the people who used it to the wrong
 * tab. History gets you back where you actually came from; the push to Browse
 * covers a cold arrival -- a shared link, or the PWA restoring this page --
 * where there is no history entry to pop.
 */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className="text-sm opacity-70 hover:opacity-100"
    >
      ← Back
    </button>
  );
}
