import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "sleep-and-travel-overlays";
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
      answer="A planner that ignores sleep windows and travel time produces schedules that look reasonable on paper and fall apart in life. Calendar Automations reserves a configured sleep window every day and computes travel overlays for known location-bearing appointments before allocating goals — so a 7 PM meeting on the other side of the city does not get a 6:30 PM deep-work block stacked behind it."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why sleep is a planner concern</h2>
      <p>
        Most calendar apps treat sleep as out-of-scope: it is not an event, it is not a meeting,
        it is not data. That is a mistake when you are trying to do real weekly planning. Sleep
        is where the day actually starts and ends; if the planner does not know about it, the
        first deep-work block it allocates can land at a time when you are not awake yet, and
        the last block of the night can land thirty minutes before bedtime — long after you would
        be useful.
      </p>
      <p>
        Calendar Automations stores a configured sleep window per user (default 11 PM – 7 AM),
        with weekday and weekend variants if you want them. Before any goal allocation runs, the
        sleep window is reserved as a busy interval for every day in the scheduling window.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What we do not do</h2>
      <p>
        We do not estimate optimal sleep duration based on age, season, exertion, or chronotype.
        That is medical / lifestyle territory that the app stays out of. The sleep window is whatever
        you tell us; the planner&apos;s job is to honor it, not to argue with it.
      </p>
      <p>
        We also do not auto-detect actual sleep from a wearable. Sleep is a configured intent, not
        a measurement. If you want measurement, that is a separate tool.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Travel overlays</h2>
      <p>
        For events with locations, the planner can compute realistic travel time and reserve a
        leading and trailing window around them. This requires the event to have a Google Maps-
        resolvable location, and the user to have provided their own &ldquo;home base&rdquo;
        location and current commute mode. With those configured, the planner queries the Maps
        Directions API for each location-bearing event and reserves <code>arrivalLeadMinutes</code>{" "}
        and <code>departureTrailMinutes</code> around the event.
      </p>
      <p>
        Travel overlays are the single highest-value planning addition for anyone whose week
        actually moves through space. A 9 AM medical appointment on the other side of the city
        is not just a one-hour event — it is a three-hour displacement once you account for
        leaving home, parking, waiting, and getting back. Without that overlay, a 7:30 AM deep-
        work block looks fine; with it, you can see why the morning never recovers.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Cost and quotas</h2>
      <p>
        Maps Directions API calls cost real money once they leave the free tier. The planner
        caches travel results per <code>(origin, destination, mode, daypart)</code> so a recurring
        appointment does not re-query each regeneration. There is also a configurable daily
        request budget — if the budget is hit, the planner falls back to a static estimate (the
        free-tier-friendly default) for the remaining queries that day.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Order of overlays</h2>
      <p>
        Overlays are applied in this sequence:
      </p>
      <ol className="list-decimal pl-5">
        <li>Sleep windows.</li>
        <li>Travel windows for known appointments.</li>
        <li>Consistency segments.</li>
        <li>Wheel of Life and PPF reservations.</li>
        <li>Goal allocation into the remaining gaps.</li>
      </ol>
      <p>
        Sleep first, because sleep should never be displaced by a goal. Travel second, because
        travel is bound to events that already exist on the calendar — re-shuffling around it is
        not optional. Consistency segments next, because they are user-elected commitments. Then
        balance constraints, then discretionary goals.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Buffer time inside the working day</h2>
      <p>
        Travel overlays are one form of buffer; another is generic buffer time between meetings.
        The planner exposes a configurable inter-event buffer that prevents goal blocks from
        butting directly against the start or end of an existing meeting. Five minutes is a
        sensible default; ten if your meetings tend to run long.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When to disable overlays</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Remote-only weeks.</strong> If you are 100% remote that week, disable travel
          overlays for the week to avoid spurious reservations.
        </li>
        <li>
          <strong>Fully-async sleep.</strong> If you do shift work and your sleep window varies
          dramatically by day, model it as multiple sleep variants rather than one fixed window;
          do not pretend it is consistent.
        </li>
        <li>
          <strong>Vacation weeks.</strong> Disable goal allocation entirely for known vacation
          spans — the planner has a window-exclude option.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why these overlays are the dividing line</h2>
      <p>
        Most weekly planners stop at &ldquo;you have free time at 9 AM Tuesday, do something
        important.&rdquo; That is not enough. The planner has to know that 9 AM Tuesday begins
        twenty minutes earlier because of a 9:20 medical appointment two suburbs away, and that
        the 9 AM block has to land before the travel window opens or it will not land at all.
        Sleep and travel overlays are the boundary between &ldquo;cute weekly schedule&rdquo; and
        &ldquo;a calendar I will actually live by.&rdquo;
      </p>
    </ArticleLayout>
  );
}
