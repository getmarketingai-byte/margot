/**
 * Neon serverless Postgres + Drizzle ORM connection.
 *
 * Uses the @neondatabase/serverless driver which works in:
 *  - Edge runtimes (Vercel Edge, Cloudflare Workers)
 *  - Node.js serverless functions
 *  - Standard Node.js environments
 */

import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema/index";

// Enable WebSocket pooling for better performance in persistent runtimes
// (no-op in edge environments)
neonConfig.fetchConnectionCache = true;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. " +
      "Create a Neon Postgres database and add the connection string to your .env file."
  );
}

const sql = neon(databaseUrl);

/**
 * The primary Drizzle database instance.
 * Import this anywhere you need to query the database.
 *
 * @example
 * import { db } from "@margot/schema";
 * const users = await db.select().from(usersTable);
 */
export const db = drizzle(sql, { schema });

export type Database = typeof db;
