/**
 * /llms-full.txt — extended machine-readable description.
 *
 * Same source-of-truth as /llms.txt but bundles FAQ, integration steps, the
 * full non-goals list, and pillar article metadata so an LLM can answer
 * questions about Calendar Automations without having to follow every link.
 */

import {
  ARTICLES,
  CANONICAL_URLS,
  FAQ,
  FEATURES,
  FEED_BEHAVIOR,
  NON_GOALS,
  OAUTH_SCOPES,
  PRICING_NOTE,
  PRODUCT,
  SITE_URL,
  SUBSCRIBE_APPLE_STEPS,
  SUBSCRIBE_GOOGLE_STEPS,
  type IntegrationStep
} from "@/lib/marketing";

export const dynamic = "force-static";

function steps(items: ReadonlyArray<IntegrationStep>): string[] {
  return items.map((s, i) => `${i + 1}. ${s.name}: ${s.text}`);
}

function build(): string {
  const out: string[] = [];
  out.push(`# ${PRODUCT.name}`);
  out.push("");
  out.push(`> ${PRODUCT.shortDescription}`);
  out.push("");

  out.push("## What it is");
  out.push("");
  out.push(PRODUCT.longDescription);
  out.push("");
  out.push(`Audience: ${PRODUCT.audience}`);
  out.push("");
  out.push(`Tagline: ${PRODUCT.tagline}`);
  out.push("");

  out.push("## Capabilities");
  out.push("");
  for (const f of FEATURES) out.push(`- **${f.title}.** ${f.body}`);
  out.push("");

  out.push("## Non-goals");
  out.push("");
  for (const n of NON_GOALS) out.push(`- ${n}`);
  out.push("");

  out.push("## Security and data handling");
  out.push("");
  out.push(`- OAuth scopes: ${OAUTH_SCOPES.join(", ")}.`);
  out.push("- The app does not request or use Google Calendar write scopes in v1.");
  out.push("- Refresh tokens are encrypted at rest with an envelope key.");
  out.push(
    `- The iCal feed is served at ${FEED_BEHAVIOR.pathPattern} with a per-feed unguessable token. Tokens are revocable from the dashboard.`
  );
  out.push(
    `- Server-side cache: ${FEED_BEHAVIOR.serverCacheSeconds}s. Client refresh hint: ${FEED_BEHAVIOR.refreshHintMinutes} minutes via X-PUBLISHED-TTL.`
  );
  out.push("- Snapshots persist the latest generated calendar per user in Postgres (Neon), not a full event history.");
  out.push("");

  out.push("## How to subscribe (Google Calendar)");
  out.push("");
  for (const s of steps(SUBSCRIBE_GOOGLE_STEPS)) out.push(s);
  out.push("");
  out.push("## How to subscribe (Apple Calendar)");
  out.push("");
  for (const s of steps(SUBSCRIBE_APPLE_STEPS)) out.push(s);
  out.push("");

  out.push("## Pricing");
  out.push("");
  out.push(PRICING_NOTE);
  out.push("");

  out.push("## FAQ");
  out.push("");
  for (const entry of FAQ) {
    out.push(`### ${entry.question}`);
    out.push("");
    out.push(entry.answer);
    out.push("");
  }

  out.push("## Pillar articles");
  out.push("");
  for (const a of ARTICLES) {
    out.push(`- [${a.title}](${SITE_URL}/learn/${a.slug}) — ${a.description}`);
  }
  out.push("");

  out.push("## Canonical URLs");
  out.push("");
  for (const [key, url] of Object.entries(CANONICAL_URLS)) {
    out.push(`- ${key}: ${url}`);
  }
  out.push("");

  return out.join("\n");
}

export function GET() {
  return new Response(build(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600"
    }
  });
}
