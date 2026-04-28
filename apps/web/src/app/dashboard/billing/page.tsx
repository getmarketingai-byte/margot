import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { hasActiveSubscription } from "@/lib/subscription";

export const dynamic = "force-dynamic";

async function startCheckout(): Promise<void> {
  "use server";
  // Posts to /api/stripe/checkout which redirects via Stripe Checkout.
}

export default async function BillingPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const userRow = db
    ? (await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0]
    : null;
  const status = userRow?.subscriptionStatus ?? "none";
  const active = hasActiveSubscription(status);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Subscription status: <strong>{status}</strong>
          {active ? " — feeds are live." : " — subscribe to keep feeds updating."}
        </p>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold">Plan</h2>
        <p className="text-sm">Calendar Automations · monthly subscription</p>
        <form action="/api/stripe/checkout" method="post" className="mt-3">
          <button type="submit" className="btn-primary">
            {active ? "Manage subscription" : "Subscribe"}
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-400">
          You will be redirected to Stripe to complete the action.
        </p>
        <button hidden type="button" onClick={startCheckout}>noop</button>
      </section>
    </div>
  );
}
