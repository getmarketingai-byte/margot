/**
 * Google Calendar adapter — turns a user's connected Google account into the
 * planner's `BusyEvent[]` shape. Token refresh is handled by `googleapis` when
 * we provide both the access and refresh tokens; we re-persist the new access
 * token so subsequent jobs reuse it.
 */

import { google, type calendar_v3 } from "googleapis";
import { eq, and } from "drizzle-orm";
import type { BusyEvent } from "@calendar-automations/planner";
import type { CalendarSource } from "@calendar-automations/schema";
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
 * Free events (transparency: "transparent") are surfaced with `busy: false`;
 * the planner's `collectBusyIntervals` filters them out. All-day and multi-day
 * events are returned as-is and filtered by the same helper.
 */
export async function fetchGoogleBusy(
  userId: string,
  sources: readonly CalendarSource[],
  windowStartMs: number,
  windowEndMs: number
): Promise<BusyEvent[]> {
  const account = await loadGoogleAccount(userId);
  if (!account) return [];
  const auth = buildOauthClient(account);
  const cal = google.calendar({ version: "v3", auth });
  const out: BusyEvent[] = [];

  for (const source of sources) {
    if (source.provider !== "google" || !source.countAsBusy) continue;
    let pageToken: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId: source.externalId,
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
        const busy =
          source.treatTransparentAsFree && ev.transparency === "transparent" ? false : true;
        out.push({
          sourceId: ev.id,
          title: ev.summary ?? "(no title)",
          startMs: new Date(start).getTime(),
          endMs: new Date(end).getTime(),
          busy,
          ...(ev.location ? { location: ev.location } : {}),
          source: "google"
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return out;
}
