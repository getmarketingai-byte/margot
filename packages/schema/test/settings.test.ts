import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  migrateSettings,
  userSettingsSchema
} from "../src/index";

describe("UserSettings schema", () => {
  it("parses an empty object into fully-defaulted settings", () => {
    const parsed = userSettingsSchema.parse({ schemaVersion: SETTINGS_SCHEMA_VERSION });
    expect(parsed.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(parsed.timemap.bands).toHaveLength(4);
    expect(parsed.wheel.areas).toHaveLength(8);
    expect(parsed.ppf.targets).toHaveLength(3);
    expect(parsed.calendars.schedulingWindowDays).toBe(60);
  });

  it("DEFAULT_USER_SETTINGS round-trips", () => {
    const reparsed = userSettingsSchema.parse(DEFAULT_USER_SETTINGS);
    expect(reparsed).toEqual(DEFAULT_USER_SETTINGS);
  });

  it("migrateSettings stamps schemaVersion when absent", () => {
    const migrated = migrateSettings({ timezone: "Australia/Sydney" });
    expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrated.timezone).toBe("Australia/Sydney");
  });

  it("rejects nonsense values", () => {
    expect(() =>
      userSettingsSchema.parse({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sleep: { idealWakeHour: 99 }
      })
    ).toThrow();
  });
});
