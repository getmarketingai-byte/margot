/**
 * App-side marketing facade.
 *
 * Static product data lives in @calendar-automations/marketing. This module
 * resolves the canonical site URL from NEXT_PUBLIC_SITE_URL and re-exports the
 * package contents so the rest of the web app does not need to know where the
 * data comes from.
 */

import { urlsFor } from "@calendar-automations/marketing";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://calendar-automations.app";

export const CANONICAL_URLS = urlsFor(SITE_URL);

export {
  ARTICLES,
  FAQ,
  FEATURES,
  FEED_BEHAVIOR,
  NON_GOALS,
  OAUTH_SCOPES,
  PRICING_NOTE,
  PRODUCT,
  SUBSCRIBE_APPLE_STEPS,
  SUBSCRIBE_GOOGLE_STEPS
} from "@calendar-automations/marketing";

export type {
  Article,
  CanonicalUrls,
  FaqEntry,
  IntegrationStep
} from "@calendar-automations/marketing";
