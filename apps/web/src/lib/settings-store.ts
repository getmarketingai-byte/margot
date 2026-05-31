/**
 * Read/write helpers for the per-user UserSettings JSON.
 *
 * Always passes the raw JSON through `migrateSettings` so older snapshots come
 * out of the database parsed to the current schema version — that decouples
 * deployment ordering (DB rows can lag behind a code rollout safely).
 */

import { eq } from "drizzle-orm";
import {
  DEFAULT_USER_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  hydrateFrameworkSystemMirrors,
  migrateSettings,
  userSettingsSchema,
  type UserSettings
} from "@margot/schema";
import { db, schema } from "./db/index";

export async function loadSettings(userId: string): Promise<UserSettings> {
  if (!db) return DEFAULT_USER_SETTINGS;
  const row = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);
  const existing = row[0];
  if (!existing) return DEFAULT_USER_SETTINGS;
  return migrateSettings(existing.data);
}

export async function saveSettings(
  userId: string,
  next: UserSettings
): Promise<UserSettings> {
  const validated = userSettingsSchema.parse(hydrateFrameworkSystemMirrors(next));
  if (!db) return validated;
  await db
    .insert(schema.userSettings)
    .values({
      userId,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      data: validated,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        data: validated,
        updatedAt: new Date()
      }
    });
  return validated;
}
