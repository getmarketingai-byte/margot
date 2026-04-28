import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "subscribing-icalendar-apple-calendar";
const article = articleBySlug(SLUG);

export const metadata: Metadata = article
  ? {
      metadataBase: new URL(SITE_URL),
      title: article.title,
      description: article.description,
      keywords: [...article.keywords],
      alternates: { canonical: `/learn/${SLUG}` }
    }
  : {};

export default function Page() {
  if (!article) notFound();
  return (
    <ArticleLayout
      article={article}
      answer="On macOS, open Calendar → File → New Calendar Subscription and paste the feed URL. On iOS / iPadOS, open Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. Apple Calendar lets you set a refresh interval as tight as 15 minutes per subscribed calendar — the tightest of the major calendar apps."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Three places to do it (and why one is preferred)</h2>
      <p>
        Apple Calendar can subscribe to an iCal feed from three surfaces: macOS Calendar, iOS /
        iPadOS Calendar, and the iCloud web Calendar. The macOS path is the most reliable because
        the desktop app exposes the most settings (refresh interval, time zone behavior, alert
        suppression). Subscribing on macOS and letting iCloud sync the subscription to iOS is the
        recommended flow.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">macOS — recommended</h2>
      <ol className="list-decimal pl-5">
        <li>Open Calendar (the built-in app).</li>
        <li>From the menu bar: <code>File → New Calendar Subscription…</code></li>
        <li>
          Paste the HTTPS or webcal:// URL from the Calendar Automations dashboard Feeds page and
          click Subscribe.
        </li>
        <li>
          In the dialog that follows:
          <ul className="mt-2 list-disc pl-5">
            <li>Set a name you will recognize.</li>
            <li>Choose a color.</li>
            <li>
              Choose a location: <strong>iCloud</strong> if you want the subscription to sync to
              all your Apple devices automatically, <strong>On My Mac</strong> if you want the
              subscription to live only on this machine.
            </li>
            <li>
              Set Auto-refresh — &ldquo;Every 15 minutes&rdquo; is the tightest option and a
              reasonable default for an actively-edited planner.
            </li>
            <li>
              Decide whether to remove alerts, attachments, and reminders from the subscription —
              for a planning feed, removing alerts is usually right (the planner does not author
              meaningful alert times).
            </li>
          </ul>
        </li>
        <li>Click OK. The first fetch happens immediately.</li>
      </ol>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">iOS / iPadOS — when you cannot use macOS</h2>
      <ol className="list-decimal pl-5">
        <li>
          Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.
        </li>
        <li>Paste the HTTPS or webcal:// URL.</li>
        <li>Tap Next; iOS attempts to fetch the feed immediately and reports any errors.</li>
        <li>
          On the configuration screen: set the description, decide whether to remove alarms, set
          the &ldquo;Use SSL&rdquo; toggle (on, if your URL is HTTPS).
        </li>
        <li>Tap Save.</li>
      </ol>
      <p>
        On iOS the refresh interval is not surfaced as a per-calendar setting — the system manages
        it globally per the &ldquo;Push&rdquo; / &ldquo;Fetch&rdquo; account schedule under
        Settings → Calendar → Accounts → Fetch New Data. For a planner-style feed,
        &ldquo;Hourly&rdquo; is usually appropriate.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">iCloud web — least preferred</h2>
      <p>
        iCloud&apos;s web Calendar can subscribe to a public iCalendar URL, but the configuration
        surface is thinner than on macOS and the cross-device behavior is less predictable. Use
        macOS or iOS unless you specifically need iCloud-web-only.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">webcal:// vs https://</h2>
      <p>
        Calendar Automations exposes both schemes for every feed. Apple Calendar handles both,
        with one practical difference: webcal:// URLs trigger the Calendar app&apos;s subscription
        flow when clicked, which is convenient on macOS where the link opens the right dialog
        directly. https:// URLs are universally accepted in the manual subscription dialog and are
        a better choice when pasting from the dashboard.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Time zones</h2>
      <p>
        Apple Calendar respects the iCal <code>TZID</code> property, which Calendar Automations
        always writes. If the dashboard&apos;s time zone is set to <code>Australia/Melbourne</code>
        and a goal is at 9 AM, the event arrives in Apple Calendar tagged for that zone and
        renders in your device&apos;s local time correctly when you travel.
      </p>
      <p>
        macOS Calendar has a global &ldquo;Turn on time zone support&rdquo; toggle (Calendar →
        Settings → Advanced). With it on, events render in the time zone they were authored in;
        with it off, they render in the device&apos;s current time zone. Most operators want the
        toggle off so the morning workout block appears at 6 AM local wherever they are.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Common gotchas</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Subscribing in &ldquo;On My Mac&rdquo; instead of iCloud.</strong> The
          subscription will not sync to your phone. If that is what you want, fine; if not, move
          it to iCloud (right-click → Get Info → Location).
        </li>
        <li>
          <strong>Letting alarms through.</strong> Calendar Automations does not write meaningful
          alarms. If you let them through, you may get random alerts from blocks. Untick alarms in
          the subscription dialog.
        </li>
        <li>
          <strong>Forgetting to refresh after rotating the feed token.</strong> If you rotate the
          token in the Calendar Automations dashboard, the previous URL stops working. Apple will
          show stale events for a while; remove and re-add the subscription to clear.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why Apple Calendar is the best client for this kind of feed</h2>
      <p>
        Compared to Google Calendar, Apple Calendar offers a tighter refresh interval, per-feed
        alarm suppression, and explicit control over time-zone rendering. For a planner that
        regenerates often and is consumed across iPhone, iPad, and Mac, Apple Calendar is the
        path of least friction. Combined with the read-only OAuth model on the source side, the
        result is a self-contained, fully-portable planning surface that does not require giving
        any service write access to your primary calendar.
      </p>
    </ArticleLayout>
  );
}
