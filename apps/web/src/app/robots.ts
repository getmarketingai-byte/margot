/**
 * Next.js robots.txt generator. We allow general crawling and explicitly allow
 * the major AI crawlers. The dashboard and any signed feed paths are
 * disallowed because they expose authenticated or per-token data that does
 * not belong in a search index.
 */

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/marketing";

const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Bingbot",
  "Applebot-Extended",
  "CCBot",
  "Meta-ExternalAgent",
  "DuckAssistBot",
  "Bytespider"
];

export default function robots(): MetadataRoute.Robots {
  const disallow = ["/api/", "/dashboard/"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...AI_CRAWLERS.map((agent) => ({ userAgent: agent, allow: "/", disallow }))
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
