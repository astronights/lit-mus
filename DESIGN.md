# Design Doc: Literature Quiz Reference App

**Status:** Built — Phase 1 implemented in this repo
**Last updated:** August 2026

> This is the design doc as agreed, updated to match what was actually built. Where the
> implementation departs from the original plan, the change is called out inline and the
> reasoning given; [Section 11](#11-implementation-notes) collects them in one place.

---

## 1. Problem & Goal

There's no single tool that gives broad, quiz-ready coverage of literature spanning classics
(*Black Beauty*) to contemporary world literature (*Half of a Yellow Sun*, *The Seven Moons of
Maali Almeida*). Existing sites (SuperSummary, CliffsNotes, Goodreads Trivia) are either
paywalled, Western-canon-heavy, or not built for quick lookup.

**Goal:** Build a personal app that, given a book title, returns:

- Title, author, year, cover
- A plot blurb (a few sentences, not a full chapter-by-chapter breakdown)
- Key character names
- "Quiz-worthy" facts (memorable details, prizes, structural quirks)

**Non-goals (for now):** full chapter summaries, social/sharing features between users,
leaderboards, native mobile app (installable PWA instead), public open signup.

---

## 2. Users & Core Use Case

You plus friends and family — a small, known group, all signed in with email + password.

Primary flow:

1. Browse by category or search for a book
2. Read the card: title/author/cover, plot blurb, key characters, 3 questions
3. Drill: books served as cards (riddle → details), self-marked, scheduled by Leitner box
4. Check Progress: coverage per category, box distribution, what's due

All four are in the MVP. Drill in particular is not deferrable — it's the only screen where the
title-riddle question type works at all (see Section 5b).

---

## 3. Data Sources & Pipeline

| Source | Provides | Access | Notes |
|---|---|---|---|
| Open Library | Title, author, year, ISBN, cover image | Free REST API, no key | Also offers bulk data dumps |
| Wikipedia (MediaWiki API) | Plot text | Free REST API, no key | Pull the "Plot" section specifically via `explaintext`, not the whole article |
| Wikidata | Structured character list (`characters`, P674) | Free SPARQL + entity API | Good coverage for classics/prizewinners, patchy for obscure titles |
| Gemini Flash (free tier) | 3 generated quiz questions per book | Free API tier, needs key | Prompted with the Wikipedia plot text + Wikidata character list as grounding context |

**Two distinct phases — worth keeping straight:**

```
SEED TIME (bulk, re-runnable — see Section 4a)
  Wikidata SPARQL / list sources → title, author, wikidata_id, categories
  Nothing else. hydrated_at = null.

FIRST VISIT to a given book (lazy, once per book, then permanent)
  1. Check Neon: hydrated_at null? → proceed. Otherwise serve from DB, done.
  2. In parallel (Promise.all):
       - Open Library → cover, ISBN, publish year
       - Wikidata P674 → character list, and the enwiki article title
  3. Then Wikipedia → Plot section (fallback: article lead)
       (character list empty? → fall back to proper nouns from the plot text)
  4. Write to Neon, set hydrated_at. Return to client immediately.
  5. Background: Gemini Flash with plot + characters as context
       → 1 title_riddle + 2 detail questions, validated (Section 5a)
       → write to Neon, set questions_generated_at

EVERY SUBSEQUENT VISIT
  Pure DB read. No external calls, ever again.
```

> **Changed: the three fetches are not all parallel.** The Wikipedia article title comes from
> Wikidata's `enwiki` sitelink, so Wikipedia has to wait for Wikidata. Open Library and
> Wikidata go out together, then Wikipedia. Worst case — no sitelink, so we fall back to a
> Wikipedia search — is three sequential round trips, each with a 6s timeout, which still
> leaves headroom under the 10s Hobby limit. Guessing the article title to save a round trip
> would mis-resolve exactly the ambiguous titles that need it most.

This is a **lazy hydrate-and-cache** model. External APIs are hit exactly once per book, on the
first time you open it — never on seed, never on repeat visits. Books you seed but never look
at cost one row and zero API calls.

**Partial failure is fine; total failure is not.** Each source is optional — a book with a
cover and no plot still renders, and it's marked hydrated anyway, because a thin Wikipedia
article is a permanent fact about the book and re-fetching it every visit would just re-fail
slowly. But if *every* source fails, nothing is written and `hydrated_at` stays null: that's
almost always a network blip, and permanently caching an empty book because of one is the worst
possible outcome for a cache that is never invalidated. The route returns 503 and the next
visit retries.

---

## 4. Data Model

Implemented in `src/db/schema.ts`; the generated SQL is in `drizzle/`.

```
Book
  id, title, author, first_publish_year, cover_url
  open_library_id, wikidata_id (unique)
  wikipedia_title        (resolved at hydration; also drives the attribution link)
  characters             text[] -- key character names, from Wikidata P674 or
                         -- proper nouns in the plot text
  hydrated_at            (null until first visit — this is the cache-miss check)
  questions_generated_at (null until the Gemini job completes)

PlotBlurb
  book_id (PK/FK)
  short_blurb            (2-4 sentences, sentence-aware trim of the extract)
  source_extract         (raw Wikipedia text — kept for regeneration AND answer validation)
  source_url             (the article, for CC BY-SA attribution)

QuizQuestion
  book_id (FK)
  type                   enum: title_riddle / detail
  question_text, answer
  generated_by           (Gemini model string)
  prompt_version         (from prompts/question-generation.md)
  reported               boolean — user-flagged as bad (Phase 2 UI)

Category
  id, slug (unique), name, type (award/list/region/genre), seed_source

BookCategory             (join table)
  book_id, category_id   UNIQUE (book_id, category_id)

DrillResult              (per-question historical log)
  user_id, question_id, book_id, outcome (got_it/missed), answered_at
  — skips are NOT recorded, neutral by design

BookDrillState           (per-book scheduling — the card is the book)
  user_id, book_id       UNIQUE (user_id, book_id)
  box 1-5, due_at, last_drilled_at
  clean_passes           running count of 3/3 sessions
  attempts               running count of counted sessions
  manually_retired       boolean — user-chosen "stop showing me", permanent

User / Session / Account / Verification   (Better Auth; see Section 5d)
```

Scheduling state lives on the **book**, not the question, because the drill card is the book.
Per-question results are still logged in `DrillResult` for stats and for spotting a question
that's consistently missed (likely a bad generated question rather than a knowledge gap).

The join table matters: *Half of a Yellow Sun* should be findable under "Women's Prize",
"African Literature", and "1001 Books" at once. Costs nothing, and makes browsing far more
useful than a single category string.

Keeping `source_extract` separate from `short_blurb` turned out to matter more than expected:
besides being the raw text for regeneration, it is the corpus that generated answers are
checked against. Without it there is no way to catch a hallucinated answer.

Three questions per book: **one `title_riddle`** (oblique plot-hint clue where the answer is
the title itself) and **two `detail`** questions whose answers are proper nouns drawn from the
plot. The `detail` answers being constrained to proper nouns is what makes them auto-checkable
against the plot text and character list.

> **Added since the draft:** `attempts` (the "consistently missed" list needs a denominator),
> `wikipedia_title` and `source_url` (attribution), and `Category.slug` (readable URLs —
> `/browse/booker` rather than `/browse/3`).

> **Removed since the draft: the `Character` table and `QuizQuestion.pending_review`.**
>
> `Character` was a table with a serial key, a foreign key, an index, a unique constraint and a
> `role` column that was never once set to anything but null — Wikidata supplies no role, and
> guessing one from the plot would be inventing information. Nothing queried characters
> independently; both consumers (the "Key characters" chips and the riddle leak check) want a
> plain list of strings for one book. It is now `books.characters text[]`.
>
> It lives on `books` rather than `plot_blurbs` because a book can have Wikidata characters and
> no Wikipedia article at all, and `plot_blurbs` rows only exist when there is article text.
>
> `pending_review` went with the validation change above: nothing set it any more, and a column
> no code writes is how a schema starts to rot.

---

## 4a. Seed Strategy — Which Books

Seeding is **cheap**: it writes only title/author/Wikidata ID/categories. No plot text, no
characters, no Gemini call. So the seed list can be generous — an unopened book costs one DB
row.

**Phase 1 sources** (`src/lib/seed-sources.ts`):

| Source | Kind | Approx. titles | Why |
|---|---|---|---|
| Widely Translated Classics | SPARQL | ~1,000–2,000 | Solves the canon problem — see below |
| 1001 Books You Must Read Before You Die | file | ~1,300 (sample: 42) | Deliberately international, 18th c. to contemporary |
| Nobel laureates' notable works | SPARQL | ~250 | Most-quizzed literary prize |
| Booker Prize (winners + shortlist) | SPARQL | ~350 | Extremely quiz-dense |
| Pulitzer Prize for Fiction | SPARQL | ~95 | Heavily quizzed in US-leaning sets |
| International Booker | SPARQL | ~20 | Small but high-value for world-literature coverage |

> **Changed: 1001 Books is file-driven, and a SPARQL canon source was added.** Wikidata does
> not model the 1001 Books list, and the list itself is a copyrighted editorial selection, so
> there is nothing clean to query or scrape. It reads `data/1001-books.tsv`
> (`title<TAB>author`); a 42-title sample ships in the repo so the source works out of the box.
>
> That left the canon problem half-solved, so **Widely Translated Classics** was added:
> literary works with Wikipedia articles in 25+ languages. Sitelink count is a decent proxy for
> "famous enough to be quizzed", it finds *Black Beauty* where prize queries never would, and
> it skews far less Anglophone than any curated English list. It is also the heaviest query by
> far — raise the threshold if the endpoint times out.

> **Changed: prizes are resolved by English label, not QID.** `?prize rdfs:label "Booker
> Prize"@en` instead of `wd:Q157811`. A hard-coded QID is unverifiable by eye and silently
> wrong if mistyped; a label is readable in review, and a renamed prize shows up as a zero-row
> source in `npm run check:sources` rather than as a category that quietly never appears.
>
> **These queries have not been run against the live endpoint** — the build environment blocks
> Wikidata. `npm run check:sources` dry-runs every source and needs no database; run it before
> the first real seed.

Dedupe on `wikidata_id`; overlap will be heavy and that's fine — each source just adds its
category tag to the existing row.

**Phase 2 sources** are already written and sitting behind `enabled: false`: Women's Prize,
National Book Award, Prix Goncourt, Premio Cervantes, Akutagawa, Caine, JCB, DSC. Phase 2 is
literally flipping the flag and re-running.

**The seed job is idempotent and re-runnable.**

```
for each source in ENABLED_SOURCES:
    rows = dedupe(fetch(source))
    upsert Category on slug
    insert Books ... ON CONFLICT (wikidata_id) DO NOTHING   # existing rows untouched
    insert BookCategory ... ON CONFLICT DO NOTHING          # just adds the tag
```

Existing books are left *completely* alone on conflict, not merged: a hydrated book's author
and year came from Open Library and are better than anything the seed knows.

Batched at 200 rows per statement. The Neon HTTP driver makes every statement a round trip, so
a per-book loop over 2,000 titles would be thousands of them — this is the one place in the app
where batching matters.

Run it as `npm run seed` or as a Vercel Cron job hitting `POST /api/cron/seed` (guarded by
`CRON_SECRET`) — it's not in the request path either way.

---

## 5. Architecture

At this scale, pre-fetching everything up front doesn't make sense — most of a large candidate
list will never actually get opened. Instead: **seed cheap, fetch on demand, cache forever.**

```
                     ┌─────────────────────────────┐
                     │   Bulk seed (script or cron) │
                     │  Wikidata SPARQL + TSV lists │
                     │  → title, author, IDs only   │
                     └───────────────┬──────────────┘
                                     ↓
                          [ Neon Postgres ]
                        Book (metadata + status)
                        PlotBlurb / Character / QuizQuestion
                        (empty until first lookup)
                                     ↑↓
                     ┌───────────────┴──────────────┐
                     │  Vercel serverless functions │
                     │  (Next.js API routes)        │
                     │  - GET /api/books?search=    │
                     │  - GET /api/books/:id        │
                     │      → if not cached: fetch  │
                     │        Open Library+Wikidata,│
                     │        then Wikipedia; write │
                     │  - POST /api/books/:id/      │
                     │        questions → Gemini,   │
                     │        validated, throttled  │
                     └───────────────┬──────────────┘
                                     ↓
                     ┌───────────────┴──────────────┐
                     │  Next.js frontend (Vercel)   │
                     │  mobile-first / installable  │
                     └──────────────────────────────┘
```

**Chosen stack:**

- **Frontend + backend**: Next.js (App Router) on Vercel — API routes double as the backend.
- **DB**: Neon Postgres via the serverless HTTP driver, so there's no pool to keep warm across
  invocations. A `localhost` URL transparently switches to `node-postgres`, so the whole app
  runs locally without a Neon account.
- **ORM**: **Drizzle** (decided). Lighter-weight, and its schema file doubles as readable
  documentation of the data model.
- **Mobile**: responsive design plus a Web App Manifest, installable to the home screen.

**One practical constraint**: Vercel's serverless functions have execution time limits (10s on
Hobby). Hydration declares `maxDuration = 30` and each external fetch has a 6s timeout, so a
slow source degrades to "missing" rather than to a timed-out request.

