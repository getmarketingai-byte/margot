/**
 * Default UserSettings derived from the legacy Apps Script Config.gs values.
 *
 * Used to seed onboarding and to populate a brand-new user record. Power users
 * can later import/export the parsed object; new fields default in via Zod.
 */

import {
  SETTINGS_SCHEMA_VERSION,
  userSettingsSchema,
  type UserSettings
} from "./settings";

export const DEFAULT_USER_SETTINGS: UserSettings = userSettingsSchema.parse({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  timezone: "Australia/Melbourne"
});
