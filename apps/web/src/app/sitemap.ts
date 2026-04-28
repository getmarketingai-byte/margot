/**
 * Next.js sitemap generator. Exposes all public, indexable URLs so search and
 * directory crawlers can find them. Authenticated dashboard routes are
 * intentionally excluded.
 */

import type { MetadataRoute } from "next";
import { ARTICLES, SITE_URL } from "@/lib/marketing";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.5 }
  ];
  const articleEntries: MetadataRoute.Sitemap = ARTICLES.map((a) => ({
    url: `${SITE_URL}/learn/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: "yearly",
    priority: 0.6
  }));
  return [...staticEntries, ...articleEntries];
}
