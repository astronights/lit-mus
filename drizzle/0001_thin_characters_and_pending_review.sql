-- Hand-edited after `drizzle-kit generate`.
--
-- The generated version dropped the `characters` table *before* adding the new
-- column, which would have thrown away every name already fetched. The order
-- here is add / copy / drop, so an existing database keeps its data.

ALTER TABLE "books" ADD COLUMN "characters" text[];--> statement-breakpoint

UPDATE "books" AS b
SET "characters" = c.names
FROM (
  SELECT "book_id", array_agg("name" ORDER BY "id") AS names
  FROM "characters"
  GROUP BY "book_id"
) AS c
WHERE b."id" = c."book_id";--> statement-breakpoint

DROP TABLE "characters" CASCADE;--> statement-breakpoint

-- Nothing has set this since prompt 2026-08-07.2 removed the verbatim-answer
-- check; the questions it would have hidden no longer exist.
ALTER TABLE "quiz_questions" DROP COLUMN "pending_review";
