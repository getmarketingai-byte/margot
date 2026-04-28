/**
 * /ads.txt — IAB Authorized Digital Sellers record.
 *
 * Verifies that Google AdSense is authorized to sell ad inventory on this
 * domain. The publisher ID matches NEXT_PUBLIC_ADSENSE_PUBLISHER_ID so a
 * single env-var rotation keeps this file in sync with the meta tag and the
 * loader script. Format: `<domain>, <publisher_id>, <relationship>, <TAG-ID>`.
 */

import { ADSENSE_PUBLISHER_ID } from "@/lib/analytics";

export const dynamic = "force-static";

export function GET() {
  const publisherId = ADSENSE_PUBLISHER_ID.replace(/^ca-/, "");
  const body = `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400"
    }
  });
}
