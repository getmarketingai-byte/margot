import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle>;

let cached: DrizzleDb | null = null;

function build(): DrizzleDb | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return drizzle(neon(url), { schema });
}

export function getDb(): DrizzleDb | null {
  if (cached) return cached;
  cached = build();
  return cached;
}

/**
 * Convenience export: `db` is `null` when DATABASE_URL is not configured.
 * Consumers must null-check before issuing queries; pages render with empty
 * data in that case so the UI is exercisable in local development.
 */
export const db: DrizzleDb | null = getDb();
export { schema };
