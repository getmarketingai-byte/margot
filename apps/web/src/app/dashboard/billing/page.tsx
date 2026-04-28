import { auth } from "@/lib/auth";
import { loadBillingState } from "@/lib/billing-state-server";

export const dynamic = "force-dynamic";

async function startCheckout(): Promise<void> {
  "use server";
  // Posts to /api/stripe/checkout which redirects via Stripe Checkout.
}

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
  const ctaLabel =
    billing.mode === "subscription" || billing.mode === "bypass"
      ? "Manage subscription"
      : billing.mode === "trial"
        ? "Subscribe early"
        : "Subscribe";

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

      <section className="card">
        <h2 className="text-sm font-semibold">Plan</h2>
        <p className="text-sm">Calendar Automations · monthly subscription</p>
        <form action="/api/stripe/checkout" method="post" className="mt-3">
          <button type="submit" className="btn-primary">
            {ctaLabel}
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-400">
          You will be redirected to Stripe to complete the action.
        </p>
        <button hidden type="button" onClick={startCheckout}>noop</button>
      </section>

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
