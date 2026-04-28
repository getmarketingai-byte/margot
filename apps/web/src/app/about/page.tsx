import Link from "next/link";
import type { Metadata } from "next";
import { OAUTH_SCOPES, PRODUCT, SITE_URL } from "@/lib/marketing";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "About",
  description: `Calendar Automations is the balance layer for your existing scheduler — SkedPal, Reclaim, Motion, Sunsama. It publishes private iCal feeds that surface Wheel of Life, PPF, and HP6 goals in the calendar app you already use. Read about why the project exists, who it is for, and how it is built.`,
  alternates: { canonical: "/about" }
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-10 sm:max-w-3xl">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-xs uppercase tracking-widest text-ink-400">
          ← {PRODUCT.name}
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">About Calendar Automations</h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          The balance layer for your existing scheduler — designed to run alongside SkedPal,
          Reclaim, Motion, or Sunsama, not replace them. We read your existing calendar, do the
          weekly framework allocation, and publish the result as a private iCal feed.
        </p>
      </header>

      <section className="flex flex-col gap-3 text-sm leading-relaxed text-ink-600 dark:text-ink-200 sm:text-base">
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why this exists</h2>
        <p>
          Calendar Automations started as a single-tenant Google Apps Script project that ran every
          night, computed a weekly schedule based on energy modes and life-balance frameworks, and
          wrote the resulting blocks straight into the operator&apos;s personal calendar. It was
          fast, opinionated, and brittle in all the ways single-tenant scripts get brittle: hand-
          edited config, runtime quotas, no settings UI, no way for anyone else to use it without a
          fork.
        </p>
        <p>
          The web app is a deliberate rewrite. Same allocation logic — Wheel of Life balance, PPF
          mix, HP6 habits, energy ordering, consistency segments — but with a settings UI, a
          background job runner, and a different output strategy: a private iCal feed instead of a
          direct write into the user&apos;s calendar. That last change is what makes the rest of
          the design fall into place.
        </p>

        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Who it is for</h2>
        <p>{PRODUCT.audience}</p>
        <p>
          If you already use SkedPal, Reclaim, Motion, or Sunsama for reactive task scheduling and
          the only thing missing is a deliberate weekly balance step — Wheel of Life, PPF, HP6,
          energy-aware ordering — Calendar Automations is built for you. If you want a brand new
          calendar surface to live in, or a scheduler replacement, this is not that.
        </p>

        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Design principles</h2>
        <ul className="list-disc pl-5">
          <li>
            <strong>Read-only by default.</strong> The OAuth scopes are{" "}
            <code>{OAUTH_SCOPES.join(", ")}</code>. There is no write path in v1.
          </li>
          <li>
            <strong>iCal-first output.</strong> One URL works in Apple Calendar, Google Calendar,
            Outlook, and any RFC 5545 client. You can unsubscribe in one click.
          </li>
          <li>
            <strong>Frameworks as tags, not gospel.</strong> Wheel of Life, PPF, HP6, and energy
            modes are all optional, configurable, and combine without one starving another.
          </li>
          <li>
            <strong>Mobile-first.</strong> The whole settings flow is designed to be done on a
            phone in a few minutes. Power users still get JSON import/export.
          </li>
          <li>
            <strong>Single source of truth.</strong> Every public claim about the product — landing
            copy, FAQ, llms.txt, JSON-LD, the MCP server — reads from one TypeScript module, so
            surfaces cannot disagree.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How the project is built</h2>
        <p>
          The web app runs on Next.js 15 (App Router) hosted on Vercel. Authentication is Auth.js
          v5 with Google OAuth. Settings, accounts, and the latest generated calendar snapshot live
          in a Postgres database on Neon, accessed through Drizzle ORM. Background regeneration
          runs on Inngest, kicked off by a Vercel Cron schedule. Stripe handles billing.
        </p>
        <p>
          The scheduling engine — interval algebra, busy-merge, gap-finding, the time-mapped band
          allocator, sleep and travel placement, the weekly goal allocator — is a pure-TypeScript
          package called <code>@calendar-automations/planner</code>. It has no Next.js dependency
          and is covered by a fixture-based test suite ported from the original Apps Script logs,
          so behavior changes are visible diffs rather than mystery regressions.
        </p>

        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What we don&apos;t do</h2>
        <p>
          Calendar Automations is not a meeting scheduler, not an availability picker, and not a
          coaching service. The energy modes are scheduling tags — they help the allocator place
          deep work earlier in the day — they are not health or performance claims. The frameworks
          we support are well-known public methodologies; we provide the structure, time, and
          measurement, not a licensed reproduction of any third party&apos;s materials.
        </p>

        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Get in touch</h2>
        <p>
          Questions, feedback, or vendor inquiries:{" "}
          <a className="underline" href={`mailto:${PRODUCT.contactEmail}`}>
            {PRODUCT.contactEmail}
          </a>
          . See the{" "}
          <Link className="underline" href="/contact">
            contact page
          </Link>{" "}
          for more.
        </p>
      </section>
    </main>
  );
}
