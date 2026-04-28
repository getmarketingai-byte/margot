import Link from "next/link";
import type { Metadata } from "next";
import { OAUTH_SCOPES, PRODUCT, SITE_URL } from "@/lib/marketing";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Privacy Policy",
  description: `How Calendar Automations collects, stores, and uses calendar-derived data. Specific OAuth scopes, retention rules, and your rights.`,
  alternates: { canonical: "/privacy" }
};

const LAST_UPDATED = "April 28, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-10 sm:max-w-3xl">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-xs uppercase tracking-widest text-ink-400">
          ← {PRODUCT.name}
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Privacy Policy</h1>
        <p className="text-xs text-ink-400">Last updated {LAST_UPDATED}</p>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          This policy explains what Calendar Automations reads from your calendar, what we store,
          and how to remove your data. Plain English; no dark patterns.
        </p>
      </header>

      <article className="flex flex-col gap-5 text-sm leading-relaxed text-ink-600 dark:text-ink-200 sm:text-base">
        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">1. Who we are</h2>
          <p>
            Calendar Automations (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a weekly planning service
            available at <code>{SITE_URL}</code>. The data controller for the purposes of this
            policy is the operator of {PRODUCT.legalName}. Contact:{" "}
            <a className="underline" href={`mailto:${PRODUCT.contactEmail}`}>
              {PRODUCT.contactEmail}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">2. What we collect</h2>
          <p>We collect three categories of data, and only those.</p>
          <ul className="mt-2 list-disc pl-5">
            <li>
              <strong>Account identity.</strong> When you sign in with Google, we receive your
              name, email address, profile picture, and a Google account identifier. These come
              from the standard <code>openid email profile</code> scopes and are stored in our
              user table.
            </li>
            <li>
              <strong>Calendar metadata and busy intervals.</strong> When the planner runs, it
              queries your selected calendars over the read-only Google Calendar scopes
              ({OAUTH_SCOPES.filter((s) => s.startsWith("https://")).join(", ")}) and computes
              start/end pairs of busy time. We do not persist event titles, descriptions,
              attendees, locations, attachments, or any other event content.
            </li>
            <li>
              <strong>Settings and snapshots.</strong> The Wheel of Life areas, PPF mix targets,
              HP6 habit tags, energy preferences, weekly goals, and consistency segments you
              configure are stored as JSON in our database. The most recent generated calendar
              snapshot is also stored so iCal feed requests are fast.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">3. How we use it</h2>
          <ul className="list-disc pl-5">
            <li>
              <strong>To run the planner.</strong> Computing your weekly schedule requires reading
              your calendars and reading your settings. There is no other use of either dataset.
            </li>
            <li>
              <strong>To serve your iCal feed.</strong> When your calendar app fetches your
              feed URL, we read the latest snapshot from the database, render it as iCalendar
              text, and respond.
            </li>
            <li>
              <strong>To bill you.</strong> If you subscribe, Stripe handles the card details and
              we receive only a customer identifier and subscription status.
            </li>
            <li>
              <strong>For service operations.</strong> Logs (without raw OAuth tokens) help us
              diagnose failures, fix bugs, and meet uptime goals.
            </li>
          </ul>
          <p className="mt-2">
            We do not sell your data. We do not share calendar data with advertisers. We do not
            train AI models on your calendar.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">4. Where it lives</h2>
          <p>
            User accounts, settings, the latest calendar snapshot, and feed tokens live in a
            Postgres database hosted on Neon. OAuth refresh tokens are encrypted at rest with an
            envelope key (<code>TOKEN_ENCRYPTION_KEY</code>) before they touch the database. The
            web app is hosted on Vercel; background jobs run on Inngest. Subprocessors:
          </p>
          <ul className="mt-2 list-disc pl-5">
            <li>Google LLC — OAuth and Calendar API.</li>
            <li>Vercel Inc. — web hosting and CDN.</li>
            <li>Neon Inc. — managed Postgres.</li>
            <li>Inngest Inc. — background job orchestration.</li>
            <li>Stripe Inc. — payment processing (card data never touches our servers).</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">5. Retention</h2>
          <p>
            We keep one snapshot per user (the most recent generation overwrites the previous).
            Settings and account records persist for as long as your account exists. Logs are
            rotated regularly. When you delete your account, we remove your settings, your latest
            snapshot, and your feed tokens. Stripe customer records are retained per Stripe&apos;s
            policy and may be required for tax purposes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">6. Cookies and analytics</h2>
          <p>
            We use Google Analytics (<code>G-8Z630KTF4J</code>) to understand high-level traffic
            patterns. It uses cookies and writes to <code>localStorage</code>. We have not
            configured Google Signals or cross-device tracking. Google AdSense (
            <code>{(process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID ?? "ca-pub-7076137753154472")}</code>)
            may serve advertisements on this site and uses cookies for ad selection,
            personalization, and measurement.
          </p>
          <p className="mt-2">
            You can opt out of personalized advertising at{" "}
            <a className="underline" href="https://www.google.com/settings/ads">
              google.com/settings/ads
            </a>
            , and you can manage non-essential cookies through your browser settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">7. Your rights</h2>
          <ul className="list-disc pl-5">
            <li>
              <strong>Access.</strong> Email{" "}
              <a className="underline" href={`mailto:${PRODUCT.contactEmail}`}>
                {PRODUCT.contactEmail}
              </a>{" "}
              and we will provide a copy of the settings and snapshot we hold for you.
            </li>
            <li>
              <strong>Correction.</strong> Update settings yourself in the dashboard, or email us
              if anything else looks wrong.
            </li>
            <li>
              <strong>Deletion.</strong> Self-serve from the dashboard, or by email.
            </li>
            <li>
              <strong>Objection and restriction.</strong> Contact us; we will pause processing where
              the law requires.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">8. Google API limited use</h2>
          <p>
            Calendar Automations&apos; use of information received from Google APIs adheres to the{" "}
            <a
              className="underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We use Google user data only to provide and
            improve user-facing features visible in the app. We do not transfer this data to others
            for advertising, we do not allow humans to read this data unless we have explicit
            consent (for example, debugging a support ticket you raised), and we do not use this
            data to train generalized machine-learning or AI models.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">9. Children</h2>
          <p>
            Calendar Automations is not directed to children under 16, and we do not knowingly
            collect personal information from children. If you believe a child has provided
            information to us, please contact us and we will delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">10. Changes to this policy</h2>
          <p>
            We will update this policy when we make material changes. The &ldquo;Last updated&rdquo;
            date at the top of this page tracks the most recent change. For significant changes
            (new subprocessors, new data categories, new uses) we will also notify you in-app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">11. Contact</h2>
          <p>
            Questions about this policy?{" "}
            <a className="underline" href={`mailto:${PRODUCT.contactEmail}`}>
              {PRODUCT.contactEmail}
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
