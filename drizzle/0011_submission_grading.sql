-- Grading persistence for the review screen.

-- The per-criterion rows already live in `grade`. The model also writes one
-- summary per delivery, and that summary belongs to the delivery, not to a
-- criterion: storing it on `submission` keeps the grade readable with a single
-- join and leaves `grade` as the strict per-criterion table.
ALTER TABLE "submission" ADD COLUMN IF NOT EXISTS "grading_summary" text;
