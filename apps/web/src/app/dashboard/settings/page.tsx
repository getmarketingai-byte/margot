import { revalidatePath } from "next/cache";
import { routingProviderSchema } from "@calendar-automations/schema";
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

async function updateTravel(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);

  const homeAddressRaw = String(formData.get("homeAddress") ?? "").trim();
  const providerRaw = String(formData.get("routingProvider") ?? settings.travel.routingProvider);
  const providerParsed = routingProviderSchema.safeParse(providerRaw);
  const provider = providerParsed.success ? providerParsed.data : settings.travel.routingProvider;

  const next = {
    ...settings,
    travel: {
      ...settings.travel,
      homeAddress: homeAddressRaw === "" ? undefined : homeAddressRaw,
      routingProvider: provider,
      routingMaxCallsPerRender: Math.max(
        0,
        Math.min(
          200,
          Number(formData.get("routingMaxCallsPerRender") ?? settings.travel.routingMaxCallsPerRender)
        )
      )
    }
  };
  // When the user clears their home address or disables the provider we wipe
  // the per-leg cache so stale durations against the old origin can't sneak
  // back in. Geocodes are kept (they're keyed by address, not provider).
  const wipeLegs = !next.travel.homeAddress || next.travel.routingProvider === "disabled";
  if (wipeLegs) {
    next.travelCache = { ...settings.travelCache, legs: {} };
  }
  await saveSettings(userId, next);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/plan");
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

      <section className="card">
        <h2 className="text-sm font-semibold">Travel & routing</h2>
        <p className="mt-1 text-xs text-ink-400">
          We compute drive blocks around physical events. Add a home address and pick a routing
          provider for real durations — otherwise we fall back to a flat estimate.
        </p>
        <form action={updateTravel} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            Home address
            <textarea
              name="homeAddress"
              rows={2}
              defaultValue={settings.travel.homeAddress ?? ""}
              placeholder="e.g. 123 Example St, Melbourne VIC 3000  —  or  -37.910156,145.107420"
              className="field"
            />
            <span className="text-[11px] text-ink-400">
              Used as the origin/destination for every drive leg. Leave blank to disable real
              duration lookups.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Routing provider
            <select
              name="routingProvider"
              defaultValue={settings.travel.routingProvider}
              className="field"
            >
              <option value="disabled">Disabled (fallback estimate only)</option>
              <option value="openrouteservice">OpenRouteService (free tier)</option>
            </select>
            <span className="text-[11px] text-ink-400">
              Server needs <code>OPENROUTESERVICE_API_KEY</code> for live lookups; otherwise drives
              quietly stay at the fallback duration.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Max provider calls per render
            <input
              name="routingMaxCallsPerRender"
              type="number"
              min={0}
              max={200}
              defaultValue={settings.travel.routingMaxCallsPerRender}
              className="field"
            />
            <span className="text-[11px] text-ink-400">
              Caps cost on the free tier. Stale legs are refreshed soonest-event-first.
            </span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full">Save travel settings</button>
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
