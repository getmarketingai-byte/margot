import { auth } from "@/lib/auth";
import { listGoogleCalendars } from "@/lib/google-calendar";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

type BusyHandlingMode = "ignore" | "busy-only" | "all-events";

async function toggleCalendar(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
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
      countAsBusy: true,
      treatTransparentAsFree: true
    });
  }
  await saveSettings(userId, { ...settings, calendars: { ...settings.calendars, sources } });
  revalidatePath("/dashboard/calendars");
}

async function updateCalendarOptions(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const externalId = String(formData.get("externalId") ?? "");
  const color = String(formData.get("color") ?? "");
  const busyMode = String(formData.get("busyMode") ?? "busy-only") as BusyHandlingMode;
  if (!externalId) return;

  const settings = await loadSettings(userId);
  const sources = [...settings.calendars.sources];
  const index = sources.findIndex((s) => s.externalId === externalId && s.provider === "google");
  if (index < 0) return;

  const source = sources[index]!;
  const nextColor = color.trim();
  const colorValue = nextColor ? nextColor : undefined;
  const countAsBusy = busyMode !== "ignore";
  const treatTransparentAsFree = busyMode !== "all-events";

  sources[index] = {
    ...source,
    ...(colorValue ? { color: colorValue } : {}),
    ...(!colorValue ? { color: undefined } : {}),
    countAsBusy,
    treatTransparentAsFree
  };

  await saveSettings(userId, { ...settings, calendars: { ...settings.calendars, sources } });
  revalidatePath("/dashboard/calendars");
}

export default async function CalendarsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
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

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Calendars</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Choose which Google calendars count as busy time when allocating goals.
        </p>
      </header>

      {calendarsLoadError ? (
        <p className="card text-sm">
          We could not load your Google calendars. You are signed in, but your Google account tokens
          could not be read. Run DB migrations for the same production `DATABASE_URL`, then sign out
          and sign in again.
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
            const busyMode: BusyHandlingMode = !source?.countAsBusy
              ? "ignore"
              : source.treatTransparentAsFree
                ? "busy-only"
                : "all-events";
            const colorValue = source?.color ?? c.backgroundColor ?? "#9aa0a6";
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
                  <form action={updateCalendarOptions} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="externalId" value={c.id} />
                    <label className="flex flex-col gap-1 text-xs text-ink-500">
                      Display color
                      <input
                        type="color"
                        name="color"
                        defaultValue={colorValue}
                        className="h-9 w-14 rounded border border-ink-200 bg-transparent p-1 dark:border-ink-700"
                      />
                    </label>
                    <label className="flex min-w-56 flex-col gap-1 text-xs text-ink-500">
                      Free/busy handling
                      <select
                        name="busyMode"
                        defaultValue={busyMode}
                        className="h-9 rounded border border-ink-200 bg-white px-2 text-sm text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                      >
                        <option value="busy-only">Only events marked busy block time</option>
                        <option value="all-events">All events block time</option>
                        <option value="ignore">Ignore this calendar for planning</option>
                      </select>
                    </label>
                    <button type="submit" className="btn-secondary">
                      Save options
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
