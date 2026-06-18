/**
 * Row Level Security (RLS) helpers for Neon Postgres.
 *
 * Run the exported SQL once during initial DB setup (or as a migration)
 * to enable RLS on all user-owned tables. Each policy ensures that a
 * session variable `app.current_user_id` must match the `user_id` column.
 *
 * Usage in application code:
 *   Before each request, set the session variable:
 *   await db.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
 *
 * Usage in Drizzle migrations:
 *   import { rlsSetupSql } from "@margot/schema/rls";
 *   await db.execute(sql.raw(rlsSetupSql));
 */

/** Tables that carry a user_id column and should be RLS-protected. */
const USER_OWNED_TABLES = [
  "posts",
  "concepts",
  "signals",
  "contacts",
  "agent_runs",
  "prompts",
  "credit_ledger",
] as const;

export type UserOwnedTable = (typeof USER_OWNED_TABLES)[number];

/**
 * SQL script that enables RLS on all user-owned tables and creates
 * a policy that restricts access to rows owned by the current user.
 *
 * Idempotent – safe to run multiple times.
 */
export const rlsSetupSql: string = [
  "-- Enable pgvector extension",
  "CREATE EXTENSION IF NOT EXISTS vector;",
  "",
  "-- Enable RLS on user-owned tables",
  ...USER_OWNED_TABLES.flatMap((table) => [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    "",
    `-- Drop existing policy if re-running`,
    `DROP POLICY IF EXISTS "${table}_user_isolation" ON "${table}";`,
    "",
    `-- Restrict SELECT/INSERT/UPDATE/DELETE to rows owned by the current user`,
    `CREATE POLICY "${table}_user_isolation"`,
    `  ON "${table}"`,
    `  USING (user_id = current_setting('app.current_user_id', true)::text)`,
    `  WITH CHECK (user_id = current_setting('app.current_user_id', true)::text);`,
    "",
  ]),
].join("\n");

/**
 * Returns a SQL statement that sets the current user ID for the session.
 * Call this at the start of each request before any RLS-protected queries.
 */
export function buildSetCurrentUserSql(userId: string): string {
  // Escape single quotes in userId to prevent SQL injection
  const safeUserId = userId.replace(/'/g, "''");
  return `SELECT set_config('app.current_user_id', '${safeUserId}', true)`;
}

/**
 * Prints the RLS setup SQL to stdout – useful for manual inspection.
 * Run with: npx tsx packages/schema/src/rls.ts
 */
if (process.argv[1]?.endsWith("rls.ts")) {
  console.log(rlsSetupSql);
}
