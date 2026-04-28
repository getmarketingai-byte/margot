import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "perfect-week-allocation-walkthrough";
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
      answer="The end-to-end loop is six steps: connect the calendars you treat as busy sources, configure your frameworks (Wheel, PPF, HP6, energy ordering, consistency segments), enter weekly goals with tags, run the planner, copy the iCal feed URL into your calendar app, and review at the end of the week. The walkthrough below shows what each step looks like in practice."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step 1 — Connect calendars</h2>
      <p>
        Sign in with Google. Calendar Automations requests two read-only Calendar scopes; there is
        no write scope. After sign-in, the dashboard&apos;s Calendars page lists every calendar
        your Google account can see and asks you to mark which ones count as &ldquo;busy
        sources.&rdquo; The default rule of thumb: include every calendar where an event means
        you are unavailable for new work. Exclude calendars that are subscribed-but-informational
        (sports schedules, public holidays in regions you do not work in, your subscribed
        Calendar Automations feed once it exists).
      </p>
      <p>
        The setting is per-user and stored in the versioned <code>UserSettings</code> JSON; it
        will not change without you touching it again.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step 2 — Configure frameworks</h2>
      <p>
        Open Frameworks. You will see four cards: Wheel of Life, PPF, HP6, and Energy ordering.
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Wheel of Life.</strong> Score each area 1–10 and set weekly minute floors on the
          two or three areas you most want to move.
        </li>
        <li>
          <strong>PPF.</strong> Set mix percentages and minimum touches per pillar.
        </li>
        <li>
          <strong>HP6.</strong> Set monthly minimum-touch counts per habit. Pick four to start.
        </li>
        <li>
          <strong>Energy ordering.</strong> Choose strict / balanced / ignore and the preferred
          sequence (default <code>hyperfocus → neutral → hyperaware</code>).
        </li>
      </ul>
      <p>
        Defaults are sensible. You can leave any framework off; the planner does not require all
        four.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step 3 — Enter weekly goals</h2>
      <p>
        On the Goals page, add weekly goals. For each goal, set:
      </p>
      <ul className="list-disc pl-5">
        <li>Title.</li>
        <li>Target minutes for the week.</li>
        <li>Optional day-of-week (or floating).</li>
        <li>Energy mode (hyperfocus, hyperaware, neutral).</li>
        <li>Wheel area, PPF pillar, HP6 habit (any combination, all optional).</li>
        <li>Optional priority and earliest/latest hour anchors.</li>
      </ul>
      <p>
        For most operators, eight to twelve weekly goals is the right range. Fewer than that and
        the calendar feels empty; more than that and the planner is allocating too thinly to be
        useful.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step 4 — Run the planner</h2>
      <p>
        The planner runs automatically on a Vercel Cron schedule, but you can also trigger a
        regeneration from the dashboard. The job sequence is:
      </p>
      <ol className="list-decimal pl-5">
        <li>Read busy intervals from your selected calendars.</li>
        <li>Reserve consistency segments.</li>
        <li>Reserve sleep windows from your sleep settings.</li>
        <li>Reserve travel windows for known appointments.</li>
        <li>Compute remaining gaps for the next 60 days.</li>
        <li>Reserve Wheel-of-Life minute floors per area.</li>
        <li>Reserve PPF mix and touch minimums.</li>
        <li>Allocate weekly goals into the remaining gaps, ordered by energy preference.</li>
        <li>Render the iCal feed and store the snapshot.</li>
      </ol>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step 5 — Subscribe in your calendar app</h2>
      <p>
        Open the Feeds page. Copy the URL for the feed you want — most users start with the
        timemap feed; sleep and travel feeds are optional. Paste the URL into your calendar
        app&apos;s &ldquo;Add by URL&rdquo; or &ldquo;New Calendar Subscription&rdquo; flow.
      </p>
      <p>
        Initial sync may take several minutes. After that, your calendar app refreshes on its own
        schedule (Google Calendar URL subscriptions typically refresh every several hours; Apple
        Calendar lets you choose down to fifteen minutes; Outlook varies). Calendar Automations
        sets the iCal X-PUBLISHED-TTL hint to 30 minutes but the client app has the final say on
        cadence.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Step 6 — Review at the end of the week</h2>
      <p>
        On Friday afternoon — or whatever day you set as your weekly review — open the dashboard.
        Review three things:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Adherence.</strong> Which consistency segments did you keep? Which did you move?
        </li>
        <li>
          <strong>Coverage.</strong> Did each Wheel area with a floor receive its minutes? Did
          each PPF pillar receive its touches? Did each HP6 habit get touches this week toward its
          monthly minimum?
        </li>
        <li>
          <strong>Goals.</strong> Which goals shipped, which moved into next week, which should be
          deleted because they no longer matter?
        </li>
      </ul>
      <p>
        The review is the only step that requires honesty rather than configuration. The planner
        cannot tell you whether the goals you wrote down were the right ones; it can only tell you
        whether they were placed and whether they happened. That distinction is what keeps the
        weekly-planner habit from drifting into self-deception.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">A worked-example week</h2>
      <p>
        For a typical full-time operator with no kids, here is what a first week looks like:
      </p>
      <ul className="list-disc pl-5">
        <li>30 hours of pre-existing meetings and busy intervals across the week.</li>
        <li>Three consistency segments: 6 AM workout (M/W/F), 8 AM deep-work bookend (M–F), 5 PM shutdown.</li>
        <li>Wheel floors: 90 minutes Body, 60 minutes Relationships, 45 minutes Learning.</li>
        <li>PPF mix: 60% Professional, 30% Personal, 10% Financial; minimum touches 5/3/1.</li>
        <li>HP6 monthly minimums: clarity 4, energy 12, influence 4, courage 1.</li>
        <li>Twelve weekly goals, ranging from 30 to 240 minutes each.</li>
      </ul>
      <p>
        After the planner runs, you will see roughly 18–22 hours of allocated goal time on top of
        the 30 hours of pre-existing busy time, plus the consistency segments. That leaves the
        remainder as genuinely free — and you will discover, often for the first time, that the
        amount of free time you actually have is smaller than the amount you implicitly assumed.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Where the system breaks down</h2>
      <p>
        The system breaks down when you stop reviewing. Without the weekly review, the goals
        become wallpaper, the floors are no longer honest, and the iCal feed devolves into
        background noise. Calendar Automations cannot replace the review; it can only make the
        scaffolding for the review easier to maintain.
      </p>
    </ArticleLayout>
  );
}
