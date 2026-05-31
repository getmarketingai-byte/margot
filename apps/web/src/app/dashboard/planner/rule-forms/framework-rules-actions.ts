"use server";

import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import {
  coerceSettingsAfterLegacyWheelPpfHppEdit,
  type Hp6HabitKey,
} from "@margot/schema";

import { frameworkRuleFormPillarKeys as PILLARS } from "./framework-rule-form-shared";
const HP6_KEYS: Readonly<Hp6HabitKey[]> = [
  "clarity",
  "energy",
  "necessity",
  "productivity",
  "influence",
  "courage"
];

function afterFrameworkRulesSave(userId: string): void {
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

export async function updateWheel(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const areas = settings.wheel.areas.map((a) => {
    const score = Number(formData.get(`score_${a.id}`) ?? a.score);
    const minMinutes = Number(formData.get(`floor_${a.id}`) ?? a.minMinutesPerWeek);
    return {
      ...a,
      score: Math.max(1, Math.min(10, score || a.score)),
      minMinutesPerWeek: Math.max(0, Math.floor(minMinutes || 0))
    };
  });
  await saveSettings(
    userId,
    coerceSettingsAfterLegacyWheelPpfHppEdit({
      ...settings,
      wheel: { ...settings.wheel, enabled: true, areas }
    })
  );
  afterFrameworkRulesSave(userId);
}

export async function updatePpf(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const targets = PILLARS.map((p) => ({
    pillar: p,
    minPercent: Math.max(0, Math.min(100, Number(formData.get(`pct_${p}`) ?? 0))),
    minTouchesPerWeek: Math.max(0, Number(formData.get(`touches_${p}`) ?? 0))
  }));
  await saveSettings(
    userId,
    coerceSettingsAfterLegacyWheelPpfHppEdit({
      ...settings,
      ppf: { enabled: true, targets }
    })
  );
  afterFrameworkRulesSave(userId);
}

export async function updateHpp(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const hp6MinTouchesPerMonth = Object.fromEntries(
    HP6_KEYS.map((key) => [key, Math.max(0, Number(formData.get(`hp6_${key}`) ?? 0))])
  ) as Record<Hp6HabitKey, number>;
  await saveSettings(
    userId,
    coerceSettingsAfterLegacyWheelPpfHppEdit({
      ...settings,
      hpp: {
        ...settings.hpp,
        enabled: true,
        hp6MinTouchesPerMonth
      }
    })
  );
  afterFrameworkRulesSave(userId);
}

export async function updateEnergyOrdering(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const mode = String(formData.get("mode") ?? "balanced") as "strict" | "balanced" | "ignore";
  await saveSettings(userId, {
    ...settings,
    energyOrdering: { ...settings.energyOrdering, mode }
  });
  afterFrameworkRulesSave(userId);
}
