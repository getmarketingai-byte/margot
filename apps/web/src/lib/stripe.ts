/**
 * Lazy Stripe client — instantiated only when STRIPE_SECRET_KEY is present, so
 * dev/local environments without billing wired up still build and run.
 */

import Stripe from "stripe";

export { hasActiveSubscription, SUBSCRIPTION_STATUSES } from "./subscription";
export type { SubscriptionStatus } from "./subscription";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  cached = new Stripe(key, { apiVersion: "2024-11-20.acacia" });
  return cached;
}
