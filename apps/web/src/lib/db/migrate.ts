/**
 * Tiny migration runner used by `pnpm db:migrate` in CI / local dev.
 * Production deploys should run `drizzle-kit migrate` against Neon directly.
 */

import { migrate } from "drizzle-orm/neon-http/migrator";
import { db } from "./index";

async function main(): Promise<void> {
  if (!db) throw new Error("DATABASE_URL not set");
  await migrate(db, { migrationsFolder: "./drizzle" });
  // eslint-disable-next-line no-console
  console.log("migrations applied");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
