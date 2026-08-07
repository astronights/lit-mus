import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Auth (Better Auth core tables)                                             */
/* -------------------------------------------------------------------------- */
/*
 * Better Auth owns the shape of these four tables. Two notes that matter:
 *
 * - The argon2id hash lives on `account.password` (the "credential" provider
 *   row), not on `user`. Better Auth models a user as having many accounts so
 *   that adding Google later needs no migration -- which is exactly the door
 *   the design doc wanted left open.
 * - `session` is a real row with a random token, not a JWT, so logout and
 *   "sign out everywhere" are a DELETE.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Theme + font pairing. Mirrors localStorage; see src/lib/preferences.ts.
  preferences: jsonb("preferences").$type<UserPreferences>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    // argon2id hash for the credential provider.
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export type UserPreferences = {
  theme?: "light" | "dark" | "system";
  fontPairing?: "clean" | "comic" | "handwritten";
};

/* -------------------------------------------------------------------------- */
/* Books and shared content                                                   */
/* -------------------------------------------------------------------------- */

export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    author: text("author"),
    firstPublishYear: integer("first_publish_year"),
    coverUrl: text("cover_url"),
    openLibraryId: text("open_library_id"),
    wikidataId: text("wikidata_id").unique(),
    // Wikipedia article title, resolved at hydration; also drives attribution.
    wikipediaTitle: text("wikipedia_title"),
    // Null until first visit. This is the cache-miss check.
    hydratedAt: timestamp("hydrated_at", { withTimezone: true }),
    // Null until the background Gemini job completes.
    questionsGeneratedAt: timestamp("questions_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("books_title_idx").on(t.title),
    index("books_author_idx").on(t.author),
    index("books_hydrated_at_idx").on(t.hydratedAt),
  ],
);

export const plotBlurbs = pgTable("plot_blurbs", {
  bookId: integer("book_id")
    .primaryKey()
    .references(() => books.id, { onDelete: "cascade" }),
  // 2-4 sentences, trimmed for the card.
  shortBlurb: text("short_blurb").notNull(),
  // Raw Wikipedia plot text, kept for regeneration and answer validation.
  sourceExtract: text("source_extract").notNull(),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const characters = pgTable(
  "characters",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
  },
  (t) => [
    index("characters_book_id_idx").on(t.bookId),
    unique("characters_book_name_unique").on(t.bookId, t.name),
  ],
);

export const questionTypeEnum = pgEnum("question_type", ["title_riddle", "detail"]);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    type: questionTypeEnum("type").notNull(),
    questionText: text("question_text").notNull(),
    // title_riddle -> the book title. detail -> a proper noun from the plot.
    answer: text("answer").notNull(),
    generatedBy: text("generated_by"),
    // From prompts/question-generation.md. Lets a maintenance script find and
    // regenerate questions made under an older prompt.
    promptVersion: text("prompt_version"),
    // Set when the answer could not be found verbatim in the source text.
    // Questions still display; this flags them for the maintenance script.
    pendingReview: boolean("pending_review").notNull().default(false),
    reported: boolean("reported").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quiz_questions_book_id_idx").on(t.bookId)],
);

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export const categoryTypeEnum = pgEnum("category_type", ["award", "list", "region", "genre"]);

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: categoryTypeEnum("type").notNull(),
  // Which seed source produced this category, so a Phase 2 re-run knows what
  // it already covers.
  seedSource: text("seed_source"),
});

export const bookCategories = pgTable(
  "book_categories",
  {
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("book_categories_pk").on(t.bookId, t.categoryId),
    index("book_categories_category_idx").on(t.categoryId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Per-user drill state                                                       */
/* -------------------------------------------------------------------------- */

export const drillOutcomeEnum = pgEnum("drill_outcome", ["got_it", "missed"]);

/** Per-question historical log. Skips are deliberately not recorded. */
export const drillResults = pgTable(
  "drill_results",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "cascade" }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    outcome: drillOutcomeEnum("outcome").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("drill_results_user_book_idx").on(t.userId, t.bookId),
    index("drill_results_question_idx").on(t.questionId),
  ],
);

/** Per-book scheduling. The drill card is the book, so the box lives here. */
export const bookDrillStates = pgTable(
  "book_drill_states",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    box: integer("box").notNull().default(1),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    lastDrilledAt: timestamp("last_drilled_at", { withTimezone: true }),
    cleanPasses: integer("clean_passes").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    // User-chosen "stop showing me". Permanent, unlike box 5.
    manuallyRetired: boolean("manually_retired").notNull().default(false),
  },
  (t) => [
    uniqueIndex("book_drill_states_user_book_unique").on(t.userId, t.bookId),
    index("book_drill_states_due_idx").on(t.userId, t.dueAt),
  ],
);
