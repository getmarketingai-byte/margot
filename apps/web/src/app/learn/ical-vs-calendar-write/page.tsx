import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "ical-vs-calendar-write";
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
      answer="Publishing iCal feeds and writing events to a calendar API solve different problems. iCal subscription gives users a portable, reversible, read-only output that works on Apple, Google, and Outlook with one URL and zero write scope. Direct API writes give faster, native blocks, but require write OAuth, complex sync, and per-platform integrations. Calendar Automations chooses iCal subscription for v1 because reach, reversibility, and least-privilege auth outweigh the refresh latency."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">The two options</h2>
      <p>
        Any planning app that wants to put blocks on a user&apos;s calendar has two architectural
        choices. The first is to write events directly to the calendar provider through their API,
        for example the Google Calendar API or Microsoft Graph. The second is to publish a
        standards-compliant iCalendar (RFC 5545) feed and let the user subscribe to it from their
        calendar app of choice.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">OAuth scope and verification</h2>
      <p>
        Direct write requires write-scope OAuth. For Google that means scopes like{" "}
        <code>https://www.googleapis.com/auth/calendar</code> or{" "}
        <code>https://www.googleapis.com/auth/calendar.events</code>, which trigger Google&apos;s
        sensitive-scope verification process. iCal subscription needs zero write scope. Calendar
        Automations only requests <code>calendar.readonly</code> and{" "}
        <code>calendar.calendarlist.readonly</code> because the read path is the only access the app
        actually needs to compute the schedule.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Multi-platform reach</h2>
      <p>
        One iCal URL works in Apple Calendar (macOS, iOS, iPadOS), Google Calendar (Add by URL),
        Outlook on the web and desktop, Fastmail, and most CalDAV-aware clients. Direct writes
        require a separate provider integration each: Google needs its API and verification,
        Microsoft needs Graph and a separate consent flow, Apple has no general write API for
        third-party apps. iCal subscription collapses that fan-out to one publisher.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Reversibility and trust</h2>
      <p>
        With direct writes, mistakes land in the user&apos;s primary calendar and have to be cleaned
        up by the app. With subscriptions, the planned blocks live on a separate, named calendar
        the user can hide, unsubscribe, or delete in one click. That maps cleanly to a least-trust
        onboarding: the user gives the app read access, sees what it produces in a separate
        calendar, then decides whether to keep the subscription.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Refresh latency</h2>
      <p>
        The honest tradeoff is latency. Calendar apps refresh subscribed feeds on their own
        schedule. Apple Calendar lets the user pick — every 15 minutes is the tightest
        commonly-supported option. Google Calendar URL subscriptions typically refresh every
        several hours and the cadence is not user-configurable. Calendar Automations sets the
        iCal <code>X-PUBLISHED-TTL</code> hint to 30 minutes and keeps server-side cache short, but
        the client always has the final say. Direct writes appear immediately.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">When direct writes win</h2>
      <p>
        If the product&apos;s value depends on instant placement — for example a meeting scheduler
        that books an external party, or a focus timer that drops a 25-minute block now — direct
        writes are the right call. For weekly planning, where the schedule is regenerated on a job
        cadence rather than on every keystroke, subscription is a better fit.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What Calendar Automations does</h2>
      <p>
        v1 publishes iCal feeds only. The architecture leaves room to add an opt-in &ldquo;push to
        Google Calendar&rdquo; mode later that requires a separate write-scope consent — that mode
        would never be the default and never be required for the core product to work.
      </p>
    </ArticleLayout>
  );
}
