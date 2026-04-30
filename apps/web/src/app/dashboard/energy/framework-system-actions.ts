"use server";

import { revalidatePath } from "next/cache";
import {
  applyCanonicalFromFrameworkSystem,
  coerceSettingsAfterSchedulerFrameworkInclusionPatch,
  frameworkSystemSchema,
  type FrameworkOverlay,
  type FrameworkRegistryId,
  type MethodModuleId,
  placementPrioritySettingsSchema,
  type PlacementSignalKey,
  schedulerFrameworkInclusionSchema,
  type SchedulerFrameworkInclusion
} from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { loadSettings, saveSettings } from "@/lib/settings-store";

function revalidatePlanningSurfaces() {
  revalidatePath("/dashboard/energy");
  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
}

/**
 * Planning Hub allocator toggles → persist inclusion + hydrate framework registry mirrors.
 */
export async function persistSchedulerFrameworkInclusion(
  patch: Partial<SchedulerFrameworkInclusion>
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const merged = schedulerFrameworkInclusionSchema.parse({
    ...settings.schedulerFrameworkInclusion,
    ...patch
  });
  await saveSettings(
    userId,
    coerceSettingsAfterSchedulerFrameworkInclusionPatch({
      ...settings,
      schedulerFrameworkInclusion: merged
    })
  );
  revalidatePlanningSurfaces();
}

export async function updateFrameworkRegistryToggle(
  id: FrameworkRegistryId,
  enabled: boolean
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const fsParse = frameworkSystemSchema.parse(settings.frameworkSystem ?? {});
  const byId = new Map(fsParse.frameworks.map((f) => [f.id, f] as const));
  const row = byId.get(id);
  if (!row) return;
  byId.set(id, { ...row, enabled });
  const frameworks = [...byId.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );
  const next = applyCanonicalFromFrameworkSystem({
    ...settings,
    frameworkSystem: { ...fsParse, frameworks }
  });
  await saveSettings(userId, next);
  revalidatePlanningSurfaces();
}

export async function updateFrameworkOverlay(
  id: FrameworkRegistryId,
  overlayPatch: Partial<Pick<FrameworkOverlay, "enabled" | "colorToken">>
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const fsParse = frameworkSystemSchema.parse(settings.frameworkSystem ?? {});
  const byId = new Map(fsParse.frameworks.map((f) => [f.id, f] as const));
  const row = byId.get(id);
  if (!row) return;
  byId.set(id, {
    ...row,
    overlay: { ...row.overlay, ...overlayPatch }
  });
  const frameworks = [...byId.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );
  await saveSettings(userId, {
    ...settings,
    frameworkSystem: { ...fsParse, frameworks }
  });
  revalidatePlanningSurfaces();
}

export async function updateMethodModuleEnabled(
  id: MethodModuleId,
  enabled: boolean
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const fsParse = frameworkSystemSchema.parse(settings.frameworkSystem ?? {});
  const mods = [...fsParse.methodModules];
  const idx = mods.findIndex((m) => m.id === id);
  if (idx < 0) mods.push({ id, enabled });
  else mods[idx] = { ...mods[idx]!, enabled };

  const next = applyCanonicalFromFrameworkSystem({
    ...settings,
    frameworkSystem: { ...fsParse, methodModules: mods }
  });
  await saveSettings(userId, next);
  revalidatePlanningSurfaces();
}

export async function updatePlacementSignalsFromFramework(order: readonly PlacementSignalKey[]): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  placementPrioritySettingsSchema.parse({ order });
  const fsParse = frameworkSystemSchema.parse(settings.frameworkSystem ?? {});
  const next = applyCanonicalFromFrameworkSystem({
    ...settings,
    frameworkSystem: { ...fsParse, placementSignalsOrder: [...order] }
  });
  await saveSettings(userId, next);
  revalidatePlanningSurfaces();
}
