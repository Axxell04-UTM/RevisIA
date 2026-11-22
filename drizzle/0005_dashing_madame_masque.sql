ALTER TABLE "submission" ALTER COLUMN "student_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "upload_context" text DEFAULT 'submission' NOT NULL;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "metadata_name" text;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "metadata_integrantes" text;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "metadata_titulo" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_activity_sha_uq" ON "submission" USING btree ("activity_id","sha256") WHERE "submission"."deleted_at" is null and "submission"."sha256" is not null;