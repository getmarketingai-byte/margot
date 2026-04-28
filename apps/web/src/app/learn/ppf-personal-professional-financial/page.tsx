import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "ppf-personal-professional-financial";
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
      answer="PPF — Personal, Professional, Financial — is a tri-bucket framework popularized by Natalie Dawson for keeping life-design goals visible across categories that tend to crowd each other out. Calendar Automations supports PPF as a weekly mix target, an optional 1y/3y/5y horizon tag on goals, and a touches-per-week floor so each pillar gets attention even when one bucket is loud."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why three pillars and not eight</h2>
      <p>
        The Wheel of Life captures texture: friendships, body, contribution, learning. PPF
        captures structure: the three buckets that, in a typical adult life, are funded from the
        same finite supply of energy and end up competing. By collapsing dozens of life domains
        into three, PPF asks one question per week instead of eight: did Personal, Professional,
        and Financial each get touched.
      </p>
      <p>
        Three buckets are easier to reason about under load. When work surges or a financial event
        consumes a quarter, you can still glance at the week and notice that Personal got zero
        touches. That is a different signal than seeing eight wheel scores all slightly down.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Configuring PPF as a constraint</h2>
      <p>
        In Calendar Automations every weekly goal gets an optional pillar tag: Personal,
        Professional, or Financial. The settings page exposes two PPF constraints:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Mix targets.</strong> Set minimum percentages of discretionary time per pillar.
          For example, 50% Professional, 30% Personal, 20% Financial. The allocator distributes
          minutes to satisfy the mix when capacity allows.
        </li>
        <li>
          <strong>Touches per week.</strong> Set a minimum number of separate blocks per pillar.
          Four touches of fifteen minutes is often more useful than one ninety-minute block — it
          forces the pillar into the rhythm of the week.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Mixing PPF with Wheel and HP6</h2>
      <p>
        PPF does not replace the Wheel of Life or the HP6 habit tags; it composes with them. A
        weekly goal can simultaneously be tagged with a wheel area (&ldquo;relationships&rdquo;), a
        PPF pillar (&ldquo;Personal&rdquo;), and an HP6 habit (&ldquo;Develop influence&rdquo;).
        The allocator treats those as three orthogonal constraints and tries to satisfy all of
        them. When something has to give, priority and anchors decide.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Horizons: one, three, five years</h2>
      <p>
        PPF in its original framing pairs the three pillars with three horizons: one-year, three-
        year, and five-year goals per pillar. Calendar Automations supports horizon as an optional
        tag on every goal so longer-horizon initiatives can be filtered into a separate review
        cadence (you don&apos;t want a five-year goal showing up on your daily timemap; you do
        want it to surface in a monthly strategy review).
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">The Financial pillar is the one most operators skip</h2>
      <p>
        In practice, Financial is the bucket most adults under-fund in their week. They confuse
        &ldquo;earning&rdquo; (which is Professional) with &ldquo;managing money&rdquo; (which is
        Financial), and end up with a thirty-year career and zero hours per week spent on the
        infrastructure of their own finances — investment policy, tax cadence, bookkeeping,
        retirement modeling, insurance review, business entity hygiene.
      </p>
      <p>
        Setting a small but non-zero Financial floor is one of the highest-leverage changes a
        weekly planner can make. Even thirty minutes a week reading statements and reconciling
        models compounds. The PPF constraint forces that minute count above zero.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">PPF mix versus a task scheduler</h2>
      <p>
        Task schedulers like SkedPal, Reclaim, Motion, and Sunsama are excellent at allocating
        Professional time — they were built for it. None of them ask whether a Personal touch
        landed on Tuesday or whether the Financial pillar got its weekly thirty minutes. The mix
        target is the part of the week your scheduler does not measure, because the inputs it
        consumes (tasks, projects, deadlines) are nearly all Professional by definition.
      </p>
      <p>
        Run them together. Mark the calendar your scheduler writes to as a busy source. Calendar
        Automations will then place Personal and Financial touches into gaps the scheduler has
        not claimed, so the mix target gets satisfied without a fight over the same slots.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">A reasonable starting mix</h2>
      <p>
        For full-time operators, a reasonable starting mix is 60% Professional, 30% Personal, 10%
        Financial of <em>discretionary</em> time (not total clock time). Weekly touches: at least
        five Professional, at least three Personal, at least one Financial. Adjust based on
        season; if you are running a launch, expect Professional to absorb everything and pre-
        commit to a recovery week afterward.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When to ignore PPF</h2>
      <p>
        Sabbatical periods, parental leave, and recovery from burnout are seasons where the three-
        pillar mix is the wrong abstraction. The framework works for active operators with multiple
        competing demands; outside that context it is fine to disable it without guilt and
        re-enable it when the season shifts.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Attribution</h2>
      <p>
        PPF as a vocabulary is most associated with public material from Natalie Dawson and
        related Cardone Ventures content. Calendar Automations does not republish any third-party
        copyrighted text. We provide the structure (tags, mix targets, touches-per-week) and you
        provide your own paraphrased prompts.
      </p>
    </ArticleLayout>
  );
}
