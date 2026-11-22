CREATE TABLE "rubric_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"label" text NOT NULL,
	"placeholder" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rubric_context" ADD CONSTRAINT "rubric_context_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_context_tag_uq" ON "rubric_context" USING btree ("rubric_id","tag");--> statement-breakpoint
CREATE INDEX "rubric_context_rubric_idx" ON "rubric_context" USING btree ("rubric_id");