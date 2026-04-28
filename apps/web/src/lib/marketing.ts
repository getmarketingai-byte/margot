/**
 * App-side marketing facade.
 *
 * Static product data lives in @calendar-automations/marketing. This module
 * resolves the canonical site URL from NEXT_PUBLIC_SITE_URL and re-exports the
 * package contents so the rest of the web app does not need to know where the
 * data comes from.
 */

import { urlsFor } from "@calendar-automations/marketing";

const DEFAULT_SITE_URL = "https://calendar-automations.app";

function normaliseSiteUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_SITE_URL;
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return DEFAULT_SITE_URL;

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(withProtocol).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export const SITE_URL = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

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
