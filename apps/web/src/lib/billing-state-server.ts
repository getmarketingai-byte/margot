/**
 * Server-side helper to compute the canonical billing state for a user. Wraps
 * the pure `getBillingState` predicate with a database read so dashboard pages
 * can share the same source of truth as the iCal feed gate.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  getBillingState,
  type BillingState
} from "@/lib/subscription";

export async function loadBillingState(userId: string): Promise<BillingState> {
  if (!db) {
    return getBillingState({
      subscriptionStatus: "none",
      trialEndsAt: null,
      paymentGateBypass: false
    });
  }
  const rows = await db
    .select({
      subscriptionStatus: schema.users.subscriptionStatus,
      trialEndsAt: schema.users.trialEndsAt,
      paymentGateBypass: schema.users.paymentGateBypass
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  return getBillingState({
    subscriptionStatus: row?.subscriptionStatus ?? "none",
    trialEndsAt: row?.trialEndsAt ?? null,
    paymentGateBypass: row?.paymentGateBypass ?? false
  });
}
