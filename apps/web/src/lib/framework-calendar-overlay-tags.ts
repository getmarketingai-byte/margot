/**
 * Builds compact overlay labels for proposed calendar blocks based on WeeklyGoal tags
 * and which framework overlay layers are active.
 */

import type {
  FrameworkRegistryEntry,
  FrameworkRegistryId,
  WeeklyGoal
} from "@calendar-automations/schema";

/** When a key is missing, defaults to framework row's `overlay.enabled`. */
export type FrameworkOverlayLayerState = Partial<Record<FrameworkRegistryId, boolean>>;

function layerIsOn(
  id: FrameworkRegistryId,
  entry: FrameworkRegistryEntry | undefined,
  active: FrameworkOverlayLayerState
): boolean {
  const override = active[id];
  if (override !== undefined) return override;
  return entry?.overlay.enabled !== false;
}

const COMMITMENT_ABBR = {
  non_negotiable: "NN",
  committed: "OK",
  nice_to_have: "NT"
} as const;

export function overlayTagsForGoal(
  goal: WeeklyGoal | undefined,
  registryRows: readonly FrameworkRegistryEntry[],
  activeLayers: FrameworkOverlayLayerState,
  wheelLabel?: (areaId: string) => string
): ReadonlyArray<{ abbr: string; title: string }> {
  if (!goal) return [];
  const sorted = [...registryRows].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );
  const tags: Array<{ abbr: string; title: string }> = [];

  for (const row of sorted) {
    if (!row.enabled) continue;
    if (!layerIsOn(row.id, row, activeLayers)) continue;
    switch (row.id) {
      case "commitment": {
        const t = goal.commitmentLevel ?? "committed";
        const abbr = COMMITMENT_ABBR[t];
        tags.push({ abbr, title: `Commitment: ${t.replace(/_/g, " ")}` });
        break;
      }
      case "polarity": {
        const p = goal.energyPolarity ?? "neutral";
        const abbr = p === "drain" ? "Drn" : p === "energise" ? "En" : "N";
        tags.push({ abbr, title: `Energy polarity: ${p}` });
        break;
      }
      case "attention": {
        const a = goal.attentionMode ?? "unspecified";
        const abbr = a === "hyperfocus" ? "HF" : a === "hyperaware" ? "HA" : "At";
        tags.push({ abbr, title: `Attention: ${a.replace(/_/g, " ")}` });
        break;
      }
      case "workLayer": {
        const w = goal.workLayer ?? "unspecified";
        const abbr =
          w === "needle-mover"
            ? "Nm"
            : w === "execution"
              ? "Ex"
              : w === "ops"
                ? "Op"
                : w === "play"
                  ? "Pl"
                  : "Wl";
        tags.push({ abbr, title: `Work layer: ${w.replace(/-/g, " ")}` });
        break;
      }
      case "wheel":
        if (goal.wheelAreaId) {
          const full = wheelLabel?.(goal.wheelAreaId) ?? goal.wheelAreaId;
          tags.push({
            abbr: full.slice(0, 3),
            title: `Wheel: ${full}`
          });
        }
        break;
      case "ppfPillar":
        if (goal.ppfPillar) {
          tags.push({
            abbr:
              goal.ppfPillar === "professional"
                ? "Pr"
                : goal.ppfPillar === "personal"
                  ? "Pe"
                  : "Fi",
            title: `PPF pillar: ${goal.ppfPillar}`
          });
        }
        break;
      case "ppfHorizon":
        if (goal.ppfHorizon && goal.ppfHorizon !== "unspecified") {
          tags.push({
            abbr: goal.ppfHorizon.toUpperCase(),
            title: `PPF horizon: ${goal.ppfHorizon}`
          });
        }
        break;
      case "hp6":
        if (goal.hp6Habit) {
          tags.push({
            abbr: goal.hp6Habit.slice(0, 2).toUpperCase(),
            title: `HP6: ${goal.hp6Habit}`
          });
        }
        break;
      default:
        break;
    }
  }
  return tags;
}
