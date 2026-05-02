CREATE TABLE "ics_custom_feed" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "title" text NOT NULL,
  "rules" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ics_custom_feed" ADD CONSTRAINT "ics_custom_feed_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DELETE FROM "feed_token" WHERE "feed" <> 'all';
--> statement-breakpoint
ALTER TABLE "feed_token" ADD COLUMN "customFeedId" text;
--> statement-breakpoint
ALTER TABLE "feed_token" ADD CONSTRAINT "feed_token_customFeedId_ics_custom_feed_id_fk" FOREIGN KEY ("customFeedId") REFERENCES "public"."ics_custom_feed"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS "feed_token_user_feed";
--> statement-breakpoint
ALTER TABLE "feed_token" ADD CONSTRAINT "feed_token_feed_scope_check" CHECK (
  ("feed" = 'all' AND "customFeedId" IS NULL)
  OR ("feed" = 'custom' AND "customFeedId" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feed_token_one_all_per_user" ON "feed_token" ("userId") WHERE "feed" = 'all';
--> statement-breakpoint
CREATE UNIQUE INDEX "feed_token_custom_feed_unique" ON "feed_token" ("customFeedId") WHERE "customFeedId" IS NOT NULL;
