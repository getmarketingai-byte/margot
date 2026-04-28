import Link from "next/link";
import {
  ARTICLES,
  FAQ,
  FEATURES,
  FEED_BEHAVIOR,
  OAUTH_SCOPES,
  PRODUCT,
  SITE_URL
} from "@/lib/marketing";
import {
  faqPageLd,
  organizationLd,
  webApplicationLd,
  websiteLd
} from "@/lib/json-ld";
import { JsonLd } from "@/components/json-ld";
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
  description: PRODUCT.shortDescription,
  alternates: { canonical: "/" },
  openGraph: {
    title: PRODUCT.name,
    description: PRODUCT.shortDescription,
    url: SITE_URL,
    siteName: PRODUCT.name,
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT.name,
    description: PRODUCT.shortDescription
  }
};

const TOP_FAQ = FAQ.slice(0, 4);

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-12 px-5 pb-16 pt-10 sm:max-w-3xl">
      <JsonLd
        data={[
          organizationLd(),
          websiteLd(),
          webApplicationLd(),
          faqPageLd(TOP_FAQ)
        ]}
      />

      <header className="flex flex-col gap-4">
        <span className="text-xs uppercase tracking-widest text-ink-400">{PRODUCT.name}</span>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{PRODUCT.tagline}</h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">{PRODUCT.shortDescription}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/api/auth/signin?callbackUrl=/dashboard" className="btn-primary">
            Sign in with Google
          </Link>
          <Link href="/dashboard" className="btn-secondary">
            Open dashboard
          </Link>
          <Link href="/faq" className="btn-secondary">
            FAQ
          </Link>
        </div>
      </header>

      <section
        aria-label="What it does in one minute"
        className="card flex flex-col gap-3"
      >
        <h2 className="text-base font-semibold">What it does, in plain terms</h2>
        <ul className="flex flex-col gap-2 text-sm text-ink-600 dark:text-ink-200">
          <li>
            Reads up to 60 days of your existing Google Calendar over read-only OAuth and finds the
            free gaps.
          </li>
          <li>
            Allocates your weekly goals into those gaps with energy-aware ordering, Wheel of Life
            balance, and PPF mix targets.
          </li>
          <li>
            Publishes the planned blocks as a private iCal feed at{" "}
            <code>{FEED_BEHAVIOR.pathPattern}</code> that you subscribe to from any calendar app.
          </li>
          <li>
            Never writes events to your calendar in v1. The OAuth scopes are{" "}
            <code>calendar.readonly</code> and <code>calendar.calendarlist.readonly</code>.
          </li>
        </ul>
      </section>

      <section aria-label="Capabilities" className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <article key={f.title} className="card">
            <h2 className="text-base font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{f.body}</p>
          </article>
        ))}
      </section>

      <section aria-label="Frequently asked" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Frequently asked</h2>
        <div className="flex flex-col gap-3">
          {TOP_FAQ.map((entry) => (
            <details key={entry.question} className="card">
              <summary className="cursor-pointer text-sm font-semibold">{entry.question}</summary>
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{entry.answer}</p>
            </details>
          ))}
        </div>
        <Link href="/faq" className="text-sm font-medium text-accent">
          See all questions →
        </Link>
      </section>

      <section aria-label="Pillar articles" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Read more</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ARTICLES.map((a) => (
            <li key={a.slug}>
              <Link href={`/learn/${a.slug}`} className="card flex h-full flex-col gap-2">
                <span className="text-sm font-semibold">{a.title}</span>
                <span className="text-xs text-ink-600 dark:text-ink-200">{a.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-xs text-ink-400">
        Read-only OAuth scopes: {OAUTH_SCOPES.join(", ")}.
      </footer>
    </main>
  );
}
