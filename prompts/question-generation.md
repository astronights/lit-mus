---
version: 2026-08-08.2
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
may use it. Where the article and your memory disagree, the article wins.

**Not recognising a book is not a reason to return nothing.** Many of these are
recent or in translation, and the supplied article is sufficient grounding on
its own — a fact stated there is usable whether or not the book is familiar.
Caution applies to what you *remember*: do not assert a remembered fact you are
unsure of. It does not apply to what you have just been read.

Produce up to three questions.

### 1. One `title_riddle`

A question whose answer is the book's title. Write it the way a quizmaster
would: one or two sentences circling the work through its most *distinctive*
fact, landing on "which work?". Two sentences at most, and under about 40
words — it is read on a phone between two taps.

### The specificity test — apply this before anything else

**Could your clue describe a different book?** If yes, it has failed. Rewrite it.

"A journey about leaving one's homeland" describes hundreds of novels. So does
"a family saga spanning three generations", "a young woman comes of age in a
changing society", and "an exploration of memory, loss and identity". These are
*categories*, not clues. A player hearing one has been told nothing.

Every riddle must contain **at least one hard particular that could not be
moved to another book**. Reach for exactly one of these four wells, whichever
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
4. **How it came to be written** — a contest, a wager, a commission, a
   manuscript nearly destroyed, a pseudonym, publication in instalments or
   after the author's death.

If more than one well fits, pick the one that would make a room go "oh, *that*
book" — not the one that is easiest to write.

A "hard particular" is a number, a named real place or event, a physical object,
an impossible rule, or a formal device — and it must come from **inside the
work**, or from what the work did in the world.

**Publication metadata does not count.** The year, the nationality, the genre,
the publisher, and the prize it won or was shortlisted for are *framing*: fine
to include, worthless as the clue, because hundreds of books share each of them.
"This 1977 novel, shortlisted for the Booker Prize" narrows nothing by itself —
six books were on that shortlist and thousands were published that year.

So the test is not "does my clue contain a date or a proper noun". It is: **strip
out everything that could be read off a catalogue card — year, prize, nationality,
genre — and does what remains still point at one book?** If what remains is
"a woman travels to care for a dying parent" or "a family is divided by war",
the clue is not finished, however many prizes are named around it.

### The anchor — specific is not the same as gettable

A hard particular stops the clue being generic. It does not, on its own, give
the player anything to *recognise*. A riddle built entirely on things only a
reader of that book has heard of — an invented protagonist, a small town, a
minor institution — is precise and still unplayable.

So alongside the particular, give the clue **one thing a well-read person who
has not read the book could plausibly know**. Use the same recognition test as
the detail questions in section 2. Candidates, in rough order of usefulness:

- **A famous character.** Naming one is allowed and often the best clue there
  is — the diarist who works at the Ministry of Truth, the whaling captain
  hunting a white whale. This is a change: character names used to be banned
  outright, and are not any more.
- **A real place, event, person or institution** the book attaches to.
- **A famous adaptation**, or a better-known work by the same author (name the
  *work*, never the author).
- **The real thing the title refers to**, described rather than named — and if
  that thing is obscure, attach it to something that is not. "The cathedral
  city at the end of that journey" is unguessable; "the cathedral city that was
  Samuel Johnson's birthplace" is the same clue, made playable.

If a book genuinely offers no anchor, a hard clue is still better than a vague
one — but look for the anchor first.

Rules:

- It must **not** contain the title, any distinctive word from the title, or
  the author's name. A question containing its own answer is discarded
  automatically, so this one is worth care.
- Character names **are** allowed, with one exception: a name so bound to the
  book that it works as the title. Emma Woodhouse, Jane Eyre, Anna Karenina and
  Black Beauty are the answer, not a clue. Holden Caulfield and Bilbo Baggins
  are not literally the title, but naming them ends the question — treat them
  the same way.
- An obscure character's name is not an anchor. "Follows Anne Linton as she
  travels north" is the catalogue-card mistake wearing a different hat: a
  proper noun that looks like information and helps nobody. If the name would
  mean nothing to a non-reader, describe the person instead of naming them.
- Do not define the title's words. "A book about a horse that is beautiful and
  black" is a giveaway, not a clue.
- A date, nationality or genre is fair and helpful *framing* — "in which 1877
  work…" places the book without giving anything away — but it is never the clue
  itself. Add it around a hard particular, never instead of one.
- Vagueness is not difficulty. A clue nobody can get because it is unspecific
  is a failure; a clue that is precise and still hard is the goal.
