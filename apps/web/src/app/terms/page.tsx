import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT, SITE_URL } from "@/lib/marketing";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Terms of Service",
  description: `The terms governing your use of Calendar Automations: account responsibilities, acceptable use, billing, warranties, and termination.`,
  alternates: { canonical: "/terms" }
};

const LAST_UPDATED = "April 28, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-10 sm:max-w-3xl">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-xs uppercase tracking-widest text-ink-400">
          ← {PRODUCT.name}
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Terms of Service</h1>
        <p className="text-xs text-ink-400">Last updated {LAST_UPDATED}</p>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          By using Calendar Automations you agree to these terms. They are written to be readable;
          if anything is unclear, email us before you sign up.
        </p>
      </header>

      <article className="flex flex-col gap-5 text-sm leading-relaxed text-ink-600 dark:text-ink-200 sm:text-base">
        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">1. The service</h2>
          <p>
            Calendar Automations is a hosted weekly planning service available at{" "}
            <code>{SITE_URL}</code>. The service reads your selected calendars over read-only OAuth,
            allocates your weekly goals into the free intervals, and publishes the resulting
            schedule as a private iCalendar feed. The service does not write events to your
            calendar in v1.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">2. Your account</h2>
          <p>
            You sign in with Google. You are responsible for keeping your Google account secure and
            for the activity that happens under your Calendar Automations account. Notify us at{" "}
            <a className="underline" href={`mailto:${PRODUCT.contactEmail}`}>
              {PRODUCT.contactEmail}
            </a>{" "}
            if you suspect unauthorized use.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">3. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc pl-5">
            <li>Use the service for any unlawful purpose or in violation of any third-party rights.</li>
            <li>Attempt to gain unauthorized access to the service, other accounts, or our infrastructure.</li>
            <li>Resell, sublicense, or repackage the service without a written agreement.</li>
            <li>Reverse engineer the service except as expressly permitted by applicable law.</li>
            <li>Submit content that infringes intellectual property rights or violates the law.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">4. Billing and refunds</h2>
          <p>
            Paid plans are billed through Stripe. Pricing and the current plan options are shown on
            the in-app billing page. Subscriptions renew automatically until you cancel; you can
            cancel at any time through the Stripe Customer Portal linked from the billing page.
            Prepaid amounts are non-refundable except where required by law.
          </p>
          <p className="mt-2">
            When a subscription lapses, the iCal feed serves a single explanatory event in place
            of your schedule so you have a clear in-calendar message rather than a silent failure.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">5. Your content</h2>
          <p>
            You retain ownership of the calendar data we read on your behalf and of the settings
            you submit. You grant us a non-exclusive license to process that data only as necessary
            to provide the service, as described in the{" "}
            <Link className="underline" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">6. Service availability</h2>
          <p>
            We aim for high availability but do not guarantee uninterrupted service. Background
            regeneration cadence and iCal feed refresh latency depend on third-party schedules
            (Vercel Cron, Inngest job runners) and on your calendar app&apos;s own refresh
            interval. We will not be liable for missed blocks caused by client-side cache lag.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">7. Disclaimer of warranties</h2>
          <p>
            The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
            warranties of any kind, whether express or implied, including but not limited to
            implied warranties of merchantability, fitness for a particular purpose, and
            non-infringement. The energy modes, framework tags, and rhythm reminders are scheduling
            tools — they are not medical, psychological, or coaching advice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">8. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, our aggregate liability for any claim arising
            out of or relating to the service is limited to the greater of (a) the amounts you paid
            us in the twelve months preceding the claim or (b) USD 50. We will not be liable for
            indirect, incidental, special, consequential, or punitive damages.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">9. Termination</h2>
          <p>
            You can stop using the service and delete your account at any time from the dashboard.
            We may suspend or terminate accounts that violate these terms. Upon termination we
            delete your settings, snapshots, and feed tokens; backup retention is described in the
            Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">10. Changes</h2>
          <p>
            We may update these terms from time to time. The &ldquo;Last updated&rdquo; date at the
            top tracks the most recent change. Continued use of the service after a change
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">11. Contact</h2>
          <p>
            Questions about these terms?{" "}
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
