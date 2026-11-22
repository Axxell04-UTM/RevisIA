-- Delivery files staged for an activity, before the teacher groups them into
-- submissions. The ZIP ingest writes here so the review screen can list them.
CREATE TABLE "activity_file" (
	"activity_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_file_activity_id_file_id_pk" PRIMARY KEY("activity_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "activity_file" ADD CONSTRAINT "activity_file_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_file" ADD CONSTRAINT "activity_file_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_file_file_idx" ON "activity_file" ("file_id");
