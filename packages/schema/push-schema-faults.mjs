/**
 * Creates the fault_reports table in Neon.
 * Run with: node push-schema-faults.mjs
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const ddl = [
  `CREATE TABLE IF NOT EXISTS fault_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'unknown',
    status_code INTEGER,
    path TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    user_agent TEXT,
    metadata JSONB,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  // Index for querying by status (most common admin filter)
  `CREATE INDEX IF NOT EXISTS fault_reports_status_idx ON fault_reports(status)`,

  // Index for querying by user
  `CREATE INDEX IF NOT EXISTS fault_reports_user_id_idx ON fault_reports(user_id)`,

  // Index for time-based ordering
  `CREATE INDEX IF NOT EXISTS fault_reports_created_at_idx ON fault_reports(created_at DESC)`,
];

for (const stmt of ddl) {
  console.log("Executing:", stmt.slice(0, 80) + "...");
  try {
    await sql(stmt);
    console.log("  OK");
  } catch (err) {
    console.error("  Error:", err.message);
  }
}

console.log("Done.");
