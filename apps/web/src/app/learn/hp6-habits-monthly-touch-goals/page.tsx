import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "hp6-habits-monthly-touch-goals";
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
      answer="HP6 — the six high performance habits Brendon Burchard distilled in High Performance Habits — works well as a tag set for monthly minimum-touch goals. Tag a goal with one of the six habits, set a minimum number of touches per month, and let the allocator schedule them across weeks. The framework gives the structure; your activities give the substance."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">The six habits as tags, not commandments</h2>
      <p>
        The HP6 framework names six habits that long-running research found correlated with high
        performance: seek clarity, generate energy, raise necessity, increase productivity, develop
        influence, and demonstrate courage. The framework is mainly an encouragement to do
        deliberate work in each domain rather than letting one or two crowd out the rest.
      </p>
      <p>
        Calendar Automations treats HP6 as six tags. You attach a habit tag to a goal — for
        example, &ldquo;Send a public-by-default progress update to the team&rdquo; gets tagged
        &ldquo;Develop influence,&rdquo; while &ldquo;Walk between back-to-back meeting blocks&rdquo;
        gets tagged &ldquo;Generate energy.&rdquo; The tags do not change what the activities are;
        they let the allocator make sure each habit gets touched.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Monthly minimum-touch goals</h2>
      <p>
        Per habit, set a monthly minimum-touch count. Touches are blocks, not minutes. Three
        twenty-minute blocks of &ldquo;raise necessity&rdquo; (writing a public commitment,
        confirming a deadline with a stakeholder, recording a why-I-care voice memo) is more useful
        than one sixty-minute aspirational session.
      </p>
      <p>
        The allocator distributes the touches across the four-ish weeks of the month so they do
        not pile into the last week — the planner is biased toward an even spread because that is
        what predicts the habit actually forming.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">A starting touch count per habit</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Seek clarity.</strong> 4–8 touches per month. Includes weekly review days and
          quarterly self-assessment blocks.
        </li>
        <li>
          <strong>Generate energy.</strong> 12–20 touches per month. Includes workouts, sleep
          discipline, walks, and nutrition planning.
        </li>
        <li>
          <strong>Raise necessity.</strong> 4 touches per month. Most adults under-touch this; a
          monthly &ldquo;why does this matter&rdquo; block helps.
        </li>
        <li>
          <strong>Increase productivity.</strong> 4–8 touches per month. Process and tooling
          improvements, not the everyday execution itself.
        </li>
        <li>
          <strong>Develop influence.</strong> 4–8 touches per month. Public writing, intentional
          relationship blocks, mentoring.
        </li>
        <li>
          <strong>Demonstrate courage.</strong> 1–4 touches per month. The hard conversation, the
          public ask, the unpopular decision recorded.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How HP6 fits with HPP rhythms</h2>
      <p>
        HPP — the High Performance Planner format — pairs the HP6 framework with daily and weekly
        rhythms: morning intention bookends, evening scorecard reviews, weekly &ldquo;whole life&rdquo;
        assessments, monthly strategy days. Calendar Automations does not ship those prompts
        verbatim (they are copyrighted), but it does support the rhythms as configurable blocks:
      </p>
      <ul className="list-disc pl-5">
        <li>Morning intention block, with your own paraphrased prompt list.</li>
        <li>Evening scorecard block.</li>
        <li>Weekly review day (default Friday afternoon, configurable).</li>
        <li>Monthly strategy day (default first Monday, configurable).</li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Habit tags versus a task scheduler</h2>
      <p>
        Task schedulers — SkedPal, Reclaim, Motion, Sunsama — operate at the wrong cadence for
        HP6. Their unit of work is a task with a deadline; HP6&apos;s unit of work is a habit with
        a monthly minimum-touch count. A scheduler will happily slot a one-off &ldquo;courage&rdquo;
        block into the calendar if you remember to add it, but it will not warn you that
        Demonstrate courage has been at zero touches for three weeks. That is the gap Calendar
        Automations fills.
      </p>
      <p>
        Run them together. Mark your scheduler&apos;s calendar as a busy source. The HP6 monthly
        minimums then get distributed across the gaps the scheduler does not claim, with the
        even-spread bias preserved. Your scheduler keeps doing reactive task flow; the habit
        scaffolding sits one layer above it.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Common failure modes</h2>
      <p>
        The most common HP6 failure mode is over-touching the easy habits and under-touching the
        hard ones. Generate energy is easy because workouts are concrete; demonstrate courage is
        hard because it requires a real interpersonal cost. The monthly minimum-touch constraint
        is specifically designed to make courage&apos;s zero look bad in the dashboard so you have
        to do something about it.
      </p>
      <p>
        The second failure mode is treating habit tags as performance theatre — tagging
        everything &ldquo;increase productivity&rdquo; because it makes the dashboard look busy.
        Tag honestly. The framework only works if the tag describes the habit you actually intended
        to develop, not the activity&apos;s nominal output.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Reviewing the month</h2>
      <p>
        At the end of the month, the dashboard shows touch counts per habit against your minimums.
        Three things to look at: which habit was zero (and why), which habit was inflated by
        ceremonial blocks that did not move anything, and whether any habit deserves a higher
        minimum next month. Adjust, do not punish; the framework is a scaffold, not a scorecard.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Attribution</h2>
      <p>
        HP6 and HPP terminology come from Brendon Burchard&apos;s <em>High Performance Habits</em>
        and the High Performance Planner. Calendar Automations is not affiliated with or endorsed
        by Brendon Burchard. The app provides structure (tags and counts); you provide your own
        copy.
      </p>
    </ArticleLayout>
  );
}
