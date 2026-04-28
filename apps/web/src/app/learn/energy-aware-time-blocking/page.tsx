import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "energy-aware-time-blocking";
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
      answer="Energy-aware time blocking tags each weekly goal as hyperfocus, hyperaware, or neutral and uses those tags as a scheduling-only ordering signal. The Calendar Automations allocator prefers a hyperfocus-then-neutral-then-hyperaware sequence inside each day and avoids long unbroken hyperaware runs. The tags are scheduling labels, not medical or psychological claims."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What the three tags mean</h2>
      <p>
        Calendar Automations uses three energy modes as scheduling tags on weekly goals.{" "}
        <strong>Hyperfocus</strong> describes work that benefits from deep, single-threaded
        attention — writing, building, designing, doing the thinking that matters. <strong>
          Hyperaware
        </strong>{" "}
        describes scanning, coordinating, broad-attention work — triage, reviews, meetings, parallel
        threads. <strong>Neutral</strong> is everything in between, including admin and shorter
        tasks that do not strongly prefer one mode.
      </p>
      <p>
        These are framing borrowed from public material by Andrew Bustamante and used here only as
        scheduling tags. The app makes no medical, psychological, or performance claims.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How the allocator uses them</h2>
      <p>
        The allocator reserves consistency segments first, then water-fills weekly minutes per goal
        into the free intervals. With energy ordering enabled, blocks placed earlier in the day are
        biased toward hyperfocus, with hyperaware blocks placed later. The mode is configurable —
        strict, balanced, or ignore — so users who do not want energy-aware ordering can opt out
        without losing the rest of the planner.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why ordering matters more than tagging</h2>
      <p>
        The interesting constraint is not which task is which mode. It is that long unbroken runs
        of hyperaware work degrade output: scanning all afternoon and then trying to write at 6 PM
        rarely produces good writing. The allocator avoids placing two hyperaware blocks back to
        back without at least one hyperfocus or neutral block between them, when goal targets and
        gap geometry permit.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Combined with Wheel and PPF</h2>
      <p>
        Energy ordering is one signal among several. Wheel of Life weekly minimums guarantee that
        neglected life areas get slots. PPF mix targets — Personal, Professional, Financial — keep
        all three buckets touched every week. HP6 habit tags ensure each habit gets touch time
        across the month. The allocator solves these as soft constraints with priorities; energy
        ordering is the within-day tiebreaker.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What you actually do as a user</h2>
      <p>
        For each weekly goal, you set the title, target minutes, optional day-of-week, and the
        energy tag. You set Wheel minimums and PPF targets in settings. The allocator runs on a
        cadence (Vercel Cron triggers Inngest jobs) and the resulting schedule shows up in your
        subscribed iCal feed. Tagging is the only ordering input — there is no ML model, no opaque
        score, and no behavioral inference about you.
      </p>
    </ArticleLayout>
  );
}
