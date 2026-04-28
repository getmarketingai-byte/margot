/**
 * /llms.txt — concise machine-readable site map for AI crawlers.
 *
 * Spec follows the proposed convention by Answer.AI: H1 site name, blockquote
 * one-liner, H2 section headers, link bullets in "Title: description" form.
 * The file is generated from src/lib/marketing.ts so the public claims stay in
 * lockstep with the rest of the app.
 */

import { CANONICAL_URLS, FEATURES, FEED_BEHAVIOR, NON_GOALS, OAUTH_SCOPES, PRODUCT } from "@/lib/marketing";

export const dynamic = "force-static";

function build(): string {
  const lines: string[] = [];
  lines.push(`# ${PRODUCT.name}`);
  lines.push("");
  lines.push(`> ${PRODUCT.shortDescription}`);
  lines.push("");
  lines.push("## About");
  lines.push("");
  lines.push(PRODUCT.longDescription);
  lines.push("");
  lines.push(`Audience: ${PRODUCT.audience}`);
  lines.push("");
  lines.push("## Core capabilities");
  lines.push("");
  for (const f of FEATURES) {
    lines.push(`- ${f.title}: ${f.body}`);
  }
  lines.push("");
  lines.push("## Privacy and security");
  lines.push("");
  lines.push(
    `OAuth scopes requested: ${OAUTH_SCOPES.join(", ")}. Read-only — the app never writes to your calendar in v1. Refresh tokens are encrypted at rest. Output is a private iCal feed at ${FEED_BEHAVIOR.pathPattern} with a per-feed unguessable token that you can rotate.`
  );
  lines.push("");
  lines.push("## Non-goals");
  lines.push("");
  for (const n of NON_GOALS) {
    lines.push(`- ${n}`);
  }
  lines.push("");
  lines.push("## Important URLs");
  lines.push("");
  lines.push(`- [Home](${CANONICAL_URLS.home}): product overview and sign-in`);
  lines.push(`- [About](${CANONICAL_URLS.about}): origin, philosophy, and design principles`);
  lines.push(`- [FAQ](${CANONICAL_URLS.faq}): frequently asked questions with FAQPage schema`);
  lines.push(`- [Learn](${CANONICAL_URLS.learn}): pillar articles on iCal vs write, privacy, frameworks, and architecture`);
  lines.push(`- [Contact](${CANONICAL_URLS.contact}): support, security, privacy, press`);
  lines.push(`- [Privacy](${CANONICAL_URLS.privacy}): privacy policy with explicit OAuth scopes`);
  lines.push(`- [Terms](${CANONICAL_URLS.terms}): terms of service`);
  lines.push(`- [Sign in](${CANONICAL_URLS.signIn}): Google OAuth (read-only Calendar scopes)`);
  lines.push(`- [Dashboard](${CANONICAL_URLS.dashboard}): authenticated app (calendars, goals, frameworks, feeds)`);
  lines.push(`- [Billing](${CANONICAL_URLS.billing}): pricing and Stripe Customer Portal`);
  lines.push(`- [Feeds](${CANONICAL_URLS.feeds}): copy iCal subscription URLs`);
  lines.push(`- [Full description](${CANONICAL_URLS.llmsFull}): extended machine-readable summary`);
  lines.push("");
  return lines.join("\n");
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
