import Link from "next/link";

/**
 * Licence note (Section 5d).
 *
 * Wikipedia text is CC BY-SA, and showing plot extracts to anyone beyond
 * yourself carries attribution and share-alike obligations. The per-book
 * credit lives on the card; this is the site-wide half.
 */
export function AppFooter() {
  return (
    <footer className="mt-10 border-t-2 border-ink py-6 text-xs leading-relaxed opacity-70">
      <p>
        Plot summaries adapted from{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://en.wikipedia.org"
          target="_blank"
          rel="noreferrer"
        >
          Wikipedia
        </a>
        , used under{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY-SA 4.0
        </a>
        ; adaptations here are available under the same licence. Book metadata and covers from{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://openlibrary.org"
          target="_blank"
          rel="noreferrer"
        >
          Open Library
        </a>
        . Structured data from{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://www.wikidata.org"
          target="_blank"
          rel="noreferrer"
        >
          Wikidata
        </a>{" "}
        (CC0). Quiz questions are machine-generated and occasionally wrong.
      </p>
      <p className="mt-3">
        <Link className="underline underline-offset-2 hover:text-foreground" href="/settings">
          Settings
        </Link>
      </p>
    </footer>
  );
}