---

## 5a. Question Generation (Gemini Flash)

**Model**: Gemini Flash on the free tier — question generation is a small, well-constrained
task that doesn't need a frontier model.

**Prompt design.** The model gets the title, author, character list, and the Wikipedia article
text, and is asked for strict JSON only.

> **Changed (prompt 2026-08-07.2): the model now uses its own knowledge as well.** The original
> rule — every `detail` answer must appear verbatim in the fetched text — was safe and produced
> flat questions. The facts that make a literature question worth asking are rarely stated in a
> plot summary, and the ones that are tend to be character names.
>
> The model is now told to write from what it knows, using the article as the frame rather than
> the ceiling.
>
> What we keep from Wikipedia is **lead + "about the work" sections + plot**, stored in the
> existing `source_extract` column (no schema change; the card blurb still comes from the plot
> alone). All three come from the one extract call that already returns the whole article, so
> keeping them costs no extra request — only storage and prompt tokens.
>
> An intermediate version kept only lead + a list of section headings, on the theory that the
> model already knows the reception and legacy of these books. It does, for the canon. But the
> contemporary translated fiction this app exists to cover is exactly where its knowledge is
> thinnest, and where an unanchored answer is most likely to be confidently wrong — so the
> section bodies came back. The value is concentrated in the books that need it most.

