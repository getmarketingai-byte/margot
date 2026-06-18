/**
 * @margot/schema – root barrel export.
 */

// Database connection
export { db } from "./db";
export type { Database } from "./db";

// All table definitions and types
export * from "./schema/index";

// RLS utilities
export { rlsSetupSql, buildSetCurrentUserSql } from "./rls";
export type { UserOwnedTable } from "./rls";
