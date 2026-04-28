import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "consistency-segments-time-blocking";
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
      answer="A consistency segment is a fixed-clock recurring block — same days, same time, same activity — that the planner reserves before allocating any other goals. They are the planning equivalent of paying yourself first. Use them for the few activities you genuinely want at the same hour every week, and leave the rest of the week to the allocator."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What a consistency segment is</h2>
      <p>
        A consistency segment is a recurring calendar block with three fixed properties: the
        weekday(s) it applies to, the start time, and the duration. The activity it represents is
        intentionally non-negotiable: the morning workout, the evening shutdown, the Tuesday-and-
        Thursday writing block, the kids-bedtime window. The planner treats these blocks as
        already-busy intervals and allocates everything else around them.
      </p>
      <p>
        The framing borrows from training-style time-blocking (sometimes associated with Andrew
        Bustamante&apos;s public material). The premise is that habit formation depends more on
        same-clock repetition than on perfect activity selection. A workout at 6 AM every weekday
        beats a perfectly designed workout that floats around the calendar.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why fixed clocks beat floating goals</h2>
      <p>
        Floating goals — &ldquo;exercise twenty minutes a day at some point&rdquo; — sound flexible
        and end up being negotiable. The brain is smart enough to find a reason to defer them.
        Fixed-clock segments survive better because the decision is pre-made: at 6 AM, this is
        what we do. The allocator can place a hyperfocus deep-work block at 9 AM whether or not
        the workout happens, but the scheduling slot has been reserved either way.
      </p>
      <p>
        The cost of fixed clocks is rigidity. If your week is genuinely chaotic — emergency-
        response work, irregular shifts, parenting an infant — strict consistency segments will
        feel oppressive. The planner accepts a softness setting per segment so you can tag it as
        &ldquo;reserve unless conflict&rdquo; and let real conflicts win.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Where consistency fits in the allocator</h2>
      <p>
        Order of operations:
      </p>
      <ol className="list-decimal pl-5">
        <li>Read busy intervals from connected calendars.</li>
        <li>Reserve consistency segments as additional busy intervals.</li>
        <li>Reserve sleep windows.</li>
        <li>Reserve travel windows for known appointments.</li>
        <li>Compute remaining gaps.</li>
        <li>Allocate weekly goals, in priority order, into the gaps.</li>
      </ol>
      <p>
        Consistency segments deliberately precede goal allocation. If you want a morning workout
        and a hyperfocus deep-work block, the workout claims its 6 AM slot first; the deep-work
        block has to find time elsewhere. This is the right order — you are protecting habit
        infrastructure before you protect output.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">A reasonable starting set</h2>
      <p>
        For most operators, three to five consistency segments is the sweet spot. More than that
        and the calendar becomes a cage; fewer and the planner ends up doing nothing different
        from what you would do without it.
      </p>
      <ul className="list-disc pl-5">
        <li>Morning bookend (15–45 minutes): intention setting, sometimes journaling.</li>
        <li>Movement block (30–60 minutes): same days, same time. Sustainability beats intensity.</li>
        <li>Deep-work bookend (60–120 minutes): the daily hyperfocus slot you protect first.</li>
        <li>Evening shutdown (10–20 minutes): scorecard / wrap-up / handoff to next-day.</li>
        <li>Optional: weekly review (90 minutes, Friday afternoon).</li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Adherence as a metric</h2>
      <p>
        The dashboard tracks adherence: planned consistency segments versus moved or skipped
        segments. Adherence is the leading indicator most operators ignore in favor of output. A
        week where a Friday review was done but the morning workout was moved on three of five
        days is, in the long run, a degrading week regardless of what shipped.
      </p>
      <p>
        We recommend treating adherence above 80% as the signal that the segments are well-chosen
        and below 60% as the signal that you are over-segmenting and need to cut one.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Anti-patterns</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Aspirational segments.</strong> Adding a 5 AM cold plunge because you read about
          one. If you are not already doing it three times in a row by sheer will, do not encode it
          as a segment yet.
        </li>
        <li>
          <strong>Over-segmenting.</strong> Eight segments per day leaves no room for the actual
          allocator to do its job; the calendar starts looking like a stack of nesting dolls.
        </li>
        <li>
          <strong>Negotiable segments.</strong> A segment that is moved every other day is not a
          segment; it is a goal. Move it back to the goal pool and let the allocator place it.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When to drop a segment</h2>
      <p>
        Segments are not promises in perpetuity. Drop them when life seasons change. The morning
        workout that worked when you were single is hostile when the kid is six weeks old. Update
        the segment list at the same monthly cadence as your wheel re-score; that synchronizes the
        small-cycle (week) and medium-cycle (month) loops without having to think about it.
      </p>
    </ArticleLayout>
  );
}
