/**
 * Stripe webhook — flips `users.subscriptionStatus` based on subscription events.
 * Verifies signatures with STRIPE_WEBHOOK_SECRET. The dashboard / feed routes
 * read the resulting status; gating is enforced at the data layer rather than
 * in middleware so the dashboard remains reachable for billing recovery.
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getStripe, type SubscriptionStatus } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return new NextResponse("Misconfigured", { status: 500 });

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return new NextResponse(`Webhook error: ${(err as Error).message}`, { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      if (!db) break;
      const userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.stripeCustomerId, customerId))
        .limit(1);
      const user = userRows[0];
      if (!user) break;
      const status = sub.status as SubscriptionStatus;
      await db
        .update(schema.users)
        .set({
          subscriptionStatus: status,
          subscriptionId: sub.id,
          subscriptionPriceId: sub.items.data[0]?.price.id ?? null,
          subscriptionPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null
        })
        .where(eq(schema.users.id, user.id));
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
