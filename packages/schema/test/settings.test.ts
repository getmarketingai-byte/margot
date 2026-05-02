import { describe, expect, it } from "vitest";
import {
  applyCanonicalFromFrameworkSystem,
  DEFAULT_USER_SETTINGS,
  frameworkSystemSchema,
  migrateSettings,
  settingsNeedHomeAddress,
  SETTINGS_SCHEMA_VERSION,
  userSettingsSchema
} from "../src/index";

describe("UserSettings schema", () => {
  it("parses an empty object into fully-defaulted settings", () => {
    const parsed = userSettingsSchema.parse({ schemaVersion: SETTINGS_SCHEMA_VERSION });
    expect(parsed.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(parsed.timemap.bands).toHaveLength(4);
    expect(parsed.wheel.areas).toHaveLength(8);
    expect(parsed.ppf.targets).toHaveLength(3);
    expect(parsed.schedulerFrameworkInclusion.commitment).toBe(false);
    expect(parsed.schedulerFrameworkInclusion.workLayer).toBe(false);
    expect(parsed.allocator.starvationMode).toBe("proportional");
    expect(parsed.allocator.allocationMode).toBe("even");
    expect(parsed.allocator.catchUpMode).toBe("automated");
  });

  it("accepts finish-early allocationMode", () => {
    const parsed = userSettingsSchema.parse({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      allocator: { allocationMode: "finish-early" }
    });
    expect(parsed.allocator.allocationMode).toBe("finish-early");
    expect(parsed.allocator.starvationMode).toBe("proportional");
  });

  it("migrates legacy settings that omit allocationMode", () => {
    const migrated = migrateSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      allocator: { starvationMode: "strict" }
    });
    expect(migrated.allocator.starvationMode).toBe("strict");
    expect(migrated.allocator.allocationMode).toBe("even");
    expect(migrated.allocator.catchUpMode).toBe("automated");
  });

  it("DEFAULT_USER_SETTINGS round-trips", () => {
    const reparsed = userSettingsSchema.parse(DEFAULT_USER_SETTINGS);
    expect(reparsed).toEqual(DEFAULT_USER_SETTINGS);
  });

  it("rejects gym sessionMinutesMin greater than sessionMinutesMax", () => {
    expect(() =>
      userSettingsSchema.parse({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        gym: {
          ...DEFAULT_USER_SETTINGS.gym,
          sessionMinutesMin: 60,
          sessionMinutesMax: 45
        }
      })
    ).toThrow();
  });

  it("rejects gym sessionsPerWeekMin greater than sessionsPerWeekMax", () => {
    expect(() =>
      userSettingsSchema.parse({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        gym: {
          ...DEFAULT_USER_SETTINGS.gym,
          sessionsPerWeekMin: 5,
          sessionsPerWeekMax: 2
        }
      })
    ).toThrow();
  });

  it("settingsNeedHomeAddress when routing or weather is on", () => {
    expect(
      settingsNeedHomeAddress({
        travel: { routingProvider: "disabled", homeAddress: undefined },
        weather: { enabled: false }
      })
    ).toBe(false);
    expect(
      settingsNeedHomeAddress({
        travel: { routingProvider: "openrouteservice", homeAddress: "x" },
        weather: { enabled: false }
      })
    ).toBe(true);
    expect(
      settingsNeedHomeAddress({
        travel: { routingProvider: "disabled", homeAddress: undefined },
        weather: { enabled: true }
      })
    ).toBe(true);
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

  it("migrateSettings seeds schedulerFrameworkInclusion from legacy wheel/ppf/hpp flags", () => {
    const migrated = migrateSettings({
      wheel: { enabled: true, areas: [] },
      ppf: { enabled: true, targets: [] },
      hpp: { enabled: false, hp6MinTouchesPerMonth: {} }
    } as Parameters<typeof migrateSettings>[0]);
    expect(migrated.schedulerFrameworkInclusion.wheel).toBe(true);
    expect(migrated.schedulerFrameworkInclusion.ppfPillar).toBe(true);
    expect(migrated.schedulerFrameworkInclusion.hp6).toBe(false);
    expect(migrated.schedulerFrameworkInclusion.commitment).toBe(false);
    expect(migrated.schedulerFrameworkInclusion.workLayer).toBe(false);
    expect(migrated.wheel.enabled).toBe(true);
    expect(migrated.ppf.enabled).toBe(true);
  });

  it("defaults personalSystem with energy scheduling off", () => {
    const parsed = userSettingsSchema.parse({ schemaVersion: SETTINGS_SCHEMA_VERSION });
    expect(parsed.personalSystem.enabled).toBe(false);
    expect(parsed.personalSystem.energyBatterySchedulingEnabled).toBe(false);
    expect(parsed.personalSystem.advancedRules).toEqual([]);
    expect(parsed.personalSystem.guided.drainTransitionPenaltyScale).toBe(1);
  });

  it("migrateSettings hydrates frameworkSystem registry rows from canonical inclusion", () => {
    const migrated = migrateSettings({
      timezone: "UTC",
      schedulerFrameworkInclusion: {
        commitment: true,
        polarity: false,
        attention: true,
        workLayer: true,
        wheel: true,
        ppfPillar: false,
        ppfHorizon: true,
        hp6: false
      }
    } as Parameters<typeof migrateSettings>[0]);

    expect(migrated.frameworkSystem.frameworks.length).toBeGreaterThanOrEqual(8);
    const wheel = migrated.frameworkSystem.frameworks.find((f) => f.id === "wheel");
    expect(wheel?.enabled).toBe(true);
    expect(wheel?.overlay.enabled !== false).toBe(true);

    const polar = migrated.frameworkSystem.frameworks.find((f) => f.id === "polarity");
    expect(polar?.enabled).toBe(false);
    const mods = migrated.frameworkSystem.methodModules.find((m) => m.id === "energy_transitions");
    expect(mods).toBeTruthy();
    expect(mods!.enabled).toBe(migrated.personalSystem.energyBatterySchedulingEnabled === true);
  });

  it("applyCanonicalFromFrameworkSystem syncs scheduler inclusion from registry and placement signals", () => {
    const base = migrateSettings({ timezone: "UTC" } as Parameters<typeof migrateSettings>[0]);
    const fs = frameworkSystemSchema.parse(base.frameworkSystem);
    let frameworks = fs.frameworks.map((row) =>
      row.id === "wheel" ? { ...row, enabled: false } : row
    );
    frameworks = [...frameworks].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
    );
    const reorder: Array<
      typeof base.placementPriority.order[number]
    > = ["energyPolarity", "attentionMode", "workLayer", "energyMode"];
    const edited = applyCanonicalFromFrameworkSystem({
      ...base,
      frameworkSystem: {
        ...fs,
        frameworks,
        placementSignalsOrder: reorder
      }
    });

    expect(edited.schedulerFrameworkInclusion.wheel).toBe(false);
    expect(edited.placementPriority.order).toEqual(reorder);
    expect(edited.frameworkSystem.placementSignalsOrder).toEqual(reorder);
  });
});
