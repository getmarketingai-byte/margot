/**
 * Routing abstraction for resolving real drive durations.
 *
 * The interface is deliberately small so we can swap providers (currently
 * OpenRouteService; a Google Distance Matrix stub is left for future work)
 * without touching the call sites in `week-blocks.ts`. Cache + budget
 * concerns live inside the resolver so the caller just hands it a list of
 * legs and receives a duration map back.
 *
 * Architecture:
 *
 *   computeTravelBlocks(busy, settings, resolver)
 *      └── resolver.resolveMany([{origin, dest, priorityTimeMs}, ...])
 *                 ├── consult cache (settings.travelCache.legs)
 *                 ├── if stale OR missing, call provider up to budget
 *                 └── return Map<legKey, minutes | null>
 *      └── after rendering, persist `resolver.takeCacheUpdates()` via
 *          saveSettings() (only if there were updates)
 */

import type {
  TravelCache,
  TravelLegState,
  TravelSettings
} from "@calendar-automations/schema";
import { createOpenRouteServiceProvider, type RoutingProviderClient } from "./openrouteservice";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER_LOOKAHEAD_MS = 7 * DAY_MS;

export interface ResolveRequest {
  origin: string;
  dest: string;
  /**
   * Earliest moment this leg matters (epoch ms). Used to prioritise stale
   * lookups when the call budget is tight — soonest-first wins.
   */
  priorityTimeMs?: number;
  /**
   * Optional override of the fallback duration for this leg (e.g. gym legs
   * always use a flat 10-min). When set, the resolver returns this value
   * without ever consulting the cache or the provider, so it's the cheapest
   * way to short-circuit a known-distance leg.
   */
  fixedMinutes?: number;
}

export interface LegResolver {
  /**
   * Returns a duration map keyed by `originKey\ndestKey`. Each value is the
   * resolved minutes, or null when the leg couldn't be resolved (no key,
   * provider failure, etc.). Callers should treat null as "use fallback".
   */
  resolveMany(legs: readonly ResolveRequest[]): Promise<Map<string, number | null>>;
  /**
   * Takes ownership of the dirty cache slice — caller is expected to persist
   * via `saveSettings()`. Returns null when nothing was modified, so the
   * caller can skip the write entirely.
   */
  takeCacheUpdates(): TravelCache | null;
}

export function legKey(origin: string, dest: string): string {
  return `${normalise(origin)}\n${normalise(dest)}`;
}

function normalise(s: string): string {
  return (s || "").trim().toLowerCase();
}

interface ResolverOptions {
  travel: TravelSettings;
  cache: TravelCache;
  /** Inject a custom client for testing; defaults to the env-keyed OpenRouteService client. */
  client?: RoutingProviderClient | null;
  /** Override "now" for deterministic tests. */
  nowMs?: number;
}

/**
 * Construct a LegResolver wired to the user's travel settings + cache.
 *
 * The resolver is stateful and short-lived (one per page render). It tracks
 * which legs were touched so the caller can persist updates without
 * stomping unrelated cache entries.
 */
