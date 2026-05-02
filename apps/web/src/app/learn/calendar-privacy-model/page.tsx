import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { OAUTH_SCOPES, SITE_URL } from "@/lib/marketing";

const SLUG = "calendar-privacy-model";
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
      answer="Calendar Automations stores calendar-derived busy intervals (start, end, source) plus the latest generated schedule, not full event content. OAuth refresh tokens are encrypted at rest with an envelope key. Each iCal feed has its own unguessable, revocable token. Read-only OAuth scopes mean the app cannot edit your calendar even if its database were compromised."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What is read</h2>
      <p>
        On every regeneration the planner queries Google Calendar for events in the user&apos;s
        configured scheduling window (default 60 days forward) on the calendars the user marked as
        busy sources. From each event the planner keeps the start time, end time, and a
        transparency flag (free vs busy). It does not persist event titles, descriptions,
        attendees, locations, or attachments — those are read in-memory and discarded once busy
        intervals are computed.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">OAuth scopes, in full</h2>
      <ul className="list-disc pl-5">
        {OAUTH_SCOPES.map((scope) => (
          <li key={scope}>
            <code>{scope}</code>
          </li>
        ))}
      </ul>
      <p>
        Two of those are the read-only Calendar scopes; the other three are the basic identity
        claims required for sign-in. There is no write scope, no Drive scope, no Gmail scope, and
        no admin scope.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">How tokens are stored</h2>
      <p>
        Google OAuth gives the app a short-lived access token and a long-lived refresh token. The
        refresh token is encrypted before it touches the database using an envelope key kept in a
        platform secret (<code>TOKEN_ENCRYPTION_KEY</code>). Background regeneration jobs decrypt
        the refresh token in memory, exchange it for a fresh access token, and never log the raw
        material.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Feed tokens</h2>
      <p>
        Each published iCal feed is served at <code>/api/feeds/&lt;token&gt;.ics</code>. The token
        is unguessable and tied to one user and either the full Everything calendar or exactly one of
        your custom curated ICS feeds you define on the dashboard. It is not a JWT, has no embedded
        user identifier, and can be rotated from the dashboard. Knowing one feed token does not grant
        access to any other feed or to the user&apos;s account.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What lives in the database</h2>
      <p>
        The Postgres schema stores the user account, the parsed{" "}
        <code>UserSettings</code> JSON (frameworks, calendars selected as sources, energy
        preferences), the most recent <code>CalendarSnapshot</code> with the generated events, and
        the per-feed tokens. Snapshots are overwritten on each regeneration; we do not keep a long
        history.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Deletion</h2>
      <p>
        Account deletion from the dashboard removes settings, the latest snapshot, and all feed
        tokens. Subscriptions cached by client calendar apps will fail to refresh after deletion
        and the planned blocks will fall off as the cache expires. Stripe customer records are
        retained per Stripe&apos;s own policy.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why &ldquo;read-only&rdquo; matters here</h2>
      <p>
        A privacy claim is only as strong as its weakest scope. Because the app never holds write
        scope, even a worst-case compromise of the database or of the OAuth refresh tokens gives
        an attacker no ability to modify the user&apos;s calendar — only to re-derive the busy
        intervals the user&apos;s own calendar app already shows them.
      </p>
    </ArticleLayout>
  );
}
