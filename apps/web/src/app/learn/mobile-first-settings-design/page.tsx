import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "mobile-first-settings-design";
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
      answer="A planner has dozens of knobs but most users only adjust a handful per session. Calendar Automations is built mobile-first with progressive disclosure: defaults land on the screen, advanced controls live behind clearly labeled accordions, and JSON import/export gives power users a single-file workflow. Every page works at 320 px wide and every action is reachable with a thumb."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why this is hard</h2>
      <p>
        Configuration-heavy apps tend to converge on dense settings pages with a left sidebar of
        categories and a right pane of fields. That works on a 1280-pixel-wide laptop and is
        unusable on a phone. Most planning apps respond by making the mobile UI a stripped-down
        view-only surface and pushing all configuration to a desktop site nobody opens.
      </p>
      <p>
        Calendar Automations went the other direction: every setting that matters can be changed
        on a phone in a few thumb taps, and the desktop view is mostly a wider version of the
        mobile view. The frameworks that make this work are progressive disclosure, sensible
        defaults, and an explicit power-user escape hatch.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Progressive disclosure</h2>
      <p>
        Each settings page exposes the five-or-so fields most users adjust, in plain language, at
        the top. Anything more advanced — chunk size, scheduling window length, transparency
        handling for soft holds — lives behind a labeled &ldquo;Advanced&rdquo; accordion. The
        accordion is collapsed by default. Users who do not need it never see it; users who do
        know exactly where to find it.
      </p>
      <p>
        The rule for what counts as &ldquo;advanced&rdquo;: any setting where touching it without
        understanding the consequence will make the planner produce a worse schedule than the
        default. Those settings deserve the friction of an accordion.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Sensible defaults</h2>
      <p>
        Defaults come from the legacy Apps Script <code>Config.gs</code>, refined over months of
        single-tenant usage. Default scheduling window is 60 days. Default sleep window is 11 PM
        to 7 AM. Default energy ordering is balanced. Default day window is 6 AM to 10 PM. Default
        timemap bands are Needle-Mover, Execute, Ops, Play. None of these are ideal for everyone,
        but every one of them produces a reasonable schedule on the first run, which is the bar
        for &ldquo;sign in, see something useful in two minutes.&rdquo;
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Big touch targets</h2>
      <p>
        Buttons and toggles are sized for thumbs (44×44 px minimum, per the iOS Human Interface
        Guidelines). The bottom navigation on mobile is sticky so primary navigation is always
        within reach. Nothing important hides behind hover-only behaviors.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Inputs that work on a phone</h2>
      <p>
        Time pickers, day-of-week selectors, minute counters, and number inputs all use the
        platform&apos;s native control. We do not roll custom date pickers; iOS users get the
        iOS picker and Android users get theirs. The savings come from <em>not</em> trying to be
        clever — every minute spent reinventing a wheel input is a minute the user is staring at
        a slightly worse version of something they already know.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Power-user JSON import/export</h2>
      <p>
        For users coming from a single-file <code>Config.gs</code> workflow, the entire user
        settings JSON can be exported as a file and re-imported. This is the same JSON the
        database stores, validated by the same Zod schema. Users can edit it in a text editor,
        commit it to a personal repo, share a redacted version with a coach — whatever they want.
        The mobile UI is the primary surface; the JSON is the escape hatch.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Versioned schema migrations</h2>
      <p>
        Every saved settings document carries a <code>schemaVersion</code> number. When we change
        the shape of the JSON — adding a new framework, renaming a field, adjusting defaults — we
        ship a migration so old documents continue to load and old exports continue to import. The
        cost is a small migration unit-test suite; the benefit is users never lose configuration to
        a release.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What we explicitly chose not to do</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>No infinite scroll.</strong> Settings pages are bounded. If a section grows
          beyond two screens of content, it splits into a sub-page rather than scrolling forever.
        </li>
        <li>
          <strong>No drag-and-drop on mobile.</strong> Drag-and-drop on touch is a fragile
          interaction; goals reorder via up/down arrows, which work on every device.
        </li>
        <li>
          <strong>No live preview canvas.</strong> A live mini-calendar preview that updates with
          every keystroke sounds nice and is expensive to keep correct. The planner produces a
          full snapshot in seconds; the user can run it on demand and look at the actual feed.
        </li>
        <li>
          <strong>No SPA routing weirdness.</strong> Each settings sub-page is a real Next.js
          route; the back button works, deep links work, share-this-link-with-a-coach works.
        </li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why the mobile-first stance is honest</h2>
      <p>
        Most users who care about weekly planning carry their calendar in their pocket and review
        it in three- to five-minute bursts: in line at a coffee shop, during a kid&apos;s nap,
        between meetings. A planner that demands a fifteen-minute desktop session every Sunday
        afternoon is asking for a behavior most users will not perform. Building mobile-first is
        not an aesthetic preference; it is the only way the product produces value at the cadence
        users actually engage.
      </p>
    </ArticleLayout>
  );
}
