import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleLayout } from "@/components/article-layout";
import { articleBySlug } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/marketing";

const SLUG = "background-jobs-vercel-cron-inngest";
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
      answer="Regenerating a 60-day plan across all of a user's calendars exceeds a single serverless invocation's time budget for any active operator. Calendar Automations splits regeneration into idempotent steps orchestrated by Inngest, triggered on a Vercel Cron schedule, so each step finishes well inside its time budget and a failure mid-pipeline retries cleanly without redoing the work that already succeeded."
    >
      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">The constraint</h2>
      <p>
        Vercel serverless functions have a max-duration cap that depends on the plan tier (10s,
        60s, 300s for the higher tiers as of writing). A real regeneration for an active operator
        — five connected calendars, sixty days forward, energy-aware allocation, sleep and travel
        overlays, ICS render, snapshot persist — can exceed even the higher tier on a slow day,
        especially if a calendar API call retries.
      </p>
      <p>
        The legacy Apps Script project hit the same wall years ago. Apps Script execution caps
        forced the introduction of <em>chunk functions</em> in <code>Trigger.gs</code> that broke
        the pipeline into pieces with persistent state in script properties. The Vercel rewrite
        re-encounters the constraint and solves it the same way structurally — split, persist
        progress, retry idempotently — but with proper job-runner infrastructure underneath.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Vercel Cron for the schedule</h2>
      <p>
        Vercel Cron lets us configure a schedule in <code>vercel.json</code> that hits a private
        endpoint on a cadence. The endpoint is a thin handler: it authenticates the cron caller
        (using a shared secret in the <code>Authorization</code> header), enumerates users due
        for regeneration, and emits an Inngest event per user. It does not do the regeneration
        itself — it would time out.
      </p>
      <p>
        That endpoint is sized to be cheap and fast: list users, emit events, return. Even with
        thousands of users, the work done inside the cron handler is bounded by a database query
        and a small batch of HTTP POSTs.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Inngest for the pipeline</h2>
      <p>
        Inngest is a managed step-based workflow runner. Each Inngest function takes an event,
        runs a sequence of <code>step.run</code> calls, and provides three guarantees that matter
        here:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Per-step timeouts.</strong> Each step has its own time budget independent of the
          others. A step that finishes fast leaves room for the next step to start fresh.
        </li>
        <li>
          <strong>Idempotency by step name.</strong> If a step succeeds and a later step fails, on
          retry only the failed step (and onward) re-runs. The successful work is durable.
        </li>
        <li>
          <strong>Persistent state.</strong> Step return values are stored and replayed; the
          function reads them back as if they had just executed locally.
        </li>
      </ul>
      <p>
        For a planner regeneration, the sequence is roughly:
      </p>
      <ol className="list-decimal pl-5">
        <li>Step 1: refresh the user&apos;s OAuth access token.</li>
        <li>Step 2: fetch calendar events for the next 30 days (page 1).</li>
        <li>Step 3: fetch calendar events for days 31–60 (page 2).</li>
        <li>Step 4: compute busy intervals.</li>
        <li>Step 5: query Maps Directions for travel overlays (rate-limited, batched).</li>
        <li>Step 6: run the planner allocator.</li>
        <li>Step 7: render ICS and persist snapshot.</li>
        <li>Step 8: invalidate any per-feed CDN caches if applicable.</li>
      </ol>
      <p>
        Each step finishes inside its timeout. If step 5 fails because Maps Directions throttles,
        Inngest retries step 5 with backoff while leaving steps 1–4 intact. The whole job
        eventually succeeds or fails cleanly; nothing half-completes.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Locks and concurrency</h2>
      <p>
        Two cron events for the same user must not run two regenerations in parallel — they would
        each store their own snapshot, and the last write wins arbitrarily. Inngest&apos;s
        per-key concurrency settings let us pin one in-flight job per user. The cron endpoint can
        emit events freely; Inngest handles the queue.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Failure and retry semantics</h2>
      <p>
        Failures fall into three buckets:
      </p>
      <ul className="list-disc pl-5">
        <li>
          <strong>Transient.</strong> Network blip, third-party 503, brief throttle. Retried
          automatically with backoff.
        </li>
        <li>
          <strong>Auth.</strong> The user&apos;s refresh token has been revoked. Marks the account
          as needing re-auth, surfaces a banner in the dashboard, stops the pipeline cleanly.
        </li>
        <li>
          <strong>Logic.</strong> A bug. Captured by Inngest&apos;s error handler, alerted, and
          the user&apos;s last-good snapshot remains served by the iCal endpoint until the bug is
          fixed.
        </li>
      </ul>
      <p>
        That last case — &ldquo;serve last-good snapshot when regeneration fails&rdquo; — is the
        single most user-visible reliability lever. Calendar Automations does not blank a
        user&apos;s feed because of a transient failure. The feed always serves the freshest
        snapshot it has; staleness is communicated via the iCal <code>X-PUBLISHED-TTL</code> hint
        and the dashboard&apos;s last-regenerated timestamp.
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Cost shape</h2>
      <p>
        Cron runs are cheap. Inngest pricing is a function of step count and execution time;
        with seven to ten steps per user and a sub-second runtime per step (excluding the calendar
        and maps API waits), the marginal cost per regeneration is small. The dominant cost is
        third-party API quotas: Google Calendar API list calls (free up to a generous threshold)
        and Maps Directions API calls (paid past the free tier).
      </p>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Why not a single big function</h2>
      <p>
        On a slower-tier hosting setup (Fly.io worker, Railway, a small persistent VM), the whole
        regeneration could fit in one process. We considered that. The reasons we kept the
        Vercel + Inngest split:
      </p>
      <ul className="list-disc pl-5">
        <li>The web app already lives on Vercel; one platform is one less ops surface.</li>
        <li>Step idempotency is genuinely useful, not just timeout-driven.</li>
        <li>Per-step retries and observability are far better than &ldquo;the whole job died.&rdquo;</li>
        <li>Scaling fan-out across users is a feature, not a side effect.</li>
      </ul>

      <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">User-visible behavior</h2>
      <p>
        From the user&apos;s perspective, the dashboard shows &ldquo;last regenerated at&rdquo;
        and a button to trigger a fresh run. Behind the scenes, the button emits an Inngest event
        the same way the cron does; the pipeline is identical. The user does not need to know
        any of this — but if they ever do, the explanation is clean.
      </p>
    </ArticleLayout>
  );
}
