import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "wheel-of-life-weekly-planning";
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
      answer="Use a Wheel of Life self-assessment as the input to a weekly minimum-minutes constraint, not as decorative scoring. Pick the eight or so life areas that matter to you, score current satisfaction one to ten, set a weekly minute floor for each area you actually want to move, and let the allocator guarantee those slots before discretionary work fills the rest of the week."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What Wheel of Life is supposed to do</h2>
      <p>
        The Wheel of Life is an old coaching exercise. You list the major areas of your life — body,
        relationships, finances, career, contribution, spirituality, time, fun — score each one
        from one to ten on current satisfaction, and look at the resulting wheel for low spots.
        The exercise produces clarity quickly, but on its own it does almost nothing for behavior:
        most people score the wheel, feel a flicker of motivation, and continue spending the same
        ninety percent of their week on whichever area their job demands.
      </p>
      <p>
        The interesting question is not whether the wheel is well-balanced as a snapshot. It is
        whether next week&apos;s allocation reflects any change. That is what Calendar Automations
        treats as the actual job: turn the wheel from an introspective exercise into a scheduling
        constraint that survives a busy Monday.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Setting weekly minimums per area</h2>
      <p>
        For every area you care about, set two numbers: your current satisfaction (1–10) and a
        weekly minute floor. Floors do not have to be heroic. A relationship area with a sixty-
        minute floor — one walk, one phone call, one shared meal in a week — is more honest than a
        ten-hour aspiration that misses every Tuesday.
      </p>
      <p>
        The allocator treats those floors as <em>guaranteed minutes</em>. When it lays goals into
        free intervals, it reserves the floor minutes per area first and only fills the remainder
        with discretionary goals. That ordering is the whole trick. Without it, work always wins,
        because work pre-books the day with meetings and the wheel becomes a wishlist.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How the floors interact with energy modes</h2>
      <p>
        Floor minutes still have an energy tag. A &ldquo;body&rdquo; floor that points to a
        morning workout has a different energy mode than a &ldquo;learning&rdquo; floor that points
        to an evening reading block. The allocator combines both signals: which area needs minutes,
        and what energy mode that area&apos;s slot prefers. Conflicts are resolved by priority and
        by anchor: if the &ldquo;body&rdquo; floor has a 6 AM anchor, it wins that slot regardless
        of energy.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What floors should not be</h2>
      <p>
        Floors should not be vague. &ldquo;Time for myself&rdquo; is not a floor; it is an
        emotion. A floor needs to convert into a calendar block — a runnable, recognizable
        activity. If you cannot describe what you would do in those minutes when you sit down on
        Wednesday at 7 PM, the floor is not yet a scheduling constraint, it is a wish.
      </p>
      <p>
        Floors should also not exceed the discretionary capacity of your week. If you have ten
        hours of genuinely free time and you set thirty hours of floors, the allocator will warn,
        sort by priority, and skip the lowest. Calendar Automations will not pretend the math
        works; it will tell you which floors did not get scheduled and you decide what to drop.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Re-scoring at a sane cadence</h2>
      <p>
        We recommend re-scoring the wheel at the start of each month, not weekly. Weekly re-scores
        are noise — your subjective satisfaction in &ldquo;contribution&rdquo; oscillates day to
        day for reasons that are not actionable. Monthly re-scores let you see if the floor minutes
        are actually moving the wheel, and if not, whether the issue is the minute count, the slot
        timing, or the activity definition.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why this beats the static wheel</h2>
      <p>
        Most planning apps treat life balance as a category tag. You assign tasks to a wheel area,
        the dashboard renders pretty pie charts, and nothing changes about how the week unfolds.
        Calendar Automations treats balance as a precondition: areas with floors get minutes
        before the rest of the week is allocated, and the iCal feed reflects the result. The
        outcome is mundane and powerful — you open Apple Calendar on a Tuesday morning and the
        thirty minutes you said you wanted for a phone call with your sister is actually there.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Practical starting set</h2>
      <p>
        For most operators we recommend starting with eight areas: physical body, emotions and
        meaning, key relationships, work and mission, finances, contribution, spirituality, and
        time / energy management itself. Score each on a one to ten scale, identify the two
        lowest, and set a generous floor on each of them — generous meaning &ldquo;more than you
        think you can sustain, less than you wish you could.&rdquo; Run that for four weeks and
        re-score.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Where it does not apply</h2>
      <p>
        If you are in a season where one area legitimately deserves all of your attention — a new
        baby, a launch week, a medical emergency — pause floors temporarily. Do not pretend the
        framework still applies; the planner has a global &ldquo;ignore balance&rdquo; toggle
        because honesty about a season beats forcing the wheel to look right while the rest of
        your life burns.
      </p>
    </ArticleLayout>
  );
}
