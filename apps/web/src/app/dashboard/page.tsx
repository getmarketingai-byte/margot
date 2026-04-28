import Link from "next/link";
import { auth } from "@/lib/auth";
import { loadSettings } from "@/lib/settings-store";
import { loadLatestSnapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const session = await auth();
  const userId = session!.user!.id!;
  const [settings, snapshot] = await Promise.all([
    loadSettings(userId),
    loadLatestSnapshot(userId)
  ]);

  const eventCount = snapshot?.events.length ?? 0;
  const lastGenerated = snapshot
    ? new Date(snapshot.generatedAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "never";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <section className="grid gap-3 sm:grid-cols-2">
        <Stat label="Connected calendars" value={String(settings.calendars.sources.length)} />
        <Stat label="Scheduling window" value={`${settings.calendars.schedulingWindowDays} days`} />
        <Stat label="Last regenerated" value={lastGenerated} />
        <Stat label="Events in latest snapshot" value={String(eventCount)} />
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/goals" className="btn-primary">Plan this week</Link>
          <Link href="/dashboard/calendars" className="btn-secondary">Connect calendars</Link>
          <Link href="/dashboard/frameworks" className="btn-secondary">Frameworks</Link>
          <Link href="/dashboard/feeds" className="btn-secondary">Get iCal URLs</Link>
        </div>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Energy ordering</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
          Mode: <strong>{settings.energyOrdering.mode}</strong>. Preferred sequence:{" "}
          <span>{settings.energyOrdering.preferredSequence.join(" → ")}</span>.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
