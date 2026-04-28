/**
 * Edge-runtime-safe subscription gate. Lives in its own module so middleware
 * can import it without pulling in the (Node-only) Stripe SDK.
 *
 * Access to paid features is granted in any of three ways:
 *   1. `paymentGateBypass` is true (operator override stamped directly on the
 *      user row for trusted accounts).
 *   2. Stripe `subscriptionStatus` is "active" or "trialing".
 *   3. The app-side `trialEndsAt` is still in the future (7-day no-card
 *      trial seeded on user creation).
 *
 * The dashboard banner and the iCal feed gate both consume `getBillingState`
 * so the in-product messaging cannot drift from the actual gate behavior.
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

export const TRIAL_LENGTH_DAYS = 7;
export const TRIAL_LENGTH_MS = TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000;

export function hasActiveSubscription(status: SubscriptionStatus | string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

export type BillingMode = "bypass" | "subscription" | "trial" | "expired";

export interface BillingState {
  /** Why access is granted/denied. Drives banner copy and gate behavior. */
  mode: BillingMode;
  allowed: boolean;
  status: SubscriptionStatus | "none";
  paymentGateBypass: boolean;
  trialEndsAt: Date | null;
  /** Whole days (rounded up) remaining when `mode === "trial"`, else 0. */
  trialDaysRemaining: number;
}

export interface BillingStateInput {
  subscriptionStatus?: SubscriptionStatus | string | null;
  trialEndsAt?: Date | string | null;
  paymentGateBypass?: boolean | null;
  /** Override "now" for tests; defaults to `Date.now()`. */
  now?: number;
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/**
 * Compute the canonical billing state for a user. This is the single source of
 * truth for "can this user use paid features right now?" — both the iCal feed
 * gate and the dashboard banner rely on it.
 */
export function getBillingState(input: BillingStateInput): BillingState {
  const now = input.now ?? Date.now();
  const status = (input.subscriptionStatus ?? "none") as BillingState["status"];
  const trialEndsAt = coerceDate(input.trialEndsAt ?? null);
  const paymentGateBypass = input.paymentGateBypass === true;

  if (paymentGateBypass) {
    return {
      mode: "bypass",
      allowed: true,
      status,
      paymentGateBypass,
      trialEndsAt,
      trialDaysRemaining: 0
    };
  }

  if (hasActiveSubscription(status)) {
    return {
      mode: "subscription",
      allowed: true,
      status,
      paymentGateBypass,
      trialEndsAt,
      trialDaysRemaining: 0
    };
  }

  if (trialEndsAt && trialEndsAt.valueOf() > now) {
    const msRemaining = trialEndsAt.valueOf() - now;
    return {
      mode: "trial",
      allowed: true,
      status,
      paymentGateBypass,
      trialEndsAt,
      trialDaysRemaining: Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)))
    };
  }

  return {
    mode: "expired",
    allowed: false,
    status,
    paymentGateBypass,
    trialEndsAt,
    trialDaysRemaining: 0
  };
}

export function canAccessPaidFeatures(input: BillingStateInput): boolean {
  return getBillingState(input).allowed;
}
