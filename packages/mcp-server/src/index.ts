#!/usr/bin/env node
/**
 * Calendar Automations MCP server (stdio transport).
 *
 * Exposes three read-only tools that return ONLY public product facts. There
 * is no per-user data, no calendar access, and no token handling here. The
 * data comes from @calendar-automations/marketing so /llms.txt, JSON-LD, and
 * this server cannot disagree.
 *
 * Tools:
 *   - get_product_summary     name, description, audience, features, URLs
 *   - get_integration_steps   subscription steps for Google or Apple Calendar
 *   - get_security_model      OAuth scopes, feed behavior, non-goals
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ARTICLES,
  FAQ,
  FEATURES,
  FEED_BEHAVIOR,
  NON_GOALS,
  OAUTH_SCOPES,
  PRICING_NOTE,
  PRODUCT,
  SUBSCRIBE_APPLE_STEPS,
  SUBSCRIBE_GOOGLE_STEPS,
  urlsFor
} from "@calendar-automations/marketing";

const SITE_URL = (process.env.CALENDAR_AUTOMATIONS_SITE_URL ?? "https://calendar-automations.app").replace(/\/$/, "");
const URLS = urlsFor(SITE_URL);

const server = new McpServer({
  name: "calendar-automations",
  version: "0.1.0"
});

function jsonContent(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

server.registerTool(
  "get_product_summary",
  {
    title: "Calendar Automations product summary",
    description:
      "Returns the public product summary: name, description, audience, capabilities, canonical URLs, and pricing note. Safe for any AI agent to call.",
    inputSchema: {}
  },
  async () =>
    jsonContent({
      name: PRODUCT.name,
      legalName: PRODUCT.legalName,
      tagline: PRODUCT.tagline,
      shortDescription: PRODUCT.shortDescription,
      longDescription: PRODUCT.longDescription,
      category: PRODUCT.category,
      audience: PRODUCT.audience,
      features: FEATURES,
      pricingNote: PRICING_NOTE,
      urls: URLS,
      articles: ARTICLES.map((a) => ({
        title: a.title,
        url: `${SITE_URL}/learn/${a.slug}`,
        description: a.description
      })),
      faq: FAQ
    })
);

server.registerTool(
  "get_integration_steps",
  {
    title: "Subscribe-to-feed integration steps",
    description:
      "Returns ordered steps to subscribe to a Calendar Automations iCal feed in either Google Calendar or Apple Calendar.",
    inputSchema: {
      client: z
        .enum(["google", "apple"])
        .describe("Calendar client to return steps for. One of: google, apple.")
    }
  },
  async ({ client }) => {
    const steps = client === "google" ? SUBSCRIBE_GOOGLE_STEPS : SUBSCRIBE_APPLE_STEPS;
    return jsonContent({
      client,
      steps: steps.map((s, i) => ({ position: i + 1, name: s.name, text: s.text }))
    });
  }
);

server.registerTool(
  "get_security_model",
  {
    title: "Security and data-handling model",
    description:
      "Returns the OAuth scope list, iCal feed behavior, retention summary, and explicit non-goals.",
    inputSchema: {}
  },
  async () =>
    jsonContent({
      oauthScopes: OAUTH_SCOPES,
      writeAccess: false,
      writeAccessNote: "Calendar Automations does not request Google Calendar write scopes in v1.",
      tokenStorage:
        "OAuth refresh tokens are encrypted at rest with an envelope key (TOKEN_ENCRYPTION_KEY). Background regeneration jobs decrypt in memory and never log raw tokens.",
      feedBehavior: FEED_BEHAVIOR,
      retention:
        "User account, settings, and the latest CalendarSnapshot are stored in Postgres. Snapshots are overwritten on each regeneration; no full event history is kept.",
      deletion:
        "Account deletion from the dashboard removes settings, the latest snapshot, and all feed tokens. Subscribed clients fall off as their cache expires.",
      nonGoals: NON_GOALS,
      privacyPolicyUrl: `${SITE_URL}/privacy`
    })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