export function createLegResolver(options: ResolverOptions): LegResolver {
  const { travel, cache } = options;
  const nowMs = options.nowMs ?? Date.now();
  const providerCutoffMs = nowMs + PROVIDER_LOOKAHEAD_MS;
  const fallbackMin = travel.fallbackDurationMinutes;
  const staleMs = travel.routingStaleAfterDays * DAY_MS;
  const callBudget = travel.routingMaxCallsPerRender;
  const provider =
    travel.routingProvider === "openrouteservice"
      ? options.client ?? createOpenRouteServiceProvider()
      : null;

  // Snapshot cache as mutable maps so we can record dirty state precisely.
  const legs = new Map<string, TravelLegState>(Object.entries(cache.legs ?? {}));
  const geocodes = new Map(Object.entries(cache.geocodes ?? {}));
  let dirty = false;

  function isFresh(state: TravelLegState | undefined): boolean {
    if (!state) return false;
    if (state.usedFallback) return false;
    return nowMs - state.lastCheckedMs < staleMs;
  }

  return {
    async resolveMany(requests) {
      const result = new Map<string, number | null>();

      // 1. Dedupe by legKey, keeping the earliest priority. Fixed legs
      //    (gym) short-circuit straight to the result map without ever
      //    touching cache or provider.
      const unique = new Map<string, ResolveRequest>();
      for (const req of requests) {
        const key = legKey(req.origin, req.dest);
        if (req.fixedMinutes != null) {
          result.set(key, req.fixedMinutes);
          continue;
        }
        const existing = unique.get(key);
        const reqPriority = req.priorityTimeMs ?? Infinity;
        const exPriority = existing?.priorityTimeMs ?? Infinity;
        if (!existing || reqPriority < exPriority) unique.set(key, req);
      }

      // 2. Stale-or-missing queue, sorted soonest-first so urgent legs
      //    get the budget when it's tight.
      //
      //    OpenRouteService quota guard:
      //    only consider provider calls for legs whose priority time falls
      //    within the next 7 days; later legs intentionally remain fallback.
      const staleQueue: ResolveRequest[] = [];
      for (const req of unique.values()) {
        const key = legKey(req.origin, req.dest);
        const state = legs.get(key);
        if (state) result.set(key, state.durationMin);
        const withinProviderLookahead =
          req.priorityTimeMs !== undefined && req.priorityTimeMs <= providerCutoffMs;
        if (!isFresh(state) && withinProviderLookahead) staleQueue.push(req);
      }
      staleQueue.sort((a, b) => (a.priorityTimeMs ?? Infinity) - (b.priorityTimeMs ?? Infinity));

      // 3. Spend the call budget on the most-urgent stale legs.
      if (provider) {
        let spent = 0;
        for (const req of staleQueue) {
          if (spent >= callBudget) break;
          const key = legKey(req.origin, req.dest);
          spent += 1;
          try {
            const duration = await provider.duration(
              req.origin,
              req.dest,
              { geocodes }
            );
            if (duration != null && duration > 0) {
              const state: TravelLegState = {
                durationMin: duration,
                lastCheckedMs: nowMs,
                usedFallback: false
              };
              legs.set(key, state);
              result.set(key, duration);
              dirty = true;
            } else {
              // Provider returned no result — record fallback so we don't keep retrying.
              const state: TravelLegState = {
                durationMin: legs.get(key)?.durationMin ?? fallbackMin,
                lastCheckedMs: nowMs,
                usedFallback: true
              };
              legs.set(key, state);
              if (!result.has(key)) result.set(key, state.durationMin);
              dirty = true;
            }
          } catch {
            // Network/auth failure — leave existing cache untouched, mark fallback.
            const existing = legs.get(key);
            const fallback: TravelLegState = {
              durationMin: existing?.durationMin ?? fallbackMin,
              lastCheckedMs: existing?.lastCheckedMs ?? 0,
              usedFallback: true
            };
            legs.set(key, fallback);
            if (!result.has(key)) result.set(key, fallback.durationMin);
            dirty = true;
          }
        }
      }

      // 4. Anything still missing falls back to "use config fallback".
      for (const req of unique.values()) {
        const key = legKey(req.origin, req.dest);
        if (!result.has(key)) result.set(key, null);
      }
      return result;
    },

    takeCacheUpdates() {
      if (!dirty) return null;
      return {
        legs: Object.fromEntries(legs),
        geocodes: Object.fromEntries(geocodes)
      };
    }
  };
}

/** Convert a duration map's value to minutes, falling back when null. */
export function durationOrFallback(
  durations: Map<string, number | null>,
  origin: string,
  dest: string,
  fallbackMin: number
): number {
  const v = durations.get(legKey(origin, dest));
  return v == null ? fallbackMin : v;
}

export { MINUTE_MS };
