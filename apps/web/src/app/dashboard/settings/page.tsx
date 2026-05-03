import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { routingProviderSchema, type GeocodeCacheEntry } from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { loadBillingState } from "@/lib/billing-state-server";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { geocodeAddressToCoords } from "@/lib/geocode-address";
import {
  formatIdealWakeForInput,
  formatSleepDurationForInput,
  parseIdealWakeInput,
  parseSleepDurationInput
} from "@/lib/parse-sleep-settings-input";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { PRODUCT } from "@/lib/marketing";
import { FeedbackForm } from "./feedback-form";
import { TravelSettingsForm } from "./travel-settings-form";

export const dynamic = "force-dynamic";

async function updateBasics(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const billing = await loadBillingState(userId);
  let scheduleHorizonWeeks = settings.calendars.scheduleHorizonWeeks;
  if (billing.mode === "subscription" || billing.mode === "bypass") {
    scheduleHorizonWeeks = Math.max(
      1,
      Math.min(
        8,
        Number(formData.get("scheduleHorizonWeeks") ?? settings.calendars.scheduleHorizonWeeks)
      )
    );
  }
  const idealWake = parseIdealWakeInput(String(formData.get("idealWakeTime") ?? ""), {
    hour: settings.sleep.idealWakeHour,
    minute: settings.sleep.idealWakeMinute
  });
  const next = {
    ...settings,
    timezone: String(formData.get("timezone") ?? settings.timezone),
    calendars: {
      ...settings.calendars,
      schedulingWindowDays: Math.max(
        7,
        Math.min(365, Number(formData.get("schedulingWindowDays") ?? settings.calendars.schedulingWindowDays))
      ),
      scheduleHorizonWeeks
    },
    sleep: {
      ...settings.sleep,
      durationHours: Math.max(
        4,
        Math.min(
          12,
          parseSleepDurationInput(
            String(formData.get("sleepDuration") ?? ""),
            settings.sleep.durationHours
          )
        )
      ),
      idealWakeHour: idealWake.hour,
      idealWakeMinute: idealWake.minute
    }
  };
  await saveSettings(userId, next);
  revalidatePath("/dashboard/settings");
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

async function updateTravel(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);

  const homeAddressRaw = String(formData.get("homeAddress") ?? "").trim();
  const providerRaw = String(formData.get("routingProvider") ?? settings.travel.routingProvider);
  const providerParsed = routingProviderSchema.safeParse(providerRaw);
  const provider = providerParsed.success ? providerParsed.data : settings.travel.routingProvider;

  const needHome = provider !== "disabled" || settings.weather.enabled;
  if (needHome && homeAddressRaw === "") {
    redirect("/dashboard/settings?e=home_required");
  }

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

  if (homeAddressRaw) {
    const geoMap = new Map<string, GeocodeCacheEntry>(
      Object.entries(next.travelCache?.geocodes ?? {}) as [string, GeocodeCacheEntry][]
    );
    const resolved = await geocodeAddressToCoords(homeAddressRaw, geoMap, Date.now());
    if (resolved) {
      next.weather = { ...next.weather, latitude: resolved.lat, longitude: resolved.lng };
      next.travelCache = { ...next.travelCache, geocodes: Object.fromEntries(geoMap) };
    }
  }

  await saveSettings(userId, next);
  revalidatePath("/dashboard/settings");
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

async function updateWeather(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);

  const weatherEnabled = formData.get("weather_enabled") === "on";
  if (weatherEnabled && !settings.travel.homeAddress?.trim()) {
    redirect("/dashboard/settings?e=weather_needs_home");
  }

  const next = {
    ...settings,
    weather: {
      ...settings.weather,
      enabled: weatherEnabled,
      niceWeather: {
        ...settings.weather.niceWeather,
        maxRainProbabilityPercent: Math.max(
          0,
          Math.min(
            100,
            Number(
              formData.get("maxRainProbabilityPercent") ??
                settings.weather.niceWeather.maxRainProbabilityPercent
            )
          )
        ),
        minTempC: Math.max(-20, Math.min(50, Number(formData.get("minTempC") ?? settings.weather.niceWeather.minTempC))),
        maxTempC: Math.max(-20, Math.min(60, Number(formData.get("maxTempC") ?? settings.weather.niceWeather.maxTempC))),
        maxWindKmh: Math.max(
          0,
          Math.min(200, Number(formData.get("maxWindKmh") ?? settings.weather.niceWeather.maxWindKmh))
        ),
        maxUv: Math.max(0, Math.min(20, Number(formData.get("maxUv") ?? settings.weather.niceWeather.maxUv)))
      },
      useSunriseSunsetBeyondForecast: formData.get("useSunriseSunsetBeyondForecast") === "on",
      extendInsideOutsideBeyondForecast: formData.get("extendInsideOutsideBeyondForecast") === "on"
    }
  };

  await saveSettings(userId, next);
  revalidatePath("/dashboard/settings");
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

const SETTINGS_BANNERS: Record<string, string> = {
  home_required:
    "Add a home address (or disable weather-based outside blocks and routing) before saving travel settings.",
  weather_needs_home:
    "Save a home address under Travel & routing before enabling weather-based outside blocks — forecasts use that location."
};

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const billing = await loadBillingState(userId);
  const canPickScheduleHorizonWeeks = billing.mode === "subscription" || billing.mode === "bypass";
  const params = await searchParams;
  const banner = params.e ? SETTINGS_BANNERS[params.e] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Account-level basics. Changes regenerate your iCal feed on the next refresh.
        </p>
      </header>

      {banner ? (
        <div
          className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          {banner}
        </div>
      ) : null}

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
            <span className="text-[11px] font-normal text-ink-400">
              How far ahead we fetch calendar busy data and weather overlays — separate from planned
              goal weeks below.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Weeks of planned goals
            <select
              name="scheduleHorizonWeeks"
              defaultValue={settings.calendars.scheduleHorizonWeeks}
              disabled={!canPickScheduleHorizonWeeks}
              className="field disabled:cursor-not-allowed disabled:opacity-60"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
                <option key={w} value={w}>
                  {w} {w === 1 ? "week" : "weeks"}
                </option>
              ))}
            </select>
            {!canPickScheduleHorizonWeeks ? (
              <span className="text-[11px] font-normal text-ink-400">
                Trial plans up to 7 days ahead. Subscribe to unlock 1–8 weeks in Perfect Week preview
                and iCal goal blocks.
              </span>
            ) : (
              <span className="text-[11px] font-normal text-ink-400">
                How many ISO weeks of proposed goal blocks we compute for My Perfect Week and your
                feeds (default 2).
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Sleep duration
            <input
              name="sleepDuration"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="8 or 7:30"
              defaultValue={formatSleepDurationForInput(settings.sleep.durationHours)}
              className="field"
            />
            <span className="text-[11px] font-normal text-ink-400">
              Hours as a number (8) or hours and minutes (7:30 → 7h 30m).
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Ideal wake time
            <input
              name="idealWakeTime"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="6:30am"
              defaultValue={formatIdealWakeForInput(
                settings.sleep.idealWakeHour,
                settings.sleep.idealWakeMinute
              )}
              className="field"
            />
            <span className="text-[11px] font-normal text-ink-400">
              12-hour (6:30am) or 24-hour (06:30).
            </span>
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
          provider for real durations — otherwise we fall back to a flat estimate. The same address
          is used for Open-Meteo forecasts when weather-based outside blocks are on (coordinates are
          saved with your weather settings when you save here).
        </p>
        <TravelSettingsForm
          key={[
            settings.travel.routingProvider,
            settings.travel.homeAddress ?? "",
            settings.weather.enabled,
            settings.travel.routingMaxCallsPerRender
          ].join("|")}
          updateTravel={updateTravel}
          defaultHomeAddress={settings.travel.homeAddress ?? ""}
          defaultRoutingProvider={settings.travel.routingProvider}
          defaultRoutingMaxCalls={settings.travel.routingMaxCallsPerRender}
          weatherEnabled={settings.weather.enabled}
        />
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Weather suitability for outside blocks</h2>
        <p className="mt-1 text-xs text-ink-400">
          These thresholds decide when an hour is considered suitable for <code>[Outside]</code>.
          Forecasts use your <span className="font-medium text-ink-700 dark:text-ink-200">home address</span>{" "}
          from Travel
          {" & "}routing (coordinates update when you save that section). When this is enabled, a home
          address is required.
        </p>
        <form action={updateWeather} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input type="checkbox" name="weather_enabled" defaultChecked={settings.weather.enabled} />
            <span>Enable weather-based outside blocks</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Max rain probability (%)
            <input
              name="maxRainProbabilityPercent"
              type="number"
              min={0}
              max={100}
              defaultValue={settings.weather.niceWeather.maxRainProbabilityPercent}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Min temperature (C)
            <input
              name="minTempC"
              type="number"
              min={-20}
              max={50}
              step={0.5}
              defaultValue={settings.weather.niceWeather.minTempC}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Max temperature (C)
            <input
              name="maxTempC"
              type="number"
              min={-20}
              max={60}
              step={0.5}
              defaultValue={settings.weather.niceWeather.maxTempC}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Max wind (km/h)
            <input
              name="maxWindKmh"
              type="number"
              min={0}
              max={200}
              step={1}
              defaultValue={settings.weather.niceWeather.maxWindKmh}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Max UV index
            <input
              name="maxUv"
              type="number"
              min={0}
              max={20}
              step={0.5}
              defaultValue={settings.weather.niceWeather.maxUv}
              className="field"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="useSunriseSunsetBeyondForecast"
              defaultChecked={settings.weather.useSunriseSunsetBeyondForecast}
            />
            <span>Use sunrise/sunset beyond forecast horizon</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="extendInsideOutsideBeyondForecast"
              defaultChecked={settings.weather.extendInsideOutsideBeyondForecast}
            />
            <span>Extend inside/outside beyond forecast horizon</span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full">Save weather settings</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Bug or feature request</h2>
        <p className="mt-1 text-xs text-ink-400">
          Found a bug or have an idea? This opens your mail client with the details prefilled so
          you can review and send.
        </p>
        <FeedbackForm contactEmail={PRODUCT.contactEmail} userEmail={session?.user?.email ?? null} />
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