What the two question types aim at:

- **`title_riddle`** — quizmaster register, reaching for the work's most distinctive fact:
  what the title refers to, an effect the book had on the world, a structural oddity. "Its
  sympathetic portrayal of the plight of working animals is said to have been instrumental in
  abolishing the checkrein... which 1877 work?" is the target, not "a novel narrated by a horse".
- **`detail`** — answers must be proper nouns that **exist outside the book**: Colombo, Biafra,
  the bearing rein, the Sri Lankan Civil War. Never Ginger, Jerry Barker or Macondo. An
  in-universe name is correct and worthless; it teaches nothing transferable, and it is exactly
  what a lazy question reaches for.

**Validation is now narrow, and that is the trade.** What survives is the check that can be
judged from the string itself, with no outside truth required:

- the JSON must parse (one retry on malformed output)
- the riddle must not contain the title, a distinctive title word, the author's surname, or a
  character name — such a riddle is **discarded**, not flagged, since it would spoil the one
  screen the riddle exists for
- a `detail` answer that is merely the title or the author is dropped

The verbatim-answer check is gone, and with it the automated defence against a hallucinated
answer. The "real-world, not in-universe" rule is carried by prompt instruction and few-shot
examples rather than by code. Both were considered as enforced checks — the article's outbound
links are a good mechanical proxy for "this thing exists" — and both were declined in favour of
question quality and simplicity. The backstop is now the `reported` flag and the fact that a
question is one row you can edit.

