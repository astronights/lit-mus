/** How many spine colours are defined in globals.css. */
export const SHELF_COLOURS = 8;

/**
 * Pick a spine colour for a book.
 *
 * Derived from the id rather than stored, so it costs no column and no
 * decision at hydration time -- and, more importantly, it is stable: a book is
 * the same colour on every screen and every device, which is what makes a
 * category list read as a shelf you can scan rather than a random gradient.
 *
 * Multiplying before the modulo spreads consecutive ids across the palette;
 * `id % 8` alone would colour a freshly seeded list in repeating stripes.
 */
export function shelfColour(id: number): number {
  return (Math.abs(Math.trunc(id)) * 5) % SHELF_COLOURS + 1;
}
