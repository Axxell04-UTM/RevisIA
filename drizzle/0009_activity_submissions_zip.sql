-- Link the processed deliveries ZIP to the activity so the editor can restore it.
ALTER TABLE "activity" ADD COLUMN "submissions_zip_file_id" uuid;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "submissions_zip_file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_submissions_zip_file_id_file_id_fk" FOREIGN KEY ("submissions_zip_file_id") REFERENCES "file"("id") ON DELETE set null ON UPDATE no action;
