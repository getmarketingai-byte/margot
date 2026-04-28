import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "subscribing-icalendar-google-calendar";
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
      answer="Add a Calendar Automations feed to Google Calendar by opening Other Calendars → Add by URL on the web client and pasting the HTTPS feed URL. Google fetches the feed, parses the events, and merges them into your view as a separate sub-calendar with its own color. Refresh cadence is controlled by Google and is generally measured in hours, not minutes."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Where to do it (and where not to)</h2>
      <p>
        Adding an external iCal feed has to be done on the Google Calendar <strong>web client</strong>
        on a desktop browser. The Android and iOS Google Calendar apps do not have an &ldquo;Add by
        URL&rdquo; option in their UI; once a calendar is added on the web, it appears on the
        mobile clients automatically. Trying to paste a feed URL into the mobile app will not work.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step-by-step</h2>
      <ol className="list-decimal pl-5">
        <li>Open <code>calendar.google.com</code> in a desktop browser.</li>
        <li>
          In the left sidebar, find &ldquo;Other calendars,&rdquo; click the plus icon, and select
          &ldquo;From URL.&rdquo;
        </li>
        <li>
          Paste the HTTPS URL of the Calendar Automations feed (from the dashboard Feeds page) and
          click &ldquo;Add calendar.&rdquo;
        </li>
        <li>
          Wait. Google&apos;s initial fetch typically completes within a few minutes; sometimes
          longer.
        </li>
        <li>
          Once the calendar appears, rename it (gear icon → Settings → name field) to something
          you will recognize. The default name is the iCal feed&apos;s <code>X-WR-CALNAME</code>
          property — usually descriptive but worth customizing.
        </li>
        <li>
          Pick a color. Calendar Automations does not assign one; Google chooses the next free
          color in the palette.
        </li>
      </ol>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Refresh cadence — the part most users misread</h2>
      <p>
        Google Calendar refreshes URL-subscribed calendars on its own schedule. Reports vary, but
        in practice the typical interval is <em>several hours</em>, sometimes longer than a day.
        Google does not expose a refresh-now button or a per-calendar refresh interval setting.
        The iCal feed&apos;s <code>X-PUBLISHED-TTL</code> hint (Calendar Automations sets 30
        minutes) is treated as advisory.
      </p>
      <p>
        That cadence is fine for a planner that regenerates daily, but it is not fine for a real-
        time tool. If you find yourself regenerating the planner and impatiently refreshing
        Google for the new schedule, you are using the wrong tool — that is what direct calendar
        writes are for, and Calendar Automations does not do those in v1.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Time zones</h2>
      <p>
        Calendar Automations writes timestamps with explicit time-zone IDs (e.g.
        <code>TZID=Australia/Melbourne</code>). Google honors these; you should not need to do
        anything special unless you travel and want events to render in a fixed time zone (e.g. you
        always want morning workouts to appear at the local 6 AM regardless of where you are).
        That setting belongs in your individual goal&apos;s metadata, not in Google&apos;s
        subscription configuration.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When to remove a subscription</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>You changed feeds.</strong> Remove the old subscription before adding the new one
          so events from the deprecated feed do not linger.
        </li>
        <li>
          <strong>You rotated your feed token.</strong> Token rotation invalidates the URL. Add
          the new URL and remove the old subscription.
        </li>
        <li>
          <strong>You canceled the service.</strong> Calendar Automations serves an explanatory
          event when subscription lapses. The event will eventually fall off as Google&apos;s
          cache expires; you can also remove the subscription explicitly.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Common gotchas</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Pasting a webcal:// URL.</strong> Google&apos;s &ldquo;From URL&rdquo; field
          accepts HTTPS only. Use the HTTPS variant of the feed URL (Calendar Automations exposes
          both formats).
        </li>
        <li>
          <strong>Adding the URL on a phone.</strong> As noted, only the web client can add a new
          subscription.
        </li>
        <li>
          <strong>Forgetting to make the calendar visible on mobile.</strong> Subscribed calendars
          sometimes default to hidden on the Android/iOS Google Calendar app. Toggle the calendar
          on inside the mobile app&apos;s left drawer.
        </li>
        <li>
          <strong>Subscribing to your own published feed inside your busy-source list.</strong> If
          you mark your Calendar Automations feed as a busy source, the next regeneration will
          consider its blocks as busy intervals and re-shuffle around them. Exclude the published
          feed from busy sources unless you intentionally want that recursion.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Sharing a feed with someone else</h2>
      <p>
        Feed tokens are private by design — anyone with the URL can fetch the feed. Do not paste
        feed URLs into shared documents, screenshots of the dashboard, or public posts. If you
        need to share your schedule with someone (assistant, partner, coach), do so in a way you
        can revoke later: rotate the feed token in the dashboard whenever you want the previously
        shared URL to stop working.
      </p>
    </ArticleLayout>
  );
}
