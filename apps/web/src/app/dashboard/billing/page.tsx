import { auth } from "@/lib/auth";
import { loadBillingState } from "@/lib/billing-state-server";

export const dynamic = "force-dynamic";

/**
 * Display copy for the two plans. The actual amounts charged are determined by
 * the Stripe Price objects referenced via STRIPE_PRICE_ID_{MONTHLY,ANNUAL} —
 * if you change pricing, update both Stripe and these labels together.
 */
const PLAN_COPY = {
  monthly: { label: "Monthly", price: "A$6", cadence: "/month" },
  annual: {
    label: "Annual",
    price: "A$54",
    cadence: "/year",
    note: "Save 25% — equivalent to A$4.50/month"
  }
} as const;

const ANNUAL_AVAILABLE = Boolean(process.env.STRIPE_PRICE_ID_ANNUAL);

function describeMode(mode: string, days: number): string {
  if (mode === "bypass") return "Payment gate bypassed via account override.";
  if (mode === "subscription") return "Active subscription — feeds are live.";
  if (mode === "trial") {
    return `Free trial — ${days} ${days === 1 ? "day" : "days"} left, no card required.`;
  }
  return "Trial ended — subscribe to keep feeds updating.";
}

export default async function BillingPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const billing = await loadBillingState(userId);
  const isSubscribed =
    billing.mode === "subscription" || billing.mode === "bypass";

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Mode: <strong>{billing.mode}</strong> · Stripe status:{" "}
          <strong>{billing.status}</strong>
        </p>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
          {describeMode(billing.mode, billing.trialDaysRemaining)}
        </p>
      </header>

      {isSubscribed ? (
        <section className="card">
          <h2 className="text-sm font-semibold">Plan</h2>
          <p className="text-sm">
            Calendar Automations subscription is active. Use the Stripe portal
            to change plan, update payment method, download invoices, or cancel.
          </p>
          <form action="/api/stripe/checkout" method="post" className="mt-3">
            <button type="submit" className="btn-primary">
              Manage subscription
            </button>
          </form>
          <p className="mt-2 text-xs text-ink-400">
            You will be redirected to Stripe to complete the action.
          </p>
        </section>
      ) : (
        <section className="card">
          <h2 className="text-sm font-semibold">Pick a plan</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Calendar Automations is designed to sit alongside your existing
            scheduler — a small add-on for framework-driven weekly planning.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <form
              action="/api/stripe/checkout"
              method="post"
              className="flex flex-col gap-2 rounded-md border border-ink-200/40 p-3 dark:border-ink-700"
            >
              <input type="hidden" name="plan" value="monthly" />
              <span className="text-xs uppercase tracking-wide text-ink-400">
                {PLAN_COPY.monthly.label}
              </span>
              <span className="text-lg font-semibold">
                {PLAN_COPY.monthly.price}
                <span className="text-sm font-normal text-ink-400">
                  {PLAN_COPY.monthly.cadence}
                </span>
              </span>
              <button type="submit" className="btn-primary mt-1">
                {billing.mode === "trial" ? "Subscribe early" : "Subscribe"}
              </button>
            </form>

            {ANNUAL_AVAILABLE ? (
              <form
                action="/api/stripe/checkout"
                method="post"
                className="flex flex-col gap-2 rounded-md border border-accent/40 p-3"
              >
                <input type="hidden" name="plan" value="annual" />
                <span className="text-xs uppercase tracking-wide text-accent">
                  {PLAN_COPY.annual.label}
                </span>
                <span className="text-lg font-semibold">
                  {PLAN_COPY.annual.price}
                  <span className="text-sm font-normal text-ink-400">
                    {PLAN_COPY.annual.cadence}
                  </span>
                </span>
                <span className="text-xs text-ink-600 dark:text-ink-200">
                  {PLAN_COPY.annual.note}
                </span>
                <button type="submit" className="btn-primary mt-1">
                  {billing.mode === "trial" ? "Subscribe early" : "Subscribe"}
                </button>
              </form>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            You will be redirected to Stripe to complete the action. All prices
            in AUD; cancel anytime from the Stripe portal.
          </p>
        </section>
      )}

      {billing.mode === "trial" && billing.trialEndsAt ? (
        <section className="card">
          <h2 className="text-sm font-semibold">Free trial</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Trial ends{" "}
            <strong>
              {billing.trialEndsAt.toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric"
              })}
            </strong>
            . You can subscribe any time to remove the gate placeholder before
            it appears.
          </p>
        </section>
      ) : null}

      {billing.mode === "bypass" ? (
        <section className="card">
          <h2 className="text-sm font-semibold">Override active</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            This account has <code>paymentGateBypass = true</code> set on the
            user row. Stripe billing actions are still available, but feed
            access is granted regardless of subscription state.
          </p>
        </section>
      ) : null}
    </div>
  );
}
