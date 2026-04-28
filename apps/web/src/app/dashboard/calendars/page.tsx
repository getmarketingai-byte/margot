import { auth } from "@/lib/auth";
import { listGoogleCalendars } from "@/lib/google-calendar";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

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
          {calendars.map((c) => {
            const isSelected = selected.has(c.id);
            return (
              <li key={c.id} className="card flex items-center justify-between gap-3">
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
