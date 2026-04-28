/**
 * JSON-LD (Schema.org) object builders.
 *
 * Plain functions that return JSON-serializable objects so they can be embedded
 * via <script type="application/ld+json"> in pages and reused by the MCP
 * server. Schemas chosen to match what generative engines and rich-results
 * crawlers actually consume: Organization, WebSite, WebApplication, FAQPage,
 * HowTo, Article.
 */

import {
  ARTICLES,
  CANONICAL_URLS,
  FAQ,
  FEATURES,
  PRODUCT,
  SITE_URL,
  SUBSCRIBE_APPLE_STEPS,
  SUBSCRIBE_GOOGLE_STEPS,
  type Article,
  type FaqEntry,
  type IntegrationStep
} from "./marketing";

type JsonLd = Record<string, unknown>;

export function organizationLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: PRODUCT.legalName,
    url: SITE_URL,
    description: PRODUCT.shortDescription
  };
}

export function websiteLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: PRODUCT.name,
    url: SITE_URL,
    publisher: { "@type": "Organization", name: PRODUCT.legalName }
  };
}

export function webApplicationLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: PRODUCT.name,
    url: SITE_URL,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Web, iOS, Android (mobile-first responsive)",
    description: PRODUCT.longDescription,
    featureList: FEATURES.map((f) => f.title),
    audience: { "@type": "Audience", audienceType: PRODUCT.audience },
    offers: {
      "@type": "Offer",
      url: CANONICAL_URLS.billing,
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "PriceSpecification",
        description: "See in-app billing for the current monthly price."
      }
    }
  };
}

export function faqPageLd(entries: ReadonlyArray<FaqEntry> = FAQ): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer }
    }))
  };
}

export function howToLd(args: {
  name: string;
  description: string;
  steps: ReadonlyArray<IntegrationStep>;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: args.name,
    description: args.description,
    step: args.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text
    }))
  };
}

export function subscribeGoogleHowToLd(): JsonLd {
  return howToLd({
    name: "Subscribe to a Calendar Automations feed in Google Calendar",
    description:
      "Add a Calendar Automations iCal feed to Google Calendar using the From URL flow.",
    steps: SUBSCRIBE_GOOGLE_STEPS
  });
}

export function subscribeAppleHowToLd(): JsonLd {
  return howToLd({
    name: "Subscribe to a Calendar Automations feed in Apple Calendar",
    description:
      "Add a Calendar Automations iCal feed to Apple Calendar on macOS or iOS.",
    steps: SUBSCRIBE_APPLE_STEPS
  });
}

export function articleLd(article: Article): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    keywords: article.keywords.join(", "),
    mainEntityOfPage: `${SITE_URL}/learn/${article.slug}`,
    author: { "@type": "Organization", name: PRODUCT.legalName },
    publisher: { "@type": "Organization", name: PRODUCT.legalName }
  };
}

export function articleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
