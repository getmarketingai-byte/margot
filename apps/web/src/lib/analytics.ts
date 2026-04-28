/**
 * Public IDs for third-party analytics and ad networks.
 *
 * Defaults are the production IDs and can be overridden per-env via the
 * NEXT_PUBLIC_* variables. These IDs are publisher identifiers and are public
 * by design (they ship to every browser); there is no secret material here.
 */

export const ADSENSE_PUBLISHER_ID =
  process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID ?? "ca-pub-7076137753154472";

export const GOOGLE_ANALYTICS_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "G-8Z630KTF4J";
