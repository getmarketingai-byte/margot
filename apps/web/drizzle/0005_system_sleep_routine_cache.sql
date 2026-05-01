CREATE TABLE "system_sleep_routine_cache" (
	"userId" text NOT NULL,
	"weekStartIso" text NOT NULL,
	"inputsFingerprint" text NOT NULL,
	"sleepBlocks" jsonb NOT NULL,
	"routineBlocks" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_sleep_routine_cache_userId_weekStartIso_pk" PRIMARY KEY("userId","weekStartIso")
);
--> statement-breakpoint
ALTER TABLE "system_sleep_routine_cache" ADD CONSTRAINT "system_sleep_routine_cache_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
