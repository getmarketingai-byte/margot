import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "busy-interval-merging-and-gap-finding";
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
      answer="The planner pulls every event from your selected calendars over the next 60 days, drops free / transparent events, normalizes the rest into start/end pairs in your time zone, sorts them, merges overlaps and adjacent runs, then computes the complement against the day window to produce free gaps. Edge cases — all-day events, multi-day events, soft holds — get explicit handling so the gap list is honest."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why &ldquo;just look at my calendar&rdquo; is not enough</h2>
      <p>
        On a typical week, an active operator has fifty to a hundred events spanning multiple
        calendars: work meetings, personal commitments, recurring blocks, all-day flags, an HR
        leave overlay, the kid&apos;s schedule, the gym&apos;s standing booking. Many of these
        overlap, some are marked &ldquo;free&rdquo; deliberately (informational holds), and a few
        cross day boundaries. Allocating goals into &ldquo;the gaps&rdquo; requires reducing all of
        that to a clean, unambiguous list of intervals where you are actually available.
      </p>
      <p>
        That reduction has three operations: filter, sort, merge. Each of them sounds trivial and
        each of them has a corner case that breaks naive implementations.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Filter — what counts as busy</h2>
      <p>
        Calendar Automations only treats an event as busy if it satisfies three conditions:
      </p>
      <ol className="list-decimal pl-5">
        <li>It comes from a calendar the user has marked as a busy source.</li>
        <li>Its transparency is &ldquo;opaque&rdquo; (Google&apos;s default), not &ldquo;transparent&rdquo;.</li>
        <li>It is within the active scheduling window (default 60 days forward).</li>
      </ol>
      <p>
        The transparency check matters more than people expect. SkedPal-style time-blocking tools
        often write soft holds with transparent flags so they do not block real meeting bookings;
        a naive busy-merge that ignores transparency will see those holds as immovable and produce
        a calendar with no free time at all.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Normalize — events to intervals</h2>
      <p>
        After filtering, every event is normalized to a half-open interval{" "}
        <code>[startMs, endMs)</code> in the user&apos;s configured time zone. All-day events
        become full-day intervals from local midnight to local midnight. Multi-day events become
        single intervals across the whole span (rather than per-day chunks). Recurring events are
        expanded to their concrete instances within the scheduling window.
      </p>
      <p>
        Time zones are kept explicit through this step. The planner stores everything as UTC
        milliseconds with the user&apos;s zone tracked alongside; when rendering the output to
        iCal it re-attaches the zone so calendar clients display the events at the right wall-
        clock time wherever the user actually is.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Merge — overlapping and adjacent</h2>
      <p>
        With the interval list normalized, the merge step is a single sort followed by a single
        pass:
      </p>
      <ol className="list-decimal pl-5">
        <li>Sort intervals by start time, breaking ties by end time.</li>
        <li>
          Walk the list once, comparing each interval to the running &ldquo;current&rdquo;
          interval. If the new one starts before the current ends — or starts within an
          adjacency tolerance — extend the current to include it. Otherwise, emit the current and
          start a new one.
        </li>
      </ol>
      <p>
        The adjacency tolerance is a small product decision. Without it, two back-to-back meetings
        with a one-second gap (a clock-skew artifact) appear as two intervals separated by a tiny
        gap, and the gap-finder can hand the allocator a slot that is in fact unusable. A tolerance
        of one to two minutes collapses the artifact and matches user intuition.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Compute gaps — the complement</h2>
      <p>
        With merged busy intervals, the gap list is the complement against the day window. For
        each day in the scheduling window:
      </p>
      <ol className="list-decimal pl-5">
        <li>
          Define the day window as <code>[earliestHour, latestHour)</code> from the user&apos;s
          settings (often 6 AM to 10 PM).
        </li>
        <li>Intersect the merged busy list against that window.</li>
        <li>Walk through the intersected list, emitting the gaps between consecutive busy intervals.</li>
        <li>Discard gaps shorter than a minimum duration (a 6-minute gap is not a goal slot).</li>
      </ol>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Edge cases that bite</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Daylight savings transitions.</strong> A 6 AM block on the day clocks &ldquo;spring
          forward&rdquo; resolves to 6 AM <em>local</em>, not the 6 AM that would have existed if
          time had moved linearly. Storing UTC ms with explicit zone metadata keeps this honest.
        </li>
        <li>
          <strong>All-day events spanning multiple days.</strong> A four-day vacation is one
          interval, not four; otherwise the gap list shows brief gaps at midnight that are not
          real gaps.
        </li>
        <li>
          <strong>Recurring events with exceptions.</strong> A weekly recurring meeting that has
          one cancelled instance must include the cancellation; otherwise gaps disappear into
          phantom busy time.
        </li>
        <li>
          <strong>Self-merge.</strong> If the planner&apos;s own published feed is among the busy
          sources, the next regeneration treats yesterday&apos;s output as today&apos;s busy time
          and the calendar drifts. Exclude the published feed from busy sources by default.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Performance shape</h2>
      <p>
        With a 60-day window and an active operator&apos;s calendars, the planner typically
        processes a few hundred events per regeneration. The interval algebra is{" "}
        <code>O(n log n)</code> dominated by the sort; the gap-finder is{" "}
        <code>O(n + d)</code> where <code>d</code> is the number of days in the window. None of
        this is the bottleneck — calendar API fetches and the Maps Directions API for travel
        overlays are.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why this matters to the user</h2>
      <p>
        Most of this geometry is invisible. The reason it matters is that small errors compound:
        if the merge undercounts busy time, goals get scheduled into intervals where you are
        actually in a meeting, and the iCal feed loses credibility within the first week of
        subscription. The whole upstream value of Calendar Automations depends on this layer being
        boringly correct.
      </p>
    </ArticleLayout>
  );
}