- Return `null` only if the article gives you nothing concrete at all. A plainer
  clue built on whatever it does give — a date, a setting, a narrator, a place —
  beats returning nothing.

### 2. Two `detail` questions

Each answer must be a proper noun that **means something outside this book**.

The test is recognition, not reality: would a well-read person who has *not*
read this book have heard of it?

- ✅ **Real anything** — Colombo, Biafra, the Nigerian Civil War, the bearing
  rein, the Bastille, the Cultural Revolution, Cetshwayo, Villa Diodati.
  Places, events, people, institutions, practices, objects with a history.
- ✅ **Invented but famous** — Macondo, Middle-earth, Big Brother, Room 101,
  Hogwarts. These exist only in fiction, but they have escaped their covers
  and are worth knowing.
- ❌ **Invented and obscure** — Ginger, Jerry Barker, Squire Gordon. Memorable
  if you have read the book, meaningless if you have not, and exactly what a
  lazy question reaches for.

Being a character does not disqualify a name — only being unknown outside the
book does. Real people who appear as characters are always fair game: Napoleon,
Thomas Cromwell, Willie Lincoln. The character list you are given is context,
not a shortlist of answers.

Ask about something the book is genuinely associated with — the war it is set
during, the city it made famous, the practice it helped end.

The two questions must differ **in kind, not just in wording**: if one asks
about a place, the other should ask about a person, an event or an object. Two
angles on the same war is one question asked twice.

**Two is the target, not a quota.** One good detail question beats two where the
second is padding.

**Never ask about anything the riddle already stated.** The card plays the
riddle first and the details straight afterwards, so a fact named in the riddle
was handed to the player seconds ago and tests nothing. If your riddle mentions
a city, the details cannot ask for that city; if it names a war, the details
cannot ask for that war. Write the riddle first, then pick detail answers it
does *not* touch. A detail answer that appears in the riddle is discarded
automatically.

This cuts both ways, and it is often easier to fix from the riddle end: if the
best detail answer for a book is the practice it abolished, keep the riddle
vaguer about that practice — "a cruel piece of Victorian harness" rather than
naming it — and save the name for the detail question.

## Hard constraints

- Output **JSON only**. No prose, no markdown fences, no commentary.
- **Returning fewer questions is always better than padding.** `detail_questions`
  may be an empty array and `title_riddle` may be `null`. Plenty of novels —
  domestic fiction especially — contain no proper noun anyone would recognise
  outside them. Return nothing rather than falling back to a name that means
  nothing beyond this book.
- **An answer is a name or a short phrase**, at most a few words. It is shown on
  its own as *the answer*, so explanations belong in the question. "bearing
  rein", not "the bearing rein, a strap used on carriage horses".
- Do not state a fact you are unsure of. A wrong answer is worse than a missing
  one: these questions are written once and are never revised. This applies to
  what you *recall* — a fact stated in the supplied article can be used freely.

## Output shape

```json
{
  "title_riddle": {
    "question": "string",
    "answer": "the exact book title"
  },
  "detail_questions": [
    { "question": "string", "answer": "a proper noun recognisable outside this book" },
    { "question": "string", "answer": "a proper noun recognisable outside this book" }
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
    "question": "Its sympathetic first-person narration — unusually, by a horse — is credited with helping abolish a cruel piece of Victorian harness that forced carriage horses to hold their heads high. Which 1877 work?",
    "answer": "Black Beauty"
  },
  "detail_questions": [
    { "question": "Which strap, used to force a carriage horse's head painfully high, fell out of use in Britain partly because of this novel?", "answer": "bearing rein" },
    { "question": "In which city does the narrator spend his hardest years pulling a cab?", "answer": "London" }
  ]
}
```

Note the restraint: the riddle says "a cruel piece of Victorian harness" and does
**not** name the bearing rein, precisely so the detail question can ask for it.
Naming it in the riddle would have burned the answer.