**Where it runs — not in the request path.** `/api/books/:id` returns metadata + plot +
characters immediately; the client then fires `POST /api/books/:id/questions`, and the detail
screen fills in section 5 when it lands.

**Free-tier rate limits.** Generation goes through a global throttle
(`GEMINI_MAX_REQUESTS_PER_MINUTE`, default 10) keyed in Redis, so it is shared across users and
function instances rather than per-request. Being throttled is not a failure:
`questions_generated_at` stays null and the next visit tries again. Backfilling the whole seed
list would still need the slow batch script, not a single job.

**Generation is one-shot.** Questions are written once, on first visit, and never regenerated
in the app. Two consequences built around:

- The retry-once-on-malformed-JSON step matters more, since there's no second bite.
- A transient Gemini failure deliberately leaves `questions_generated_at` null, so it isn't
  mistaken for "this book has no questions". Only "the plot text is too thin" marks it done.

### The prompt is an editable artifact

`prompts/question-generation.md`, version-controlled and diffable, with few-shot examples that
are the main lever on quality. `prompt_version` from its front matter is stamped on every
question, so `npm run backfill:questions -- --prompt-version <old>` can find and regenerate
questions written under a superseded prompt without building a user-facing regeneration
feature.

**Practical consequence: tune the prompt early.** Question quality is fixed at hydration time,
so the first few dozen books you open are the cheapest time to iterate.

---

## 5b. UI Structure

Mobile-first: **bottom tab bar**, four tabs, with Book Detail as a pushed screen.

### Tab 1 — Browse

Category list with counts and a coverage bar, then a scrollable book list per category. Books
already opened carry a dot, so coverage of a list is readable at a glance — which matters
because the same title legitimately appears in several lists.

### Tab 2 — Search

Text search over title and author across the seeded set. Fast, and every result is guaranteed
to hydrate cleanly when tapped. Already-opened books sort first: they render instantly and are
the likelier target of a repeat search.

### Tab 3 — Drill

**The drill unit is the book, not the question.** One card = one book = its 3 questions:

```
1. TITLE RIDDLE — shown bare. No cover, no title, no author.
   → Got it   → reveal title + cover, continue to detail questions
   → Missed   → reveal title + cover, continue anyway (marked missed)
   → Skip     → card parked, no result recorded, returns later this session
2. DETAIL Q1 — now that the book is identified, cover/title stay visible
3. DETAIL Q2 — same
4. CARD SUMMARY — 3/3, 2/3 etc., then next card
```

Missing the riddle still reveals the answer and continues into the details. The goal is
learning, not scoring — aborting the card on a miss would deny you the exact repetition you
need most.

**Skip drops the whole book, from any question.** No `DrillResult` is written, no box change,
no due date change: skip means "not this one, not now", which is a different thing from getting
it wrong and must not touch scheduling. It used to park the card and re-serve it later in the
same session, which just meant seeing a book you had deliberately passed on twice.

### Scheduling — why not "three times then hide forever"

**Three passes in one sitting isn't learning.** Spacing does the work, not the raw count.

**"Forever" is the wrong horizon for quiz prep.** A book retired in August is not reliably
available in December.

### Scheduling — Leitner boxes

