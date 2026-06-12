-- Margot initial schema migration
-- Auth.js v5 tables + Margot domain tables

-- Auth: user
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text NOT NULL,
  "email_verified" timestamp,
  "image" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "user_email_unique" UNIQUE("email")
);

-- Auth: account
CREATE TABLE IF NOT EXISTS "account" (
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
DO $$ BEGIN
  ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Auth: session
CREATE TABLE IF NOT EXISTS "session" (
  "session_token" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "expires" timestamp NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Auth: verification_token
CREATE TABLE IF NOT EXISTS "verification_token" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp NOT NULL,
  CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);

-- Margot: post
CREATE TABLE IF NOT EXISTS "post" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "status" text NOT NULL DEFAULT 'draft',
  "channel" text,
  "scheduled_at" timestamp,
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "post" ADD CONSTRAINT "post_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Margot: concept
CREATE TABLE IF NOT EXISTS "concept" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "parent_id" uuid,
  "title" text NOT NULL,
  "body" text,
  "tags" text[],
  "created_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "concept" ADD CONSTRAINT "concept_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Margot: signal
CREATE TABLE IF NOT EXISTS "signal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "source" text,
  "title" text NOT NULL,
  "content" text,
  "url" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "signal" ADD CONSTRAINT "signal_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Margot: contact
CREATE TABLE IF NOT EXISTS "contact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "company" text,
  "role" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'lead',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Margot: agent_run
CREATE TABLE IF NOT EXISTS "agent_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "input_data" jsonb,
  "output_data" jsonb,
  "error_message" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Margot: prompt
CREATE TABLE IF NOT EXISTS "prompt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "tags" text[],
  "is_public" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "prompt" ADD CONSTRAINT "prompt_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Margot: credit_ledger
CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "amount" integer NOT NULL,
  "description" text NOT NULL,
  "reference_id" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