The two details differ in kind — an object and a place. And note what is absent:
Ginger and Jerry Barker are this novel's most memorable names, and both are wrong
answers, because nobody who has not read the book would know them.

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
    { "question": "In which capital city, during that country's civil war, is this afterlife novel set?", "answer": "Colombo" },
    { "question": "Which decades-long conflict between the government and the Tamil Tigers forms the novel's backdrop?", "answer": "Sri Lankan Civil War" }
  ]
}
```

The riddle says what the title *counts* without using "seven" or "moons". A place
and an event, both worth knowing in any other quiz round.

### Example 3 — vague versus specific, and one detail is enough

Title: Exit West
Author: Mohsin Hamid

**Rejected riddle:** "A journey about leaving one's homeland for an uncertain
future. Which novel?"

That describes hundreds of novels. It contains no hard particular and tells a
player nothing. Rewrite it around the strangest concrete thing in the book:

```json
{
  "title_riddle": {
    "question": "In this 2017 Booker-shortlisted novel, refugees escape a city sliding into civil war not by boat or on foot, but through black doors that appear without warning in wardrobes and storerooms. Which novel?",
    "answer": "Exit West"
  },
  "detail_questions": [
    { "question": "Which Greek island do the couple first reach after stepping through a door?", "answer": "Mykonos" }
  ]
}
```

One detail question, not two. The novel's other memorable names are its invented
doors and its deliberately unnamed city — neither is an answer — so a second
question would have been padding. One good question beats two.

### Example 4 — the clue is how the book came to be written

Title: Frankenstein
Author: Mary Shelley

```json
{
  "title_riddle": {
    "question": "Begun as a teenager's entry in a ghost-story contest during the volcanic 'year without a summer', it is often called the first science-fiction novel. Which 1818 work?",
    "answer": "Frankenstein"
  },
  "detail_questions": [
    { "question": "At which villa beside Lake Geneva was that ghost-story contest held?", "answer": "Villa Diodati" },
    { "question": "The eruption of which Indonesian volcano caused the summerless year it was written in?", "answer": "Mount Tambora" }
  ]
}
```

The composition story is the most quizzed thing about this book, and the riddle
gestures at the contest without naming the villa — again saving it for a detail.
Mount Tambora is nowhere in the novel, but it is exactly the kind of fact a quiz
rewards knowing.

### Example 5 — the prize and the date are not the clue

Title: The Road to Lichfield
Author: Penelope Lively

**Rejected riddle:** "This 1977 novel, shortlisted for the Booker Prize, follows
a woman who leaves her family to care for her father in his final weeks in a
distant city. Which work?"

This one is harder to spot than a plainly vague clue, because it *looks*
specific: it has a year and names a real prize. Strip those out and see what is
left — "a woman leaves her family to care for her dying father in another city".
That is a situation, not a book. The clue spent its particulars on the catalogue
card and gave the player nothing to recognise.

The article has better material a paragraph further down: what she finds in the
house, and where the title's road actually goes.

That second clue needs care, and it is the harder half of this example. "Named
for the cathedral city at the end of that journey" is a true, hard particular
and still unplayable — nobody guesses a Staffordshire town from "cathedral
city". The city has to be anchored to something a non-reader knows, and it has
one: it is Samuel Johnson's birthplace. Same clue, now solvable.

```json
{
  "title_riddle": {
    "question": "Driving between her family and her dying father's nursing home, a woman learns he kept a mistress for years. This 1977 debut is named for the cathedral city at the end of that journey — Samuel Johnson's birthplace. Which work?",
    "answer": "The Road to Lichfield"
  },
  "detail_questions": [
    { "question": "Which later novel finally won this author the prize she was shortlisted for here?", "answer": "Moon Tiger" }
  ]
}
```

The year survives, but now it is framing around a hard particular (the concealed
mistress) and an anchor (Johnson). Note that the title clue points *at* the
answer without using it: the city is described and attached to someone famous,
never named.

Note also what is **not** in the riddle: the protagonist's name. She is an
invented, ordinary woman, so "follows Anne Linton" would have added a proper
noun and no information. Naming a character is worth doing when the character
is the thing people know — here, describing her is stronger.

One detail question, for the same reason. Everyone in this book is invented and
ordinary, so there is no second answer that means anything to a non-reader.
Reaching for one would have produced exactly the "invented and obscure" question
section 2 rejects; the author's later prize-winner is the one genuinely
recognisable name attached to this novel.

### Example 6 — nothing recognisable to ask about

Title: A Quiet Domestic Novel
Author: Someone

The lead identifies a minor novel, there is no reception or legacy section, and
the plot is set in an invented village with no connection to any real place,
event or person.

```json
{
  "title_riddle": null,
  "detail_questions": []
}
```

Every candidate answer would have been an invented village or an obscure
character. A weak question is permanent once written, so returning nothing is
correct — the book simply shows no questions.

## Now generate

Title: {{TITLE}}
Author: {{AUTHOR}}

Characters — context, not a shortlist. A name here is only usable as an answer
if it would be recognised by someone who has not read the book; it must never
appear in the riddle:
{{CHARACTERS}}

Wikipedia article — lead, about-the-work sections, and plot:
{{SOURCE}}
