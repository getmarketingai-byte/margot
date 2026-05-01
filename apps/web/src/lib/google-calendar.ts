/**
 * Live Google Calendar `events.list` projection into planner busy intervals (plus
 * invert-free-busy availability windows). Route handlers should prefer
 * `fetchGoogleBusy` from `@/lib/google-busy-cache`, which serves Postgres first and
 * refreshes in the background.
 */

import { google, type calendar_v3 } from "googleapis";
import { eq, and } from "drizzle-orm";
import { freeGaps, mergeIntervals, type BusyEvent, type Interval } from "@calendar-automations/planner";
import {
  calendarBusyModeForSource,
  normaliseCalendarSource,
  type CalendarSource
} from "@calendar-automations/schema";
import { db, schema } from "./db/index";

interface GoogleAccount {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
}

async function loadGoogleAccount(userId: string): Promise<GoogleAccount | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.provider, "google")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    accessToken: row.access_token ?? "",
    refreshToken: row.refresh_token ?? null,
    expiresAt: row.expires_at ?? null
  };
}

function buildOauthClient(account: GoogleAccount) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken ?? undefined,
    expiry_date: account.expiresAt ? account.expiresAt * 1000 : undefined
  });
  return oauth;
}

export async function listGoogleCalendars(userId: string): Promise<
  Array<{ id: string; summary: string; primary?: boolean; backgroundColor?: string }>
> {
  const account = await loadGoogleAccount(userId);
  if (!account) return [];
  const auth = buildOauthClient(account);
  const cal = google.calendar({ version: "v3", auth });
  const res = await cal.calendarList.list({ maxResults: 250 });
  const items = res.data.items ?? [];
  return items
    .filter((c): c is calendar_v3.Schema$CalendarListEntry & { id: string; summary: string } =>
      Boolean(c.id) && Boolean(c.summary)
    )
    .map((c) => ({
      id: c.id,
      summary: c.summary,
      ...(c.primary ? { primary: c.primary } : {}),
      ...(c.backgroundColor ? { backgroundColor: c.backgroundColor } : {})
    }));
}

/**
 * Fetch busy events for the given window from each selected calendar source.
 * Rows titled like `[Sleep][Actual]` are ordinary busy events here; week-blocks
 * treats them as logged sleep so modeled sleep is not stacked on top.
 * Free events (transparency: "transparent") are surfaced with `busy: false`;
 * the planner's `collectBusyIntervals` filters them out. Long events are
 * clipped to each day window (multi-day trips still block each day) unless the
 * clipped slice exceeds 24h.
 */
export async function fetchGoogleBusyLive(
  userId: string,
  sources: readonly CalendarSource[],
  windowStartMs: number,
  windowEndMs: number
): Promise<{ busyEvents: BusyEvent[]; goalAvailabilityWindows: Record<string, Interval[]> }> {
  const account = await loadGoogleAccount(userId);
  if (!account) return { busyEvents: [], goalAvailabilityWindows: {} };
  const auth = buildOauthClient(account);
  const cal = google.calendar({ version: "v3", auth });
  const busyEvents: BusyEvent[] = [];
  const blockedByGoal: Record<string, Interval[]> = {};

  for (const source of sources) {
    const normalized = normaliseCalendarSource(source);
    if (normalized.provider !== "google") continue;
    const mode = calendarBusyModeForSource(normalized);
    if (mode === "ignore") continue;
    let pageToken: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId: normalized.externalId,
        timeMin: new Date(windowStartMs).toISOString(),
        timeMax: new Date(windowEndMs).toISOString(),
        singleEvents: true,
        showDeleted: false,
        maxResults: 2500,
        pageToken
      });
      for (const ev of res.data.items ?? []) {
        const start = ev.start?.dateTime ?? ev.start?.date;
        const end = ev.end?.dateTime ?? ev.end?.date;
        if (!start || !end || !ev.id) continue;
        const startMs = new Date(start).getTime();
        const endMs = new Date(end).getTime();
        if (endMs <= startMs) continue;
        const eventIsBusy = mode === "all-events" ? true : ev.transparency !== "transparent";
        if (mode === "invert-free-busy") {
          const goalId = normalized.availabilityGoalId;
          if (!goalId || !eventIsBusy) continue;
          (blockedByGoal[goalId] ??= []).push({ startMs, endMs });
          // Do not push into `busyEvents`: this calendar is a time-map readout
          // (free vs busy on their calendar), not something that should block the
          // user's own scheduling or appear in the "Existing" layer.
          continue;
        }
        busyEvents.push({
          sourceId: `${normalized.externalId}:${ev.id}`,
          title: ev.summary ?? "(no title)",
          startMs,
          endMs,
          busy: eventIsBusy,
          ...(ev.location ? { location: ev.location } : {}),
          source: "google"
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  const goalAvailabilityWindows: Record<string, Interval[]> = {};
  for (const [goalId, blocked] of Object.entries(blockedByGoal)) {
    const mergedBlocked = mergeIntervals(blocked);
    goalAvailabilityWindows[goalId] = freeGaps(windowStartMs, windowEndMs, mergedBlocked);
  }

  return { busyEvents, goalAvailabilityWindows };
}
