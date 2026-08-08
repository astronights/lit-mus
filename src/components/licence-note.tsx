/**
 * Site-wide licence note (Section 5d).
 *
 * Wikipedia text is CC BY-SA, so reusing plot extracts carries attribution and
 * share-alike obligations. The load-bearing half of that is the per-book credit
 * on the Book Detail card, which sits directly beside the reused text and links
 * the source article. This is the supplementary half.
 *
 * It used to run on every screen, which was a lot of small print under a
 * four-line app. It now lives on Progress only -- the one tab you visit
 * deliberately rather than in passing -- summarised to a line, with the full
 * terms behind a disclosure for anyone who wants them.
 */
export function LicenceNote() {
  return (
    <details className="mt-4 text-xs opacity-70">
      <summary className="cursor-pointer list-none underline underline-offset-4">
        Sources &amp; licences
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          Plot summaries are adapted from{" "}
          <a
            className="underline underline-offset-2"
            href="https://en.wikipedia.org"
            target="_blank"
            rel="noreferrer"
          >
            Wikipedia
          </a>{" "}
          under{" "}
          <a
            className="underline underline-offset-2"
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 4.0
          </a>
          ; the adaptations here are available under the same licence. Each book card links the
          article it came from.
        </p>
        <p>
          Covers and publication data from{" "}
          <a
            className="underline underline-offset-2"
            href="https://openlibrary.org"
            target="_blank"
            rel="noreferrer"
          >
            Open Library
          </a>
          . Structured data from{" "}
          <a
            className="underline underline-offset-2"
            href="https://www.wikidata.org"
            target="_blank"
            rel="noreferrer"
          >
            Wikidata
          </a>{" "}
          (CC0). Quiz questions are machine-generated and occasionally wrong.
        </p>
      </div>
    </details>
  );
}
