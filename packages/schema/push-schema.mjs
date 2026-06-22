/**
 * Script to create new tables (brain_dumps, user_profiles) in Neon.
 * Run with: node scripts/push-schema.mjs
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const ddl = [
  // brain_dumps
  `CREATE TABLE IF NOT EXISTS brain_dumps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  // user_profiles
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    headline TEXT,
    bio TEXT,
    industry TEXT,
    target_audience TEXT,
    website TEXT,
    linkedin_url TEXT,
    twitter_handle TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
];

for (const stmt of ddl) {
  console.log("Executing:", stmt.slice(0, 60) + "...");
  try {
    await sql(stmt);
    console.log("OK");
  } catch (err) {
    console.error("Error:", err.message);
  }
}

console.log("Done.");
