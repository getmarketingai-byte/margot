import type { GeneratedEvent } from "@margot/schema";

/**
 * Calendar clients treat duplicate `UID` values in one feed as one logical
 * event — extras are dropped or merged unpredictably. Multi-day busy events
 * appear in several ISO-week slices, so per-slice travel overlays can repeat
 * identical legs with the same deterministic uid; keep the first occurrence.
 */
export function dedupeGeneratedEventsByUid(events: readonly GeneratedEvent[]): GeneratedEvent[] {
  const seen = new Set<string>();
  const out: GeneratedEvent[] = [];
  for (const e of events) {
    const u = e.uid?.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(e);
  }
  return out;
}
