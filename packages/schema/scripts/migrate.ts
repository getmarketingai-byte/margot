/**
 * Run Margot database migrations against the configured DATABASE_URL.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/migrate.ts
 *
 * In CI/Vercel: add to the build command or run as a pre-deploy step.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../drizzle");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = neon(databaseUrl);

// Ensure migrations table exists
await sql`
  CREATE TABLE IF NOT EXISTS "_margot_migrations" (
    "id" serial PRIMARY KEY,
    "filename" text NOT NULL UNIQUE,
    "applied_at" timestamp NOT NULL DEFAULT now()
  )
`;

const applied = await sql`SELECT filename FROM "_margot_migrations"`;
const appliedSet = new Set(applied.map((r) => r.filename as string));

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let ran = 0;
for (const file of migrationFiles) {
  if (appliedSet.has(file)) {
    console.log(`⏭  Already applied: ${file}`);
    continue;
  }

  const sqlContent = readFileSync(join(migrationsDir, file), "utf-8");
  try {
    await sql.query(sqlContent);
    await sql`INSERT INTO "_margot_migrations" (filename) VALUES (${file})`;
    console.log(`✓  Applied: ${file}`);
    ran++;
  } catch (err) {
    console.error(`✗  Failed: ${file}`, err);
    process.exit(1);
  }
}

console.log(
  ran > 0
    ? `\nMigration complete. Applied ${ran} file(s).`
    : "\nAll migrations already applied."
);
