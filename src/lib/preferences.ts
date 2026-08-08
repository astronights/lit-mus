export const FONT_PAIRINGS = ["comic", "handwritten", "clean"] as const;
export type FontPairing = (typeof FONT_PAIRINGS)[number];

export const FONT_PAIRING_LABELS: Record<FontPairing, { name: string; display: string; body: string }> = {
  clean: { name: "Clean", display: "Inter", body: "Literata" },
  comic: { name: "Comic", display: "Bangers", body: "Shantell Sans" },
  handwritten: { name: "Handwritten", display: "Chewy", body: "Patrick Hand" },
};

export const FONT_STORAGE_KEY = "lit-mus.fonts";
// The app's look is the drawn comic shelf, so Comic is the default pairing;
// Clean stays available for anyone who wants to read long blurbs in a serif.
export const DEFAULT_PAIRING: FontPairing = "comic";

export function isFontPairing(value: unknown): value is FontPairing {
  return typeof value === "string" && (FONT_PAIRINGS as readonly string[]).includes(value);
}

/**
 * Inline script that sets `data-fonts` before first paint.
 *
 * Same trick next-themes uses for the theme, and for the same reason: applying
 * the pairing after hydration means every load flashes the default fonts
 * first, which reads as a bug rather than a preference.
 */
export const FONT_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(FONT_STORAGE_KEY)});
    var valid = ${JSON.stringify(FONT_PAIRINGS)};
    document.documentElement.setAttribute(
      "data-fonts",
      valid.indexOf(stored) >= 0 ? stored : ${JSON.stringify(DEFAULT_PAIRING)}
    );
  } catch (e) {
    document.documentElement.setAttribute("data-fonts", ${JSON.stringify(DEFAULT_PAIRING)});
  }
})();
`.trim();

/** A string of the awkward glyphs this app is full of, for the settings preview. */
export const GLYPH_CHECK = "Buendía · Ngũgĩ wa Thiong'o · García Márquez · Şafak";
