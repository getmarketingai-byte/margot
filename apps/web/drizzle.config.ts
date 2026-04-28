import type { Config } from "drizzle-kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readDatabaseUrlFromFile(fileName: string): string | undefined {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith("DATABASE_URL=")) continue;
    return line.slice("DATABASE_URL=".length).trim();
  }
  return undefined;
}

const databaseUrl =
  process.env.DATABASE_URL ??
  readDatabaseUrlFromFile(".env.local") ??
  readDatabaseUrlFromFile(".env") ??
  "";

const config: Config = {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl
  }
};

export default config;
