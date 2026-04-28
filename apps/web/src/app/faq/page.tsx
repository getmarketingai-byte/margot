import Link from "next/link";
import type { Metadata } from "next";
import {
  CANONICAL_URLS,
  FAQ,
  PRICING_NOTE,
  PRODUCT,
  SUBSCRIBE_APPLE_STEPS,
  SUBSCRIBE_GOOGLE_STEPS,
  SITE_URL,
  type IntegrationStep
} from "@/lib/marketing";
import {
  faqPageLd,
  subscribeAppleHowToLd,
  subscribeGoogleHowToLd
} from "@/lib/json-ld";
import { JsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `FAQ — ${PRODUCT.name}`,
  description: `Answers to common questions about ${PRODUCT.name}: OAuth scopes, iCal subscription behavior, privacy, and supported planning frameworks.`,
  alternates: { canonical: "/faq" }
};

function StepList({ steps }: { steps: ReadonlyArray<IntegrationStep> }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-600 dark:text-ink-200">
      {steps.map((s) => (
        <li key={s.name}>
          <strong className="text-ink-900 dark:text-ink-100">{s.name}.</strong> {s.text}
        </li>
      ))}
    </ol>
  );
}

export default function FaqPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-5 pb-16 pt-10 sm:max-w-3xl">
      <JsonLd data={[faqPageLd(), subscribeGoogleHowToLd(), subscribeAppleHowToLd()]} />

      <header className="flex flex-col gap-3">
        <Link href="/" className="text-xs uppercase tracking-widest text-ink-400">
          ← {PRODUCT.name}
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Frequently asked questions</h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          Direct answers about how Calendar Automations connects to Google Calendar, what data it
          stores, and how to subscribe to the iCal feeds.
        </p>
      </header>

      <section aria-label="FAQ" className="flex flex-col gap-3">
        {FAQ.map((entry) => (
          <article key={entry.question} className="card">
            <h2 className="text-base font-semibold">{entry.question}</h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{entry.answer}</p>
          </article>
        ))}
      </section>

      <section aria-label="Subscribe in Google Calendar" className="card">
        <h2 className="text-base font-semibold">Subscribe in Google Calendar</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
          Add a Calendar Automations iCal feed to Google Calendar using the From URL flow.
        </p>
        <div className="mt-3">
          <StepList steps={SUBSCRIBE_GOOGLE_STEPS} />
        </div>
      </section>

      <section aria-label="Subscribe in Apple Calendar" className="card">
        <h2 className="text-base font-semibold">Subscribe in Apple Calendar</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
          Add a Calendar Automations iCal feed to Apple Calendar on macOS or iOS.
        </p>
        <div className="mt-3">
          <StepList steps={SUBSCRIBE_APPLE_STEPS} />
        </div>
      </section>

      <section aria-label="Pricing" className="card">
        <h2 className="text-base font-semibold">Pricing</h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{PRICING_NOTE}</p>
        <div className="mt-3 flex gap-3">
          <Link href={CANONICAL_URLS.billing} className="btn-secondary">
            Open billing
          </Link>
          <Link href="/api/auth/signin" className="btn-primary">
            Sign in to see plans
          </Link>
        </div>
      </section>
    </main>
  );
}
