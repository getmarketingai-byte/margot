import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { db, schema } from "@/lib/db";
import { generateFeedToken } from "@/lib/feed-token";
import { ensureFeedToken, type FeedKind } from "@/lib/feeds";
import { listGoogleCalendars } from "@/lib/google-calendar";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import {
  calendarBusyModeForSource,
  normaliseCalendarSource,
  weeklyIntentSchema,
  type CalendarSource,
  type WeeklyPlan
} from "@calendar-automations/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { CalendarOptionsForm } from "../calendar-options-form";
import { CalendarsPageTabs } from "./calendars-page-tabs";

export const dynamic = "force-dynamic";

type BusyHandlingMode = "ignore" | "busy-only" | "all-events" | "invert-free-busy";

interface GoalOption {
  id: string;
  title: string;
}

const FEEDS: { kind: FeedKind; name: string; description: string }[] = [
  { kind: "all", name: "Everything", description: "All generated events in one feed." },
  { kind: "weekly", name: "Perfect Week goals", description: "Goal blocks + non-negotiable segments." },
  { kind: "timemap", name: "Time map", description: "Routine and time-map events." },
  { kind: "sleep", name: "Sleep", description: "Computed sleep blocks." },
  { kind: "travel", name: "Travel", description: "Drive blocks generated from event locations." }
];

