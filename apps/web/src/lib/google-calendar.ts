/**
 * Live Google Calendar `events.list` projection into planner busy intervals (plus
 * invert-free-busy availability windows). Route handlers should prefer
 * `fetchGoogleBusy` from `@/lib/google-busy-cache`, which serves Postgres first and
 * refreshes in the background.
 */

import { google, type calendar_v3 } from "googleapis";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { freeGaps, mergeIntervals, type BusyEvent, type Interval } from "@calendar-automations/planner";
import {
  calendarBusyModeForSource,
  normaliseCalendarSource,
  type CalendarSource
} from "@calendar-automations/schema";
import { db, schema } from "./db/index";

type AccountRow = InferSelectModel<typeof schema.accounts>;

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
};

export type ListGoogleCalendarsResult =
  | { ok: true; calendars: GoogleCalendarListEntry[] }
  | {
      ok: false;
      code: "database_error" | "missing_tokens" | "google_api_error";
      /** For server logs / support; not shown verbatim to users */
      detail?: string;
    };

function googleApiErrorDetail(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

async function selectGoogleAccountRow(userId: string): Promise<AccountRow | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.provider, "google")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * google-auth-library treats an empty `access_token` differently from omitting it.
 * With only a refresh token, omit `access_token` so the client can refresh on first use.
 */
function createCalendarOAuthClient(row: AccountRow) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  const access_token = row.access_token?.trim() || undefined;
  const refresh_token = row.refresh_token?.trim() || undefined;
  oauth.setCredentials({
    ...(access_token ? { access_token } : {}),
    ...(refresh_token ? { refresh_token } : {}),
    expiry_date:
      row.expires_at !== null && row.expires_at !== undefined ? row.expires_at * 1000 : undefined
  });

  if (db) {
    oauth.on("tokens", (tokens) => {
      void (async () => {
        const patch: Partial<Pick<AccountRow, "access_token" | "expires_at" | "refresh_token">> = {};
        if (tokens.access_token) patch.access_token = tokens.access_token;
        if (tokens.expiry_date != null) patch.expires_at = Math.floor(tokens.expiry_date / 1000);
        if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token;
        if (Object.keys(patch).length === 0) return;
        try {
          await db!
            .update(schema.accounts)
            .set(patch)
            .where(
              and(
                eq(schema.accounts.provider, row.provider),
                eq(schema.accounts.providerAccountId, row.providerAccountId)
              )
            );
        } catch (persistErr) {
          console.error("[google-calendar] failed to persist refreshed OAuth tokens", persistErr);
        }
      })();
    });
  }

  return oauth;
}

export async function listGoogleCalendars(userId: string): Promise<ListGoogleCalendarsResult> {
  let row: AccountRow | null;
  try {
    row = await selectGoogleAccountRow(userId);
  } catch (err) {
    console.error("[google-calendar] failed to load account row", err);
    return {
      ok: false,
      code: "database_error",
      detail: googleApiErrorDetail(err)
    };
  }

  if (!row) return { ok: true, calendars: [] };

  const access = row.access_token?.trim() ?? "";
  const refresh = row.refresh_token?.trim() ?? "";
  if (!access && !refresh) {
    return { ok: false, code: "missing_tokens" };
  }

  try {
    const auth = createCalendarOAuthClient(row);
    const cal = google.calendar({ version: "v3", auth });
    const res = await cal.calendarList.list({ maxResults: 250 });
    const items = res.data.items ?? [];
    const calendars = items
      .filter((c): c is calendar_v3.Schema$CalendarListEntry & { id: string; summary: string } =>
        Boolean(c.id) && Boolean(c.summary)
      )
      .map((c) => ({
        id: c.id,
        summary: c.summary,
        ...(c.primary ? { primary: c.primary } : {}),
        ...(c.backgroundColor ? { backgroundColor: c.backgroundColor } : {})
      }));
    return { ok: true, calendars };
  } catch (err) {
    console.error("[google-calendar] calendarList.list failed", err);
    return {
      ok: false,
      code: "google_api_error",
      detail: googleApiErrorDetail(err)
    };
  }
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
  let row: AccountRow | null;
  try {
    row = await selectGoogleAccountRow(userId);
  } catch (err) {
    console.error("[google-calendar] fetchGoogleBusyLive: account query failed", err);
    return { busyEvents: [], goalAvailabilityWindows: {} };
  }
  if (!row) return { busyEvents: [], goalAvailabilityWindows: {} };
  const access = row.access_token?.trim() ?? "";
  const refresh = row.refresh_token?.trim() ?? "";
  if (!access && !refresh) return { busyEvents: [], goalAvailabilityWindows: {} };

  const auth = createCalendarOAuthClient(row);
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
        const summary = (ev.summary ?? "").trim();
        busyEvents.push({
          sourceId: `${normalized.externalId}:${ev.id}`,
          title: summary,
          calendarDisplayName: normalized.displayName,
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