| Box | Next due after clean pass |
|---|---|
| 1 (new / missed) | same session, then next session |
| 2 | ~2 days |
| 3 | ~5 days |
| 4 | ~2 weeks |
| 5 (mature) | ~6 weeks |

- **Clean pass** (3/3) → promote one box, schedule by the table.
- **Partial** (1–2 of 3) → stay in the current box, due next session.
- **Zero** → demote to box 1.
- **Box 5 clean pass** → stays in box 5 on a ~6-week loop. "Retired", except it still
  resurfaces — which is what you actually want before a quiz.

"Due next session" resolves to the start of tomorrow. A failed card should come back, but not
five minutes later in the same sitting, which would just be re-reading.

**Session composition** — due books first (oldest first: a book overdue by a month needs the
pass more than one that came due this morning), then a few never-drilled books, then a
low-box-weighted top-up from not-yet-due books, then more never-drilled books to fill.

> **Changed: Drill no longer depends on what you have opened in Browse.** It used to require a
> hydrated book with questions already generated, which made the study loop a hostage to
> browsing habits — you had to go and open books before you could drill them. Any seeded book
> is now eligible, and the content is fetched when its card comes up: `/api/drill/session`
> returns ids, `/api/drill/card/:bookId` does the hydration and the Gemini call for one book.
> A first-time card genuinely takes a few seconds, so the wait is shown rather than hidden.
>
> Two things exclude a book: you retired it by hand, or generation already ran and produced
> nothing. Without the second check, a book whose article is too thin to ask about would be
> re-offered, re-fetched and re-skipped forever.

A manual **"I've got this, stop showing me"** action is the one permanent retirement — chosen,
not inferred from three lucky guesses.

### Tab 4 — Progress

Box distribution with counts and intervals, coverage per category, and a "consistently missed"
list (box 1–2 after 3+ attempts, ranked by misses). A book that never sticks sometimes means a
badly generated question rather than a genuine gap.

### Book Detail (pushed screen)

Cover/title/author/year → tappable category chips → plot blurb with its Wikipedia attribution →
key characters. On first open this triggers hydration server-side, so the request takes a few
seconds; every later open is a database read.

> **Changed: the questions are not here.** They were, with answers collapsed as a self-test.
> But reading them spoils the riddle — the one question type the whole Drill screen is built
> around — so they now live only in Drill, and the API does not ship them to this screen at
> all. Question generation moved with them.

---

## 5c. Storing Drill History

**Decision: Neon, not browser storage. Per-user, behind email/password auth.**

- **Safari evicts localStorage** after ~7 days without interaction. Box 4 is a 2-week interval
  and box 5 is 6 weeks, so the browser would delete scheduling history *before the card ever
  came due*. A spaced-repetition app on iOS is close to the worst possible fit for
  localStorage, and mobile is the whole point.
- No cross-device. Clearing site data wipes months of scheduling. Cookies are worse (~4KB).

Browser storage is fine for a session token and for theme/font preferences. It's wrong for
state.

| Ungated (anyone) | Requires sign-in |
|---|---|
| Browse, Search | Drill |
| Book Detail card | Progress |

Hydrated book content isn't personal, and leaving it open means the expensive hydration is
cached and shareable.

---

## 5d. Multi-user Architecture

| Shared (global, one copy) | Per-user |
|---|---|
| `Book`, `Category`, `BookCategory` | `BookDrillState` |
| `PlotBlurb`, `Character`, `QuizQuestion` | `DrillResult` |

Everything expensive produces **shared** data, so hydration is paid once globally by whoever
opens a book first. The app gets *cheaper per user* as it grows.

### Auth — email + password

**Better Auth**, with DB-backed sessions, Drizzle + Neon, and room to add Google later without
a migration. (Auth.js's Credentials provider only supports JWT sessions, which is why it isn't
the pick.)

