/**
 * Edge-runtime-safe subscription gate. Lives in its own module so middleware
 * can import it without pulling in the (Node-only) Stripe SDK.
 */

export const SUBSCRIPTION_STATUSES = [
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid"
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function hasActiveSubscription(status: SubscriptionStatus | string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}
