import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "when-to-rotate-feed-tokens";
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
      answer="Rotate a feed token whenever you suspect the URL has been exposed (screenshot, shared doc, lost device), whenever you stop sharing the feed with a third party (assistant, coach), and on a recurring cadence — every 90 to 180 days — as a hygiene step. After rotation, re-add the new URL to your calendar app and remove the old subscription so cached events fall off cleanly."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What a feed token is</h2>
      <p>
        Each Calendar Automations feed is published at <code>/api/feeds/&lt;token&gt;.ics</code>.
        The token is unguessable, generated cryptographically, tied to one user and one feed kind
        (timemap, sleep, travel, etc.), and stored in the database alongside its owner. Anyone
        with the URL can fetch the feed; nobody without it can. There is no separate
        authentication step at fetch time because calendar apps cannot hold credentials beyond
        the URL.
      </p>
      <p>
        That model is intentional and standard for iCal — it is how calendar.google.com&apos;s
        secret URLs work, how Apple&apos;s shared calendars work, how every &ldquo;subscribe to
        this URL&rdquo; system works. The tradeoff is that the URL is a bearer token, and you
        have to treat it like one.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When to rotate</h2>
      <p>
        Rotate when:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>You suspect exposure.</strong> The URL was screenshotted into a shared document,
          posted in a public Slack channel, included in a screen recording, or accidentally
          included in an email reply.
        </li>
        <li>
          <strong>You stop sharing with a third party.</strong> Assistants, coaches, partners, and
          managers who used to subscribe to your feed lose access only when the token rotates;
          revoking is rotating.
        </li>
        <li>
          <strong>You lose a device.</strong> A subscribed iPhone in someone else&apos;s hands
          will continue to fetch the feed until the OS user is signed out. Rotation is the
          reliable cut-off.
        </li>
        <li>
          <strong>On schedule.</strong> Every 90 to 180 days as a hygiene step. Plan it for the
          same Sunday as your monthly review.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How rotation works</h2>
      <p>
        From the dashboard Feeds page, click the rotate action on the feed in question. The server
        generates a new token, marks the old token as <code>revoked</code>, and updates the row in
        the database. Subsequent requests to the old URL receive a 404. Subsequent requests to the
        new URL serve the latest snapshot.
      </p>
      <p>
        Rotation is per-feed, not global. If you have a timemap feed and a sleep feed, you can
        rotate one without disturbing the other. That granularity matters when one of them was
        exposed and the other was not.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">After rotation, on the client</h2>
      <p>
        Once rotated, the calendar app subscribed to the old URL will eventually report a fetch
        failure. The exact behavior depends on the client:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Apple Calendar (macOS).</strong> Shows an exclamation icon on the subscribed
          calendar; events remain in their last-fetched state until the subscription is removed or
          updated.
        </li>
        <li>
          <strong>Apple Calendar (iOS).</strong> Similar; the events linger until iOS retries and
          gives up, after which the calendar quietly stops updating.
        </li>
        <li>
          <strong>Google Calendar.</strong> Treats persistent fetch failures as transient at
          first. Events from the last successful fetch remain visible for some time before they
          fall off.
        </li>
        <li>
          <strong>Outlook.</strong> Varies by version; usually shows a sync error and stops
          updating.
        </li>
      </ul>
      <p>
        To get a clean cut-over, after rotation: add the new URL as a fresh subscription, verify
        events appear, then remove the old subscription. Do not rely on the failed fetches to
        clean up by themselves; they will eventually, but the linger window can be days.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What rotation does not protect against</h2>
      <p>
        Rotation does not retroactively erase what was previously fetched. If a competitor
        subscribed to your feed last week and exported the events to a private CSV, rotating the
        token now does not delete that CSV. The token model assumes you act when you suspect
        exposure rather than after you confirm misuse.
      </p>
      <p>
        Rotation also does not change the data the planner emits. The events themselves —
        morning workouts, deep-work blocks, named goals — are unchanged. If you are concerned
        about the content of the feed leaking (event titles that reveal sensitive plans), the
        right answer is to rename the goals, not to rotate the token. The token rotation is for
        access; the goal naming is for content.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">A reasonable operational habit</h2>
      <p>
        Most users will rotate a feed token zero times in a year and survive fine, because the URL
        rarely leaks in practice. Operators who treat security as hygiene rather than crisis-
        response should:
      </p>
      <ul className="list-disc pl-5">
        <li>Rotate every 90 days as part of monthly strategy review.</li>
        <li>Keep a checklist of every place each feed URL is registered (devices, shared accounts).</li>
        <li>
          Treat any &ldquo;assistant left&rdquo; or &ldquo;laptop sold&rdquo; event as a forced
          rotation regardless of schedule.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why we did not pick a different model</h2>
      <p>
        Two alternatives we considered: signed JWTs (with embedded user id and short expiry) and
        Basic Auth in the URL. Both are technically more flexible. Both fail in practice because
        calendar apps do not let users edit URLs after subscription, and short-expiry tokens
        require users to re-paste URLs constantly. The unguessable-token model is the boring
        choice, and it is the one that does not break the user experience.
      </p>
    </ArticleLayout>
  );
}