> **Changed: the argon2id hash lives on `account.password`, not `User.password_hash`.** That's
> Better Auth's schema: a user has many accounts, and "credential" is one of them. It is
> exactly the shape that makes adding Google a no-migration change, so it's worth adopting
> rather than fighting. Verified in practice — the stored hash reads
> `$argon2id$v=19$m=19456,t=2,p=1$…` (OWASP's second recommended profile).

**DB-backed sessions, not JWTs.** A session row can be deleted, giving real logout, "sign out
everywhere", and instant lockout. Cookie: `httpOnly`, `secure`, `sameSite=lax`, 90-day expiry
sliding on activity.

**Email as the identifier, not a username.** Even though verification isn't in scope: with a
username, password reset isn't merely unbuilt, it's *impossible*.

**Non-negotiable even at friends-and-family scale:**

- argon2id (Node runtime pinned on the auth routes — the native module won't load on Edge)
- Login rate limiting **per email and per IP**. Better Auth's built-in limiter covers per-IP;
  a before-hook adds 10 attempts per email per 15 minutes, so rotating IPs still can't grind
  one account.
- Constant-time comparison for the invite code and the cron secret.

**Deliberately skipped: password reset.** Needs an email service; a forgotten password is a
two-minute fix in Neon at this scale.

**Also skipped: email verification and self-serve signup.** Signup requires an `INVITE_CODE`
env var — one line of check, and it keeps the door shut without building an invite system.

### What multi-user newly requires

**Rate limiting** — Upstash Redis, with a per-instance in-memory fallback so a limiter outage
doesn't take the app down. Applied to login, to hydration (cache misses only — ordinary
browsing of hydrated books is unthrottled), and to question generation. This is the one item
that is not optional once the URL is public.

**A generation queue** — implemented as a global token budget on the same limiter rather than a
separate queue service. It is the same guarantee (a global ceiling on Gemini calls per minute)
with no extra infrastructure.

**Bad-question handling** — the `reported` column exists and reported questions are already
excluded from drill sessions; the button itself is Phase 2.

### Licensing

- **Wikidata is CC0** — no obligations.
- **Wikipedia text is CC BY-SA.** Each book card carries "Plot summary adapted from Wikipedia"
  linking the source article. That per-book credit sits beside the reused text and is the
  load-bearing half of the obligation; the site-wide note is supplementary and lives on
  Progress, behind a "Sources & licences" disclosure, rather than under every screen.

---

## 5e. Visual Design — Theme & Typography

> **Changed: the app looks like a shelf of hand-drawn paperbacks, not a document.** The first
> build was "clean and minimal, content-first" — a warm-brown, quiet, document-ish palette with
> Inter/Literata as the default. It was correct to the brief and dull to use, and this is a
> personal app for quizzing with friends: the register should be playful.
>
> The look now takes after a Wrong Hands cartoon — pastel blocks, heavy black outlines, hard
> offset shadows, comic lettering. Three things carry it:
>
> - **The ink line.** 2px near-black borders and *hard* shadows (`3px 3px 0`, no blur). A
>   blurred shadow reads as Material and instantly loses the drawn feel.
> - **Spine colours.** Eight pastels, assigned per book from its id (`src/lib/shelf.ts`), so a
>   category list reads as a shelf rather than a table. Derived rather than stored: it costs no
>   column, and it is stable, so a book is the same colour on every device.
> - **Comic as the default pairing** (Bangers + Shantell Sans), not Clean.
>
> Book covers are untouched — they are the one piece of real imagery in the app and they sit on
> top of the tint rather than replacing it.
>
> **Dark mode is a separate palette, not a darkened one.** The obvious approach — same hues,
> lower lightness, same chroma — produced mud: at around L 0.4, low chroma reads as olive and
> khaki whatever hue you started from, and eight distinct pastels collapsed into three browns.
> Chroma has to *rise* as lightness falls for a colour to stay recognisably itself.
>
> Two hues also had to move. Nothing near h95 survives darkening — pure yellow has no dark-mode
> form — so the cream became rust (h40) and the gold became bronze (h85, chroma pushed up so it
> reads as metal rather than dirt).
>
> The shadow is dimmed separately from the border (`--ink-shadow`). Keeping it at full ink
> brightness made every card look like it was glowing rather than casting a shadow; the border
> stays near-white so the drawn edge survives.

### Themes

Light / dark / **system (default)**, via `next-themes`, whose blocking script sets the theme
before first paint and avoids the white flash that makes a dark-mode app feel broken.

### Font pairings

Each option is a **display + body pairing** — display for titles, headings and the riddle card;
body for plot blurbs and question text.

| Theme | Display | Body |
|---|---|---|
| **Comic** (default) | Bangers | Shantell Sans |
| **Handwritten** | Chewy | Patrick Hand |
| **Clean** | Inter | Literata |

All six are SIL OFL on Google Fonts, self-hosted at build time by `next/font` — no external
requests, no layout shift, no licensing question.

- **Literata** was designed for screen reading, and plot blurbs are the only long-form prose.
- **Shantell Sans** is hand-drawn but holds up at body sizes, so the comic register carries
  into the prose instead of stopping at the headings.
- **Bangers** is the classic comic-book display face — ideal for a riddle card, unusable for
  paragraphs.

### Implementation

Fonts are exposed as `--font-display` / `--font-body` and the switcher rewrites them via a
`data-fonts` attribute on the root. Components only reference the variables. An inline
pre-paint script sets the attribute from localStorage, mirroring what `next-themes` does for
the theme and for the same reason.

**Glyph coverage.** `latin-ext` is loaded, not just `latin`, and the Settings screen renders a
live check string — *Buendía · Ngũgĩ wa Thiong'o · García Márquez · Şafak* — under each
pairing. A missing glyph substitutes silently mid-word and looks like a rendering bug.

> **Changed: the non-default pairings are `preload: false`, not fetched on selection.**
> `next/font` self-hosts everything at build time; there is no per-selection fetch hook to hang
> a lazy load off. `preload: false` is the achievable version of the same intent — the files
> exist but are not in the initial critical path, and the browser fetches them when a pairing
> is actually applied. Chewy is `latin`-only, which is what Google Fonts publishes for it.

### Preference storage

localStorage is the source of truth (it's what applies before first paint, including for
signed-out visitors), synced fire-and-forget to `User.preferences` when signed in. A lost
preference is a two-second re-pick.

---

## 6. MVP Scope (Phase 1) — status

- [x] Neon Postgres with the schema above (incl. Category / BookCategory / User / Session)
- [x] Better Auth: email + password, argon2id, DB-backed sessions, httpOnly cookie
- [x] Invite code on signup (shared env var)
- [x] Login rate limiting (per email + per IP)
- [x] Seed job: idempotent upsert on `wikidata_id`, six Phase 1 sources, eight Phase 2 sources
      written and disabled
- [x] Lazy hydration route: `GET /api/books/:id`
- [x] Rate limiting on hydration endpoints
- [x] Background Gemini Flash question generation + validation, behind a global throttle
- [x] `prompts/question-generation.md` with few-shot examples; `prompt_version` stamped
- [x] API: books, book detail, search, categories, category books, drill session/result/retire,
      progress, preferences, cron seed
- [x] Frontend: four tabs — Browse, Search, Drill, Progress
- [x] Anonymous browse/search/book-detail; sign-in required for Drill + Progress
- [x] Leitner box scheduling + session composition
- [x] Book Detail screen (questions deliberately excluded — see Section 5b)
- [x] Wikipedia CC BY-SA attribution on book cards + licence note on Progress
- [x] Mobile-first responsive layout + Web App Manifest
- [x] Light / dark / system theme (system default, no-flash script)
- [x] Three font pairings via CSS variables, `latin-ext` subset
- [x] Preferences: `localStorage` + sync to `User.preferences`
- [ ] **Verify the SPARQL queries against the live endpoint** (`npm run check:sources`) — not
      possible from the build environment, which blocks Wikidata

## 7. Phase 2 (later)

- Additional seed sources — already written, just `enabled: false`
- Password reset flow (needs an email service — manual DB reset until then)
- "Report this question" button (the column and the filtering already exist)
- Tune box intervals based on actual hit rates, or swap Leitner for SM-2
- Target-date mode: compress intervals so everything gets a pass before a known quiz date
- Richer Progress stats
- Manual edit path for weak generated questions
- Google as a second auth provider

---

## 8. Decisions

1. **Scale**: 1,000+ books, open-ended — lazy fetch-and-cache rather than bulk pre-ingestion.
2. **Frontend**: Next.js on Vercel, not a Claude artifact — live server-side calls to three
   external APIs go beyond what an artifact can do.
3. **Where it runs**: Vercel + Neon, mobile-first.
4. **Quiz content**: 3 auto-generated questions per book (1 title riddle + 2 proper-noun detail
   questions) via Gemini Flash, grounded in the fetched plot text and validated before display.
5. **Regeneration**: none in the app. Questions are generated once and are permanent. The
   maintenance script is the escape hatch.
6. **Categories**: many-to-many via a join table.
7. **Seed list**: widely-translated canon + 1001 Books (file) + Nobel + Booker + Pulitzer +
   International Booker for Phase 1; the job is idempotent so Phase 2 sources just get enabled.
8. **History storage**: drill state in Neon, per-user. Book content stays ungated and shared.
9. **Multi-user from day one**: Better Auth, argon2id, revocable sessions, invite code.
10. **Visual design**: drawn comic shelf — pastel spine colours, ink outlines, hard shadows;
    light/dark/system; three font pairings with Comic as the default. Reversed from the
    original "clean and minimal" brief, which was accurate and dull — see Section 5e.
11. **Question display**: immediate, no review queue. The only automated gate left is that a
    riddle must not contain its own answer; detail answers rest on the prompt and the model's
    knowledge. Reversed from the original "verbatim or nothing" rule — see Section 5a.
12. **ORM**: Drizzle.

## 9. Open Questions

1. **Target date** — still open. Everything is built for open-ended study; a fixed date would
   mean compressing intervals so every book gets a pass beforehand ("target-date mode", Phase
   2). Nothing in the schema blocks it: it's a change to the interval table and the session
   composition, not to the data.
2. **Seed categories** — resolved as listed in Section 4a, with the two substitutions explained
   there. Adjusting means editing one array.

## 10. Tech Stack (as built)

- **Framework**: Next.js 15 (App Router), React 19, deployed on Vercel
- **DB**: Neon Postgres via the serverless HTTP driver; `node-postgres` fallback for localhost
- **ORM**: Drizzle + drizzle-kit
- **Question generation**: Gemini Flash, called from a background route, output validated
  against source text
- **Ingestion**: Wikidata SPARQL + TSV lists, as a script or a cron route
- **Per-book fetch**: Open Library + Wikidata in parallel, then Wikipedia
- **Auth**: Better Auth — email + password, argon2id (`@node-rs/argon2`), DB-backed sessions,
  httpOnly cookie, invite-code gate
- **Rate limiting**: Upstash Redis with an in-process fallback
- **Styling**: Tailwind v4 + CSS custom properties; `next-themes`; `next/font`
- **Mobile**: responsive UI + Web App Manifest
- **Region**: the Vercel function region must match the Neon region, set in project settings.
  Vercel defaults to `iad1` regardless of where you and your data are, and a function in
  Virginia querying a database in Singapore paid a Pacific round trip *per query* — that was
  the whole of a 1.9s book open, not the SQL. Deliberately not committed as `vercel.json`: it
  is one setting per deployment, and a checked-in region is wrong for anyone whose database
  sits elsewhere
- **Tests**: Vitest — scheduling, question validation, source parsing

---

## 11. Implementation notes

Where the build differs from the draft, and why. Each is expanded at the relevant section.

| # | Change | Why |
|---|---|---|
| 1 | Wikipedia extract requested as `exsectionformat=wiki`, not `plain` | `plain` strips the `==` markers, making headings indistinguishable from body lines. We slice on the markers and strip them ourselves. |
| 2 | Open Library + Wikidata in parallel, *then* Wikipedia | The article title comes from Wikidata's sitelink. Worst case 3 round trips, still well inside the limit. |
| 3 | Total hydration failure leaves the book a cache miss (503) | A never-invalidated cache must not permanently store an empty book because of one network blip. Partial failure still marks it hydrated. |
| 4 | argon2id hash on `account.password` | Better Auth's schema; it's what makes adding Google migration-free. |
| 5 | Detail answers are no longer verified against the source text; the model uses its own knowledge (prompt 2026-08-07.2) | Requiring a verbatim match ruled out the questions worth asking — the interesting facts are rarely in a plot summary. `pending_review` remains in the schema and is still filtered on every read path, but nothing sets it now. |
| 5c | `Character` table collapsed to `books.characters text[]`; `pending_review` dropped | A table whose only non-key column was always null, storing what is functionally `string[]`. Migration copies the names across before dropping. |
| 5b | Hydration keeps lead + section headings + plot, not just the Plot section | The lead frames the book and the heading list points at the kind of fact worth asking about. Full reception/legacy prose was tried and dropped as redundant once the model uses its own knowledge. Stored in the existing `source_extract` column — no schema change. |
| 6 | A riddle that leaks the answer is discarded, not flagged | Nothing to salvage, and it would spoil the Drill screen's core question type. |
| 7 | Category routes keyed by slug, not numeric id | `/browse/booker` is readable and survives a database rebuild. |
| 8 | Non-default font pairings use `preload: false` | `next/font` self-hosts at build; there is no per-selection fetch hook. Same intent, achievable mechanism. |
| 9 | 1001 Books is file-driven; "Widely Translated Classics" added | Wikidata doesn't model the list. The sitelink-count query is the automatable answer to the canon problem. |
| 10 | Prizes resolved by `rdfs:label`, not hard-coded QIDs | Readable in review; a rename shows up as a zero-row source instead of silence. |
| 11 | `attempts`, `pending_review`, `wikipedia_title`, `source_url`, `slug` columns added | Each is load-bearing for a feature the draft described but didn't give storage for. |
| 12 | Generation throttle is a global Redis token budget, not a queue service | Same guarantee, no extra infrastructure. |
| 13 | `node-postgres` fallback when `DATABASE_URL` is localhost | The whole app, seed job included, runs locally without a Neon account. |
| 14 | CLI scripts load `.env.local` (and tolerate UTF-16) | `dotenv` only reads `.env`, so drizzle-kit and the seed job ignored the file the README documents. Windows writes UTF-16 by default, which failed with an error pointing at the wrong thing. |
| 15 | Added `npm run check:sources` | The SPARQL is the one part that can't be unit-tested; this makes verifying it a single command. |

### What was verified, and what wasn't

**Verified end to end** against a local Postgres: the migration applies; the seed job runs and
is idempotent on a re-run; search, categories and book detail return correct data;
`pending_review` questions are excluded from the detail screen and from drill sessions; signup
rejects a wrong invite code and accepts the right one; the stored hash is argon2id with the
intended parameters; a session row is created and `Drill`/`Progress` 401 without it; a clean
pass promotes box 1→2 with a 2-day interval; a fully skipped card records nothing and moves
nothing; a retired book disappears from sessions; total hydration failure returns 503 and
leaves `hydrated_at` null. 39 unit tests cover scheduling, session composition, validation and
source parsing.

**Not verified**: anything requiring network access to Wikidata, Wikipedia, Open Library or
Gemini — all blocked from the build environment. That means the SPARQL queries, the live
hydration path and real Gemini output are unexercised. `npm run check:sources` covers the first
of those in one command; the other two are exercised by opening any book once the app is
deployed.
