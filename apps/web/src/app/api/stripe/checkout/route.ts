/**
 * Creates a Stripe Checkout session (or redirects to the customer portal when
 * the user already has an active subscription). Returns 303 to the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getStripe, hasActiveSubscription } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const stripe = getStripe();
  const userId = session.user.id;
  const userRow = db
    ? (await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0]
    : null;

  let customerId = userRow?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email,
      metadata: { userId }
    });
    customerId = customer.id;
    if (db) {
      await db
        .update(schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.users.id, userId));
    }
  }

  const origin = req.headers.get("origin") ?? `https://${req.headers.get("host")}`;
  if (hasActiveSubscription(userRow?.subscriptionStatus ?? "none")) {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard/billing`
    });
    return NextResponse.redirect(portal.url, 303);
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) return new NextResponse("STRIPE_PRICE_ID not set", { status: 500 });

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/billing?ok=1`,
    cancel_url: `${origin}/dashboard/billing?cancelled=1`
  });
  return NextResponse.redirect(checkout.url ?? `${origin}/dashboard/billing`, 303);
}
