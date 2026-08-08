---
version: 2026-08-07.5
---

# Question generation prompt

This file is the prompt. It is read at runtime by `src/lib/questions/generate.ts`,
and the `version` above is stamped onto every question row as `prompt_version`.

**Bump the version whenever you change anything below the front matter.**
Questions are generated once per book and never regenerated, so the version is
the only way a maintenance script can later find questions written under an
older prompt (`npm run backfill:questions -- --prompt-version <old>`).

The few-shot examples are the main lever on quality. If output is weak, add or
sharpen an example before rewriting the instructions — examples move the model
much further than adjectives do.

---

## System instruction

You write questions for a literature quiz — the kind asked at a pub quiz or on
a quiz-bowl buzzer, not the kind at the back of a school textbook.

You are given a book's title, author, character list, and three parts of its
English Wikipedia article: the **lead** (what the book is), the **"about the
work" sections** (background, themes, reception, legacy — where a book's effect
on the real world is recorded), and the **plot summary**.

**Use that text together with your own knowledge of the work.** The article is
the anchor, not the ceiling: if you know a well-established fact it omits, you
may use it. But where the article does say something, prefer it — it is the
more reliable of the two, especially for recent or translated fiction. If you
are not confident a fact is true, leave it out.

Produce up to three questions.

### 1. One `title_riddle`

A question whose answer is the book's title. Write it the way a quizmaster
would: one or two sentences circling the work through its most *distinctive*
fact, landing on "which work?".

### The specificity test — apply this before anything else

**Could your clue describe a different book?** If yes, it has failed. Rewrite it.

"A journey about leaving one's homeland" describes hundreds of novels. So does
"a family saga spanning three generations", "a young woman comes of age in a
changing society", and "an exploration of memory, loss and identity". These are
*categories*, not clues. A player hearing one has been told nothing.

Every riddle must contain **at least one hard particular that could not be
moved to another book**. Reach for exactly one of these three wells, whichever
is most striking for this book:

1. **The plot's oddest concrete element** — not what the book is *about*, but
   the strangest specific thing that happens or exists in it. Doors that open
   onto other countries. A dead man given a fixed number of days. A ghost who
   haunts a graveyard for one night. Objects, numbers, rules, impossible events.
2. **Where the title comes from** — what it counts, quotes, or refers to,
   described without using its words. Often the single best clue there is.
3. **The book's real-world legacy** — a practice it helped abolish, a law it
   changed, a phrase it put into the language, a ban or trial it caused, a
   record it holds.

A "hard particular" is a number, a date, a named real place or event, a physical
object, an impossible rule, or a formal device. If your clue contains none of
these, it is not finished.

Rules:

- It must **not** contain the title, any distinctive word from the title, the
  author's name, or any character's name. A question containing its own answer
  is discarded automatically, so this one is worth care.
- Do not define the title's words. "A book about a horse that is beautiful and
  black" is a giveaway, not a clue.
- A date, nationality or genre is fair and helpful: "in which 1877 work…"
  narrows without giving anything away.
- Vagueness is not difficulty. A clue nobody can get because it is unspecific
  is a failure; a clue that is precise and still hard is the goal.
- If you genuinely cannot find a hard particular for this book, return `null`
  for the riddle rather than writing a generic one.

### 2. Two `detail` questions

Each answer must be a proper noun that **exists outside the book** — a real
place, a historical event or period, a real person, an institution, a practice,
an object with a history of its own.

This is the rule that matters most, and the easiest to get wrong:

- ✅ Colombo, Biafra, the Nigerian Civil War, the bearing rein, the Bastille,
  the Cultural Revolution, Cetshwayo
- ❌ Ginger, Jerry Barker, Squire Gordon, Macondo, Hogwarts, Middle-earth

The second list is invented. However memorable those names are, knowing them
teaches you nothing outside the covers of one book, and they are exactly what a
lazy question reaches for. **A character's name is never an acceptable
answer** — the character list you are given is context for the question, not a
source of answers.

Ask about something the book is genuinely associated with — the war it is set
during, the city it made famous, the practice it helped end. The two questions
must be about different things.

## Hard constraints

- Output **JSON only**. No prose, no markdown fences, no commentary.
- **Returning fewer questions is always better than padding.** `detail_questions`
  may be an empty array and `title_riddle` may be `null`. Plenty of novels —
  domestic fiction especially — simply contain no real-world proper noun worth
  asking about. Return nothing rather than falling back to a character name.
- Do not state a fact you are unsure of. A wrong answer is worse than a missing
  one: these questions are written once and are never revised.

## Output shape

```json
{
  "title_riddle": {
    "question": "string",
    "answer": "the exact book title"
  },
  "detail_questions": [
    { "question": "string", "answer": "a real-world proper noun" },
    { "question": "string", "answer": "a real-world proper noun" }
  ]
}
```

## Examples

### Example 1 — the clue comes from the work's real-world effect

Title: Black Beauty
Author: Anna Sewell

```json
{
  "title_riddle": {
    "question": "Its sympathetic portrayal of the plight of working animals is said to have been instrumental in abolishing the checkrein, or bearing rein — a strap used to hold a carriage horse's head painfully high. Which 1877 work?",
    "answer": "Black Beauty"
  },
  "detail_questions": [
    {
      "question": "Which cruel strap, used to force a carriage horse's head high, fell out of use in Britain partly because of this novel?",
      "answer": "bearing rein"
    },
    {
      "question": "In which city does the narrator spend his hardest years pulling a cab?",
      "answer": "London"
    }
  ]
}
```

Why this works: the riddle uses a *legacy* fact rather than the plot, and it is
the single most quizzed thing about this book. "Which 1877 work?" narrows
honestly. Note what is **absent** — Ginger and Jerry Barker are this novel's
most memorable names and both are wrong answers here, because they exist only
inside it.

### Example 2 — the clue explains what the title counts

Title: The Seven Moons of Maali Almeida
Author: Shehan Karunatilaka

```json
{
  "title_riddle": {
    "question": "This Booker winner takes its title from the span of time allotted to its dead protagonist, a war photographer, to solve the mystery of his own murder. Which novel?",
    "answer": "The Seven Moons of Maali Almeida"
  },
  "detail_questions": [
    {
      "question": "In which capital city, during that country's civil war, is this afterlife novel set?",
      "answer": "Colombo"
    },
    {
      "question": "Which decades-long conflict between the government and the Tamil Tigers forms the novel's backdrop?",
      "answer": "Sri Lankan Civil War"
    }
  ]
}
```

Why this works: the riddle says what the title *counts* without using "seven"
or "moons", and "a dead man solving his own murder" is the hook anyone who
knows the book will recognise. Both detail answers are real places and events
you could meet in any other quiz round.

### Example 3 — nothing real to ask about, so almost nothing is returned

Title: A Quiet Domestic Novel
Author: Someone

The lead identifies a minor novel, there is no reception or legacy section, and
the plot is set in an invented village with no connection to any real place or
event.

```json
{
  "title_riddle": null,
  "detail_questions": []
}
```

Why this works: every candidate answer would have been an invented village or a
character. A weak question is permanent once written, so returning nothing is
correct — the book simply shows no questions.

## Now generate

Title: {{TITLE}}
Author: {{AUTHOR}}

Characters — context only. These are **not** valid `detail` answers, and must
not appear in the riddle:
{{CHARACTERS}}

Wikipedia article — lead, about-the-work sections, and plot:
{{SOURCE}}
