import Link from "next/link";
import type { BillingState } from "@/lib/subscription";

/**
 * Persistent dashboard banner that exposes the same billing state used by the
 * iCal feed gate so users always know which mode their account is in:
 *
 *   - trial:        7-day no-card trial active, days remaining shown.
 *   - expired:      gate is enforced; iCal shows a 4-hour placeholder event.
 *   - bypass:       operator-applied DB override, payment gate skipped.
 *   - subscription: paid, healthy state; banner is suppressed to stay out of
 *                   the way of the actual dashboard content.
 */
export function BillingBanner({ state }: { state: BillingState }) {
  if (state.mode === "subscription") return null;

  if (state.mode === "bypass") {
    return (
      <div
        role="status"
        className="mb-4 flex flex-col gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-900/30 dark:text-emerald-100"
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm font-semibold">Payment gate bypassed</strong>
          <span className="text-xs uppercase tracking-wide opacity-80">Override</span>
        </div>
        <p className="text-xs opacity-90">
          This account skips the subscription gate via a database override. iCal
          feeds refresh as if a paid subscription was active.
        </p>
      </div>
    );
  }

  if (state.mode === "trial") {
    const days = state.trialDaysRemaining;
    return (
      <div
        role="status"
        className="mb-4 flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink-900 dark:text-ink-100"
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm font-semibold">
            Free trial · {days} {days === 1 ? "day" : "days"} left
          </strong>
          <span className="text-xs uppercase tracking-wide opacity-70">No card required</span>
        </div>
        <p className="text-xs text-ink-600 dark:text-ink-200">
          You have full access to iCal feeds during your 7-day trial. After it
          ends, the feed will show a placeholder event until you subscribe.
        </p>
        <div>
          <Link href="/dashboard/billing" className="btn-secondary text-xs">
            Subscribe early
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mb-4 flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-600/70 dark:bg-amber-900/30 dark:text-amber-100"
    >
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-semibold">Subscription required</strong>
        <span className="text-xs uppercase tracking-wide opacity-80">Feed gated</span>
      </div>
      <p className="text-xs opacity-90">
        Your trial has ended and there&apos;s no active subscription. iCal feeds
        currently show a 4-hour placeholder event in your calendar until you
        resume.
      </p>
      <div>
        <Link href="/dashboard/billing" className="btn-primary text-xs">
          Subscribe to resume
        </Link>
      </div>
    </div>
  );
}
