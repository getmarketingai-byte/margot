import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ensureFeedToken, type FeedKind } from "@/lib/feeds";
import { generateFeedToken } from "@/lib/feed-token";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const FEEDS: { kind: FeedKind; name: string; description: string }[] = [
  { kind: "all", name: "Everything", description: "All generated events in one feed." },
  { kind: "weekly", name: "Perfect Week goals", description: "Goal blocks + non-negotiable segments." },
  { kind: "timemap", name: "Time map", description: "Routine and time-map events." },
  { kind: "sleep", name: "Sleep", description: "Computed sleep blocks." },
  { kind: "travel", name: "Travel", description: "Drive blocks generated from event locations." }
];

async function rotateFeed(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const kind = String(formData.get("kind") ?? "all") as FeedKind;
  const name = String(formData.get("name") ?? "feed");
  await ensureFeedToken(session.user.id, kind, name, generateFeedToken);
  revalidatePath("/dashboard/feeds");
}

async function feedUrl(userId: string, kind: FeedKind, name: string): Promise<string> {
  const token = await ensureFeedToken(userId, kind, name, generateFeedToken);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/feeds/${token}.ics`;
}

export default async function FeedsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const rows = await Promise.all(
    FEEDS.map(async (f) => ({ ...f, url: await feedUrl(userId, f.kind, f.name) }))
  );

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">iCal feeds</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Subscribe to these URLs in any calendar app — Apple Calendar, Google Calendar (
          <em>From URL</em>), Outlook. Most clients refresh every 5–60 minutes.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {rows.map((f) => (
          <li key={f.kind} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="text-xs text-ink-400">{f.description}</div>
              </div>
              <form action={rotateFeed}>
                <input type="hidden" name="kind" value={f.kind} />
                <input type="hidden" name="name" value={f.name} />
                <button type="submit" className="btn-secondary text-xs">Rotate</button>
              </form>
            </div>
            <input
              readOnly
              className="field mt-2 select-all font-mono text-xs"
              value={f.url}
              aria-label={`${f.name} ICS URL`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
