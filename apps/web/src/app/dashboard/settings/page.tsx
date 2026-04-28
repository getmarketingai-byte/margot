import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { loadSettings, saveSettings } from "@/lib/settings-store";

export const dynamic = "force-dynamic";

async function updateBasics(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const next = {
    ...settings,
    timezone: String(formData.get("timezone") ?? settings.timezone),
    calendars: {
      ...settings.calendars,
      schedulingWindowDays: Math.max(
        7,
        Math.min(365, Number(formData.get("schedulingWindowDays") ?? settings.calendars.schedulingWindowDays))
      )
    },
    sleep: {
      ...settings.sleep,
      durationHours: Math.max(4, Math.min(12, Number(formData.get("sleepDuration") ?? settings.sleep.durationHours))),
      idealWakeHour: Math.max(0, Math.min(23, Number(formData.get("idealWakeHour") ?? settings.sleep.idealWakeHour)))
    }
  };
  await saveSettings(userId, next);
  revalidatePath("/dashboard/settings");
}

export default async function SettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Account-level basics. Changes regenerate your iCal feed on the next refresh.
        </p>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold">Basics</h2>
        <form action={updateBasics} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            Timezone
            <input name="timezone" defaultValue={settings.timezone} className="field" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Scheduling window (days)
            <input
              name="schedulingWindowDays"
              type="number"
              min={7}
              max={365}
              defaultValue={settings.calendars.schedulingWindowDays}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Sleep duration (hours)
            <input
              name="sleepDuration"
              type="number"
              min={4}
              max={12}
              step={0.25}
              defaultValue={settings.sleep.durationHours}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Ideal wake hour (0–23)
            <input
              name="idealWakeHour"
              type="number"
              min={0}
              max={23}
              defaultValue={settings.sleep.idealWakeHour}
              className="field"
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full">Save</button>
          </div>
        </form>
      </section>

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Advanced JSON</summary>
        <pre className="mt-2 overflow-auto rounded bg-ink-100 p-2 text-xs dark:bg-ink-900/40">
{JSON.stringify(settings, null, 2)}
        </pre>
      </details>
    </div>
  );
}
