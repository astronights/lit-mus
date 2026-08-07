# lit-mus

Quiz-ready reference for books, from *Black Beauty* to *The Seven Moons of Maali Almeida*.

Given a title, it gives you the cover, a short plot blurb, the key characters, and three
generated questions — one oblique title riddle and two proper-noun detail questions. Then it
drills you on them with Leitner-box spacing.

The full design rationale is in [`DESIGN.md`](./DESIGN.md). This file is how to run it.

## Stack

Next.js (App Router) on Vercel · Neon Postgres via the serverless HTTP driver · Drizzle ·
Better Auth (email + password, argon2id, DB-backed sessions) · Gemini Flash for question
generation · Tailwind v4 + `next-themes` + `next/font`.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL, BETTER_AUTH_SECRET, INVITE_CODE
npm run db:push                # or: psql "$DATABASE_URL" -f drizzle/0000_*.sql
npm run check:sources          # dry-runs the seed sources; see the caveat below
npm run seed                   # ~1,500-2,000 titles, title/author/ids only
npm run dev
```

`.env.local` is read by the app *and* by the CLI scripts, with `.env` as a fallback and real
environment variables winning over both. UTF-8 and UTF-16 files both parse, so a `.env.local`
written by PowerShell's `>` redirect works — but `Set-Content -Encoding utf8` is still the
tidier way to make one on Windows:

```powershell
Set-Content -Path .env.local -Value 'DATABASE_URL="postgresql://..."' -Encoding utf8
```

`GEMINI_API_KEY` is optional to start with — without it the app works fine, books just show no
questions.

### Local Postgres instead of Neon

Point `DATABASE_URL` at `localhost` and the DB module switches to `node-postgres`
automatically (`pg` is already a devDependency). Everything else — the seed job, the API, the
drill loop — behaves identically.

```bash
DATABASE_URL="postgresql://postgres@localhost:5432/litmus" npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | the app |
| `npm test` | unit tests (scheduling, question validation, source parsing) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` / `db:push` / `db:studio` | Drizzle migrations |
| `npm run check:sources` | dry-run every seed source and report row counts |
| `npm run seed` | bulk seed; idempotent, safe to re-run |
| `npm run backfill:questions` | regenerate questions written under an old prompt |

## Tuning the prompt

`prompts/question-generation.md` is the whole thing — instructions and few-shot examples. It is
read at runtime and **not cached in development**, so an edit takes effect on the next
generation with no restart.

The examples move output far more than the instructions do. If questions come back flat, add or
sharpen an example rather than adding adjectives.

When you are happy with a change:

1. **Bump `version`** in the front matter. It is stamped on each question as `prompt_version`.
2. Regenerate the books already opened under the old prompt:

   ```bash
   npm run backfill:questions -- --prompt-version 2026-08-07.2 --rehydrate --limit 20
   ```

   `--rehydrate` re-fetches the Wikipedia article first; needed only when the *stored text*
   changes shape, not for ordinary prompt edits. Add `--dry-run` to see what would be touched.

Iterating on one book is quickest against a local Postgres: open it, read the questions, edit
the prompt, then backfill just that book.

## How a book gets its content

Seeding writes **title, author, Wikidata id and categories — nothing else**. Everything
expensive happens the first time someone opens a book:

1. `GET /api/books/:id` sees `hydrated_at IS NULL`
2. fetches Open Library + Wikidata in parallel, then the Wikipedia plot section
3. writes it all to Neon, sets `hydrated_at`, returns immediately
4. the client fires `POST /api/books/:id/questions`, which runs Gemini in the background

Every later visit, by anyone, is a pure DB read. Hydration is paid **once globally**, so the
app gets cheaper per user as more people use it.

### Seeding is generous on purpose

An unopened book costs one row and zero API calls, so the seed list can be wide. Re-running is
safe: books upsert on `wikidata_id`, and a book found by two sources just gains a category tag.
Phase 2 is `enabled: true` on a source in `src/lib/seed-sources.ts` plus a re-run.

> **Verify the SPARQL before the first real seed.** The prize queries resolve prizes by English
> label (`?prize rdfs:label "Booker Prize"@en`), which is readable but breaks silently if a
> prize gets renamed on Wikidata. `npm run check:sources` reports a zero-row source in seconds;
> these queries have not been run against the live endpoint yet.

The **1001 Books** source is file-driven (`data/1001-books.tsv`, `title<TAB>author`) because
Wikidata does not model that list. A 42-title sample ships as `data/1001-books.sample.tsv` and
is used automatically until you drop in the real file, so a fresh clone seeds something.
The **widely-translated** source is the automatable stand-in for the canon problem: literary
works with articles in 25+ languages, which finds *Black Beauty* where prize queries never
would.

## Question generation

The prompt lives in [`prompts/question-generation.md`](./prompts/question-generation.md) — a
version-controlled artifact, not a string in the code. Its few-shot examples are the main lever
on quality.

Generation is **one-shot**: questions are written once per book and never regenerated in the
app. Two consequences worth knowing:

- **Tune the prompt early.** The first few dozen books you open are the cheapest time to
  iterate, because everything already opened keeps its questions permanently.
- **Bump `version` in the front matter** whenever you edit the prompt. It is stamped on every
  question as `prompt_version`, which is what lets `npm run backfill:questions` find and
  regenerate old-prompt questions later.

### What the questions aim at

The riddle is written in quizmaster register and reaches for the work's *most distinctive*
fact, which is usually not its plot — the abolition of the checkrein for *Black Beauty*, what
the title counts for *Maali Almeida*. That is why hydration keeps the whole article (lead,
background, themes, reception, legacy) and not just the Plot section: a legacy fact appears in
no plot summary.

Detail answers must be proper nouns that **exist outside the book** — Colombo, Biafra, the
bearing rein — never characters or invented places. Knowing that Black Beauty's stablemate is
called Ginger teaches you nothing beyond that one novel.

### What is and isn't checked

The model writes from the article text **and its own knowledge**, so detail answers are not
verified against the source. One thing is still enforced mechanically, because it can be judged
from the string alone: a riddle containing the title, a distinctive title word, the author's
surname, or a character name is discarded outright — a question containing its own answer would
spoil the only screen the riddle exists for.

Everything else rides on the prompt. That is a deliberate trade: grounding every answer in the
fetched text ruled out most of the questions worth asking. The cost is that a confidently wrong
answer can be stored, and since generation is one-shot it stays. If you spot one, edit the row
directly or re-run `npm run backfill:questions`.

## Deploying

Vercel + Neon. Set the env vars from `.env.example` in the project settings. Auth routes are
pinned to the Node runtime — argon2 is a native module and will not load on Edge.

Set `UPSTASH_REDIS_REST_URL` / `..._TOKEN` before the URL is public. Without them the rate
limiter falls back to per-instance counters, which is fine locally and weak in production,
where the login endpoint and the hydration endpoints are both worth protecting.

To run the seed on a schedule, add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/seed", "schedule": "0 4 * * 1" }] }
```

and set `CRON_SECRET`. Prefer one source per invocation (`/api/cron/seed?sources=booker`) —
the whole seed can outrun even a Pro function's time limit.

## Licensing

Wikidata is CC0. **Wikipedia text is CC BY-SA**, so plot extracts carry attribution and
share-alike obligations once anyone but you can see them: each book card links its source
article, and the footer carries the site-wide licence note.