async function loadGoalOptions(userId: string): Promise<GoalOption[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return [];
  const goals = ((row.data as WeeklyPlan).goals ?? [])
    .filter((goal) => goal.id && goal.title)
    .map((goal) => ({ id: goal.id, title: goal.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return goals;
}

async function toggleCalendar(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const externalId = String(formData.get("externalId") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  if (!externalId) return;
  const settings = await loadSettings(userId);
  const sources = [...settings.calendars.sources];
  const index = sources.findIndex((s) => s.externalId === externalId && s.provider === "google");
  if (index >= 0) {
    sources.splice(index, 1);
  } else {
    sources.push({
      id: `google:${externalId}`,
      provider: "google",
      externalId,
      displayName,
      busyMode: "busy-only",
      countAsBusy: true,
      treatTransparentAsFree: true
    });
  }
  await saveSettings(userId, { ...settings, calendars: { ...settings.calendars, sources } });
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
  revalidatePath("/dashboard/calendars");
}

async function updateCalendarOptions(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const externalId = String(formData.get("externalId") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const color = String(formData.get("color") ?? "");
  const busyMode = String(formData.get("busyMode") ?? "busy-only") as BusyHandlingMode;
  const invertedTimemapLabelRaw = String(formData.get("invertedTimemapLabel") ?? "").trim();
  if (!externalId) return;

  const settings = await loadSettings(userId);
  const sources = [...settings.calendars.sources];
  const index = sources.findIndex((s) => s.externalId === externalId && s.provider === "google");
  if (index < 0) return;

  const source = sources[index]!;
  const nextColor = color.trim();
  const colorValue = nextColor ? nextColor : undefined;
  let availabilityGoalId = source.availabilityGoalId;
  if (busyMode === "invert-free-busy") {
    const fallbackTitle = displayName ? `${displayName} available` : "";
    availabilityGoalId = await ensureInvertedTimemapPlanEntry({
      userId,
      timezone: settings.timezone,
      title: invertedTimemapLabelRaw || fallbackTitle,
      existingGoalId: source.availabilityGoalId
    });
  } else {
    availabilityGoalId = undefined;
  }
  const mode: BusyHandlingMode = busyMode;

  const updated: CalendarSource = {
    ...source,
    ...(colorValue ? { color: colorValue } : {}),
    ...(!colorValue ? { color: undefined } : {}),
    busyMode: mode,
    availabilityGoalId: mode === "invert-free-busy" ? availabilityGoalId : undefined,
    countAsBusy: mode === "busy-only" || mode === "all-events",
    treatTransparentAsFree: mode !== "all-events"
  };
  sources[index] = normaliseCalendarSource(updated);

  await saveSettings(userId, { ...settings, calendars: { ...settings.calendars, sources } });
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
  revalidatePath("/dashboard/calendars");
}

interface EnsureInvertedTimemapPlanEntryArgs {
  userId: string;
  timezone: string;
  title: string;
  existingGoalId?: string;
}

function thisMondayIso(): string {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7;
  const mon = new Date(now.getTime() - dow * 24 * 60 * 60 * 1000);
  return mon.toISOString().slice(0, 10);
}

async function ensureInvertedTimemapPlanEntry(
  args: EnsureInvertedTimemapPlanEntryArgs
): Promise<string | undefined> {
  if (!db) return args.existingGoalId;
  const title = args.title.trim();
  if (!title) return args.existingGoalId;

  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, args.userId))
    .limit(1);
  const row = rows[0];
  const weekStart = thisMondayIso();
  const blank = weeklyIntentSchema.parse({});
  const base: WeeklyPlan = row
    ? ({
        ...(row.data as WeeklyPlan),
        id: row.id,
        weekStart,
        timezone: args.timezone,
        goals: (row.data as WeeklyPlan).goals ?? [],
        goalGroups: (row.data as WeeklyPlan).goalGroups ?? [],
        overrides: (row.data as WeeklyPlan).overrides ?? [],
        weeklyIntent: weeklyIntentSchema.parse(
          (row.data as Partial<WeeklyPlan>).weeklyIntent ?? {}
        )
      } as WeeklyPlan)
    : {
        id: crypto.randomUUID(),
        weekStart,
        timezone: args.timezone,
        goals: [],
        goalGroups: [],
        overrides: [],
        weeklyIntent: blank
      };

  const existing = base.goals.find((goal) => goal.title.trim().toLowerCase() === title.toLowerCase());
  if (existing) return existing.id;

  const goal = {
    id: crypto.randomUUID(),
    title,
    specialGoalType: "inverted-timemap" as const,
    energyMode: "neutral" as const,
    energyPolarity: "neutral" as const,
    attentionMode: "unspecified" as const,
    workLayer: "unspecified" as const,
    ppfHorizon: "unspecified" as const,
    commitmentLevel: "committed" as const
  };
  const next: WeeklyPlan = { ...base, goals: [...base.goals, goal] };
  if (row) {
    await db
      .update(schema.weeklyPlans)
      .set({ data: next, weekStart: next.weekStart, timezone: next.timezone, updatedAt: new Date() })
      .where(eq(schema.weeklyPlans.id, row.id));
  } else {
    await db.insert(schema.weeklyPlans).values({
      id: next.id,
      userId: args.userId,
      weekStart: next.weekStart,
      timezone: next.timezone,
      data: next
    });
  }
  return goal.id;
}

async function rotateFeed(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const kind = String(formData.get("kind") ?? "all") as FeedKind;
  const name = String(formData.get("name") ?? "feed");
  await ensureFeedToken(session.user.id, kind, name, generateFeedToken);
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard/feeds");
}

async function feedUrl(userId: string, kind: FeedKind, name: string): Promise<string> {
  const token = await ensureFeedToken(userId, kind, name, generateFeedToken);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/feeds/${token}.ics`;
}

export default async function CalendarsPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const goalOptions = await loadGoalOptions(userId);
  let calendars: Awaited<ReturnType<typeof listGoogleCalendars>> = [];
  let calendarsLoadError = false;
  try {
    calendars = await listGoogleCalendars(userId);
  } catch (error) {
    console.error("[calendars] failed to load Google calendars", error);
    calendarsLoadError = true;
  }
  const selected = new Set(
    settings.calendars.sources.filter((s) => s.provider === "google").map((s) => s.externalId)
  );
  const googleSourcesByExternalId = new Map(
    settings.calendars.sources
      .filter((s) => s.provider === "google")
      .map((s) => [s.externalId, s] as const)
  );
  const sortedCalendars = [...calendars].sort((a, b) => {
    const aSelected = selected.has(a.id);
    const bSelected = selected.has(b.id);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.summary.localeCompare(b.summary);
  });
  const feedRows = await Promise.all(
    FEEDS.map(async (feed) => ({ ...feed, url: await feedUrl(userId, feed.kind, feed.name) }))
  );

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Calendars</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Connect Google calendars for busy time, and subscribe to ICS feeds for generated events.
        </p>
      </header>

      <CalendarsPageTabs
        calendarsPanel={
          <>
            <p className="text-sm text-ink-600 dark:text-ink-200">
              Choose which Google calendars count as busy time when allocating goals.
            </p>
            {calendarsLoadError ? (
              <p className="card text-sm">
                We could not load your Google calendars. You are signed in, but your Google account
                tokens could not be read. Run DB migrations for the same production `DATABASE_URL`,
                then sign out and sign in again.
              </p>
            ) : calendars.length === 0 ? (
              <p className="card text-sm">
                No calendars found. Sign in with Google with calendar.readonly scopes and reload.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedCalendars.map((c) => {
                  const isSelected = selected.has(c.id);
                  const source = googleSourcesByExternalId.get(c.id);
                  const normalized = source ? normaliseCalendarSource(source) : undefined;
                  const busyMode: BusyHandlingMode = normalized
                    ? (calendarBusyModeForSource(normalized) as BusyHandlingMode)
                    : "busy-only";
                  const colorValue = source?.color ?? c.backgroundColor ?? "#9aa0a6";
                  const linkedGoalTitle =
                    goalOptions.find((goal) => goal.id === normalized?.availabilityGoalId)?.title ??
                    "";
                  return (
                    <li key={c.id} className="card flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{c.summary}</div>
                          <div className="text-xs text-ink-400">{c.id}</div>
                        </div>
                        <form action={toggleCalendar}>
                          <input type="hidden" name="externalId" value={c.id} />
                          <input type="hidden" name="displayName" value={c.summary} />
                          <button type="submit" className={isSelected ? "btn-primary" : "btn-secondary"}>
                            {isSelected ? "Connected" : "Use"}
                          </button>
                        </form>
                      </div>

                      {isSelected ? (
                        <CalendarOptionsForm
                          action={updateCalendarOptions}
                          externalId={c.id}
                          displayName={c.summary}
                          defaultColor={colorValue}
                          defaultBusyMode={busyMode}
                          defaultInvertedTimemapLabel={linkedGoalTitle}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        }
        feedsPanel={
          <section id="ical-feeds" className="flex flex-col gap-2">
            <header>
              <h2 className="text-xl font-semibold">iCal feeds</h2>
              <p className="text-sm text-ink-600 dark:text-ink-200">
                Subscribe to these URLs in Apple Calendar, Google Calendar (<em>From URL</em>), or
                Outlook. Most clients refresh every 5-60 minutes.
              </p>
            </header>
            <ul className="flex flex-col gap-2">
              {feedRows.map((feed) => (
                <li key={feed.kind} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{feed.name}</div>
                      <div className="text-xs text-ink-400">{feed.description}</div>
                    </div>
                    <form action={rotateFeed}>
                      <input type="hidden" name="kind" value={feed.kind} />
                      <input type="hidden" name="name" value={feed.name} />
                      <button type="submit" className="btn-secondary text-xs">
                        Rotate
                      </button>
                    </form>
                  </div>
                  <input
                    readOnly
                    className="field mt-2 select-all font-mono text-xs"
                    value={feed.url}
                    aria-label={`${feed.name} ICS URL`}
                  />
                </li>
              ))}
            </ul>
          </section>
        }
      />
    </div>
  );
}
