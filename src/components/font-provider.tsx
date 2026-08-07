"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  DEFAULT_PAIRING,
  FONT_STORAGE_KEY,
  isFontPairing,
  type FontPairing,
} from "@/lib/preferences";

type FontContextValue = {
  pairing: FontPairing;
  setPairing: (pairing: FontPairing) => void;
};

const FontContext = createContext<FontContextValue>({
  pairing: DEFAULT_PAIRING,
  setPairing: () => {},
});

/**
 * Font pairing state.
 *
 * localStorage is the source of truth (it is what the pre-paint script reads),
 * and the choice is mirrored to `User.preferences` when signed in so a second
 * device picks it up. The sync is fire-and-forget: a failed write costs a
 * re-pick, not data.
 */
export function FontProvider({ children }: { children: React.ReactNode }) {
  const [pairing, setPairingState] = useState<FontPairing>(DEFAULT_PAIRING);

  useEffect(() => {
    const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
    if (isFontPairing(stored)) {
      setPairingState(stored);
      return;
    }

    // Signed in on a new device with nothing stored locally: adopt the
    // server-side preference if there is one.
    let cancelled = false;
    fetch("/api/preferences")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { preferences?: { fontPairing?: string } } | null) => {
        const remote = data?.preferences?.fontPairing;
        if (!cancelled && isFontPairing(remote)) applyPairing(remote, setPairingState, false);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const setPairing = useCallback((next: FontPairing) => {
    applyPairing(next, setPairingState, true);
  }, []);

  return <FontContext.Provider value={{ pairing, setPairing }}>{children}</FontContext.Provider>;
}

function applyPairing(
  pairing: FontPairing,
  setState: (pairing: FontPairing) => void,
  sync: boolean,
) {
  setState(pairing);
  document.documentElement.setAttribute("data-fonts", pairing);
  try {
    window.localStorage.setItem(FONT_STORAGE_KEY, pairing);
  } catch {
    // Private mode or a full quota. The attribute is already set; nothing else
    // to do, and the preference simply won't survive a reload.
  }

  if (sync) {
    fetch("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fontPairing: pairing }),
    }).catch(() => {});
  }
}

export function useFontPairing(): FontContextValue {
  return useContext(FontContext);
}
