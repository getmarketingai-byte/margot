import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "skedpal-companion";
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
      answer="Run them together. Your scheduler keeps doing reactive task flow — deadlines, project hierarchies, auto-rescheduling. Calendar Automations adds the strategic balance layer your scheduler does not cover — Wheel of Life floors, PPF mix targets, HP6 monthly habit touches, and energy-aware ordering. Mark the calendar your scheduler writes to as a busy source, and the two compose without fighting over the same slots."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Two different jobs</h2>
      <p>
        Task schedulers are built around a stream of tasks with deadlines, durations, and
        priorities, and a calendar of meetings that constrains when those tasks can run. Their
        whole engineering effort goes into producing a feasible weekly schedule and quickly
        re-running it when a meeting moves. SkedPal pioneered this in the 2010s; Reclaim, Motion,
        and Sunsama are different shapes of the same idea.
      </p>
      <p>
        Calendar Automations is built around a stream of <em>weekly framework goals</em>: a body
        floor of 90 minutes, a Personal pillar with at least three touches, a &ldquo;demonstrate
        courage&rdquo; habit at one touch this month, an energy-mode preference for placing deep
        work before scanning. None of those inputs are tasks with deadlines; they are
        constraints on the shape of a typical week. Your scheduler is not built to satisfy them
        and was never meant to.
      </p>
      <p>
        Two different jobs, two different tools. The mistake is to expect either tool to do
        both.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What goes where</h2>
      <p>
        A decision rule that holds up in practice:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Has a deadline or a dependency on someone else?</strong> Your scheduler. That
          is exactly the input it consumes well.
        </li>
        <li>
          <strong>Is a recurring habit, weekly minute floor, or framework constraint?</strong>{" "}
          Calendar Automations. The allocator was designed for this shape of work.
        </li>
        <li>
          <strong>One-off &ldquo;deep work&rdquo; block this week?</strong> Either; usually
          easier in your scheduler so it can rebalance if a meeting moves.
        </li>
        <li>
          <strong>Monthly review day, weekly retrospective, daily intention bookend?</strong>{" "}
          Calendar Automations as a consistency segment — they should not get auto-moved when a
          meeting runs long.
        </li>
        <li>
          <strong>Sleep window, travel buffer, recovery block?</strong> Calendar Automations.
          These are reservations, not tasks.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Setup, in order</h2>
      <ol className="list-decimal pl-5">
        <li>
          <strong>Identify the calendar your scheduler writes to.</strong> SkedPal lets you
          choose; Reclaim creates a dedicated calendar by default; Motion writes to your
          primary; Sunsama optionally syncs to a calendar of your choice. Whatever it is, find
          the name in your Google Calendar settings.
        </li>
        <li>
          <strong>Sign in to Calendar Automations.</strong> Read-only OAuth, no write scope.
        </li>
        <li>
          <strong>Mark the scheduler&apos;s calendar as a busy source.</strong> On the Calendars
          page in the Calendar Automations dashboard. Also include your meeting calendars (your
          primary, work calendar, partner calendar, etc.) — anything where an event means you
          are unavailable.
        </li>
        <li>
          <strong>Configure your frameworks.</strong> Wheel of Life floors, PPF mix targets, HP6
          monthly minimum-touch counts, energy ordering. None are required; configure the ones
          that matter to you.
        </li>
        <li>
          <strong>Enter weekly framework goals.</strong> Things that are recurring or
          rhythm-shaped. Avoid duplicating tasks that live in your scheduler.
        </li>
        <li>
          <strong>Subscribe to the iCal feed in your calendar app.</strong> The blocks Calendar
          Automations places appear as a separate, named subscription. Both surfaces — your
          scheduler&apos;s calendar and the Calendar Automations feed — show up in the same
          calendar app.
        </li>
      </ol>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How conflicts are resolved</h2>
      <p>
        Calendar Automations only places blocks into gaps the scheduler has not already claimed.
        When the scheduler moves a block (because a meeting ran long, a new urgent task
        appeared, or you re-prioritized), the next regeneration of the iCal feed will route
        around the new busy interval. The scheduler does not need to know Calendar Automations
        exists.
      </p>
      <p>
        The reverse is not automatic — a SkedPal or Reclaim does not see the Calendar
        Automations feed as busy unless you tell it to. If you care about that direction (so the
        scheduler avoids your habit blocks), most schedulers can subscribe to an external
        calendar URL and treat its events as immovable. Add the Calendar Automations feed there
        and the loop closes.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">SkedPal-specific notes</h2>
      <p>
        SkedPal&apos;s &ldquo;time maps&rdquo; concept overlaps slightly with the Calendar
        Automations time-map bands (Needle-Mover, Execute, Ops, Play). They are not in conflict —
        the SkedPal time map controls when SkedPal places its tasks; the Calendar Automations
        time-map bands control when the framework allocator places floor minutes and habit
        touches. Tune them in the same direction (e.g. mornings reserved for deep work in both
        tools) so they reinforce rather than fight each other.
      </p>
      <p>
        SkedPal also publishes its scheduled blocks to whichever calendar you point it at. If
        that is your primary, expect Calendar Automations to see <em>everything</em> SkedPal
        scheduled as busy and only fill what is left. Some operators prefer a dedicated
        SkedPal-output calendar for cleaner separation.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Reclaim, Motion, Sunsama</h2>
      <p>
        The same pattern applies. Reclaim has the cleanest setup because it already uses a
        dedicated calendar; Motion overwrites your primary, which means Calendar Automations
        will see everything Motion placed; Sunsama is daily-plan-shaped rather than week-shaped,
        so the framework layer fills in the cross-week constraints Sunsama was never meant to
        track.
      </p>
      <p>
        With any of them, the rule is the same: mark their output calendar as a busy source,
        keep recurring framework goals in Calendar Automations, keep tasks-with-deadlines in the
        scheduler.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When not to do this</h2>
      <p>
        If you are still in the &ldquo;does this scheduler work for me&rdquo; phase with
        SkedPal, Reclaim, or Motion, do not add a second tool. Get the scheduler to a stable
        state first, and only then layer Calendar Automations on top. Two tools you are
        actively learning at once is a recipe for abandoning both.
      </p>
      <p>
        If your week has very little structure outside reactive task flow — for example, you are
        a contract operator firefighting different projects every week — the framework layer
        may not earn its keep. Calendar Automations is for people whose lives have rhythm
        beyond task deadlines.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Pricing as a companion</h2>
      <p>
        Calendar Automations is priced as a small add-on to your existing scheduler:
        A$6/month or A$54/year (save 25%), with a 7-day no-card trial. That sits intentionally
        below the $9.95–$14.95/month tier of SkedPal Core/Pro, the $10–$15/month tier of
        Reclaim, the $19+ tier of Motion, and the $20/month tier of Sunsama — because this
        product solves a smaller, more specific problem than any of them, and is meant to add
        to a scheduler subscription rather than replace it.
      </p>
    </ArticleLayout>
  );
}
