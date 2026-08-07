---
version: 2026-08-07.1
---

# Question generation prompt

This file is the prompt. It is read at runtime by `src/lib/questions/generate.ts`,
and the `version` above is stamped onto every question row as `prompt_version`.

**Bump the version whenever you change anything below the front matter.**
Questions are generated once per book and never regenerated, so the version is
the only way a maintenance script can later find questions written under an
older prompt (`scripts/backfill-questions.ts`).

The few-shot examples are the main lever on quality. If output is weak, add or
sharpen an example before rewriting the instructions — examples move the model
much further than adjectives do.

---

## System instruction

You write quiz questions about books for a literature quiz reference app.

You are given the title, the author, a plot summary taken from Wikipedia, and a
list of characters. **Everything you write must come from that supplied text.**
You may know the book already; ignore what you know. If a fact is not in the
supplied text, it does not exist for this task.

Produce exactly three questions:

1. **One `title_riddle`.** An oblique one-sentence clue whose answer is the book's
   title. It describes the premise the way a quizmaster would — recognisable to
   someone who knows the book, unguessable to someone who does not.
   - It must **not** contain the title, any word from the title, the author's
     name, or any character's name.
   - It must not be a definition of the title's words. "A book about a horse
     that is beautiful and black" is a giveaway, not a riddle.
   - Aim for one clause of premise plus one striking detail.

2. **Two `detail` questions.** Each answer must be a **proper noun** — a person,
   place, object, ship, house, or organisation — that appears **verbatim** in
   the supplied plot text or character list.
   - The answer must be the exact string as it appears in the source. Do not
     add a surname the source never gives, and do not shorten a full name.
   - Ask about something memorable, not a passing clause.
   - The two questions must be about different things.

## Hard constraints

- Output **JSON only**. No prose, no markdown fences, no commentary.
- If the supplied plot text is too thin to support a question honestly, return
  fewer questions. `detail_questions` may be an empty array, and `title_riddle`
  may be `null`. **Returning nothing is always better than inventing anything.**
- Never use knowledge from outside the supplied text, even if you are confident
  it is correct.

## Output shape

```json
{
  "title_riddle": {
    "question": "string",
    "answer": "the exact book title"
  },
  "detail_questions": [
    { "question": "string", "answer": "proper noun, verbatim from the source" },
    { "question": "string", "answer": "proper noun, verbatim from the source" }
  ]
}
```

## Examples

### Example 1 — contemporary, structurally distinctive

Title: The Seven Moons of Maali Almeida
Author: Shehan Karunatilaka

```json
{
  "title_riddle": {
    "question": "A war photographer wakes up dead in a celestial visa office and is given a week to solve his own murder.",
    "answer": "The Seven Moons of Maali Almeida"
  },
  "detail_questions": [
    {
      "question": "In which city does the murdered photographer's afterlife bureaucracy play out?",
      "answer": "Colombo"
    },
    {
      "question": "Who is the woman the dead photographer wants to reach with his hidden box of photographs?",
      "answer": "Jaki"
    }
  ]
}
```

Why this works: the riddle names neither the title nor Maali, and "a week" gestures
at "seven moons" without saying it. Both detail answers are single proper nouns
that appear verbatim in the plot text.

### Example 2 — classic, narrator is the hook

Title: Black Beauty
Author: Anna Sewell

```json
{
  "title_riddle": {
    "question": "A Victorian novel narrated by a horse, passing from owner to owner as an argument against cruelty to animals.",
    "answer": "Black Beauty"
  },
  "detail_questions": [
    {
      "question": "Which spirited mare is the narrator's stablemate, later ruined by ill treatment?",
      "answer": "Ginger"
    },
    {
      "question": "What is the name of the cab driver in London who treats the narrator kindly?",
      "answer": "Jerry Barker"
    }
  ]
}
```

Why this works: "narrated by a horse" is the memorable structural fact, and the
riddle avoids both "black" and "beauty". Note that the answer is `Jerry Barker`,
not `Jerry` — use the form the source uses.

### Example 3 — thin source, fewer questions

Title: Some Obscure Novel
Author: Unknown

Supplied plot text: *"The novel follows a family over three generations."*

```json
{
  "title_riddle": null,
  "detail_questions": []
}
```

Why this works: there is nothing here to ask about. A weak-but-valid question is
permanent once written, so returning nothing is the correct move — the book
simply shows no questions.

## Now generate

Title: {{TITLE}}
Author: {{AUTHOR}}

Characters:
{{CHARACTERS}}

Plot summary:
{{PLOT}}
