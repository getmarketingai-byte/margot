/**
 * Shared, environment-free product facts.
 *
 * This package is the single source of truth for any surface that describes
 * Calendar Automations to humans or to AI systems:
 *   - the Next.js landing, /faq, /learn, /llms.txt, /llms-full.txt, JSON-LD
 *   - the MCP server in packages/mcp-server
 *
 * Nothing here reads process.env or DOM globals. URL building is parameterized
 * via {@link urlsFor} so each consumer supplies its own canonical base URL.
 */

export const PRODUCT = {
  name: "Calendar Automations",
  legalName: "Calendar Automations",
  contactEmail: "autocalender@neutrino.au",
  tagline: "The balance layer for your existing scheduler.",
  shortDescription:
    "A framework-driven weekly planning layer that runs alongside SkedPal, Reclaim, Motion, Sunsama, or any task-driven scheduler. Reads your calendar over read-only OAuth, allocates Wheel of Life / PPF / HP6 goals into the gaps with energy-aware ordering, and publishes the result as a private iCal feed your existing calendar app subscribes to.",
  longDescription:
    "Calendar Automations runs alongside your existing scheduler — SkedPal, Reclaim, Motion, Sunsama, or anything task-driven that lives in Google Calendar. Your scheduler keeps doing reactive task flow: deadlines, project hierarchies, auto-rescheduling. Calendar Automations adds the strategic layer those tools don't cover — Wheel of Life weekly minutes per area, PPF (Personal / Professional / Financial) mix targets, HP6 habit tags with monthly minimum-touch goals, and Bustamante-style energy modes (hyperfocus / hyperaware / neutral). It connects to Google Calendar with read-only scopes only, computes a balanced weekly schedule against your existing busy time, and publishes private iCal feeds any calendar app can subscribe to. The app never writes to your calendar — even when your scheduler does.",
  category: "Productivity",
  audience:
    "SkedPal, Reclaim, Motion, and Sunsama users — and anyone who plans weeks against Wheel of Life, PPF, or HP6 — who want a framework-driven balance layer on top of their existing scheduler without giving another app calendar write access."
} as const;

/**
 * OAuth scopes requested at sign-in. Mirrors REQUIRED_SCOPES in
 * apps/web/src/lib/auth.ts.
 */
export const OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
] as const;

export const FEED_BEHAVIOR = {
  format: "iCalendar (RFC 5545) over HTTPS",
  scheme: "webcal:// or https://",
  refreshHintMinutes: 30,
  serverCacheSeconds: 60,
  tokenScope: "Per-feed unguessable token, revocable from the dashboard",
  pathPattern: "/api/feeds/<token>.ics"
} as const;

export const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Sits alongside your scheduler",
    body: "Designed to run with SkedPal, Reclaim, Motion, Sunsama, or any task-driven calendar tool. Your scheduler keeps handling reactive task flow; Calendar Automations adds the framework layer it doesn't cover. Both surface in the same calendar app."
  },
  {
    title: "Wheel of Life balance",
    body: "Set weekly minutes per area so neglected domains get guaranteed slots — no week disappears under work pressure or auto-scheduled deadlines."
  },
  {
    title: "PPF mix targets",
    body: "Personal, Professional, Financial — keep all three buckets touched every week with simple percentage and touch-count rules, optional 1y/3y/5y horizons."
  },
  {
    title: "HP6 + HPP rhythms",
    body: "Six habit tags, weekly review day, monthly strategy day-of-month — wired in with your own paraphrased prompts."
  },
  {
    title: "Energy-aware ordering",
    body: "Tag goals as hyperfocus, hyperaware, or neutral. The allocator places deep work first and avoids long runs of pure scanning in one block."
  },
  {
    title: "Read-only by design",
    body: "Even when your scheduler has full calendar write access, this app uses calendar.readonly scopes only. Output is a private iCal feed you subscribe to. We never add, edit, or delete events."
  },
  {
    title: "Time-mapped weeks",
    body: "Reads up to 60 days of your existing Google Calendar, finds the gaps left by meetings and your scheduler, and generates Needle-Mover, Execute, Ops, and Play bands across each day."
  }
];

export const NON_GOALS: ReadonlyArray<string> = [
  "Calendar Automations is not a task manager, project tracker, or auto-rescheduler. It runs alongside SkedPal, Reclaim, Motion, Sunsama, or any task-driven scheduler — adding a balance and frameworks layer those tools do not cover.",
  "Calendar Automations does not write events to your Google Calendar in v1.",
  "Calendar Automations does not read or sync iCloud calendars via CalDAV in v1; iCloud users subscribe to the published feed instead.",
  "Calendar Automations is not a meeting scheduler, availability picker, or external booking page.",
  "Calendar Automations is not a medical, productivity, or performance-coaching service. Energy modes are scheduling tags, not health claims."
];

export type FaqEntry = { question: string; answer: string };

export const FAQ: ReadonlyArray<FaqEntry> = [
  {
    question: "What does Calendar Automations actually do?",
    answer:
      "It reads your connected calendars to find busy intervals (including blocks placed by your existing scheduler), allocates your weekly framework goals into the remaining gaps using energy-aware ordering and balance constraints, then publishes a private iCal feed of the planned blocks. You subscribe to that feed from Apple Calendar, Google Calendar, Outlook, or any RFC 5545-compliant client — alongside whatever your scheduler is publishing."
  },
  {
    question: "Does this replace SkedPal, Reclaim, Motion, or Sunsama?",
    answer:
      "No — it is designed to sit alongside them. Your scheduler keeps doing what it does best: reactive task flow, deadlines, project hierarchies, auto-rescheduling. Calendar Automations adds the strategic layer those tools do not cover — Wheel of Life weekly balance, PPF (Personal / Professional / Financial) mix targets, HP6 monthly habit touches, and energy-aware ordering. Both feed into the same calendar app, so you see one unified week."
  },
  {
    question: "Does Calendar Automations write to my Google Calendar?",
    answer:
      "No. The app requests read-only Google Calendar scopes (calendar.readonly and calendar.calendarlist.readonly) and produces an iCal feed as output. You decide whether to subscribe to the feed in your calendar app. There is no write path in v1."
  },
  {
    question: "Which OAuth scopes are requested?",
    answer:
      "openid, email, profile, https://www.googleapis.com/auth/calendar.readonly, and https://www.googleapis.com/auth/calendar.calendarlist.readonly. The refresh token is encrypted at rest with an envelope key (TOKEN_ENCRYPTION_KEY) so background regeneration jobs can refresh access tokens without a fresh sign-in."
  },
  {
    question: "How often does the iCal feed update?",
    answer:
      "The server hints a 30-minute refresh interval to clients via X-PUBLISHED-TTL. Real refresh cadence depends on your calendar app — Google Calendar URL subscriptions typically refresh every several hours, Apple Calendar lets you choose. Underlying snapshots are regenerated on a schedule via Vercel Cron and Inngest."
  },
  {
    question: "Where is my data stored and for how long?",
    answer:
      "User accounts, settings, and the latest generated calendar snapshot live in Postgres (Neon). Refresh tokens are encrypted with libsodium-style envelope encryption. We store the latest snapshot per user, not a full event history. You can delete your account from the dashboard, which removes settings, snapshots, and feed tokens."
  },
  {
    question: "Can I subscribe from Apple Calendar or iCloud?",
    answer:
      "Yes. Calendar Automations publishes standards-compliant iCal feeds; Apple Calendar can subscribe to the HTTPS or webcal URL directly. We do not read your iCloud calendars in v1 — Apple Calendar is treated as a subscriber, not a source."
  },
  {
    question: "What frameworks does the planner support?",
    answer:
      "Wheel of Life weekly minutes per area, Personal / Professional / Financial mix targets with optional 1y / 3y / 5y horizons, HP6 habit tags with monthly minimum-touch goals, Bustamante-style energy ordering (hyperfocus / hyperaware / neutral), and recurring consistency segments reserved before goal allocation."
  },
  {
    question: "Is Calendar Automations open source?",
    answer:
      "The legacy Apps Script source the project was migrated from is public. The web app stack is described publicly (Next.js 15, Auth.js v5, Drizzle, Neon, Inngest, Stripe) but code availability depends on the release plan."
  },
  {
    question: "How do I cancel?",
    answer:
      "From the dashboard billing page, which opens the Stripe Customer Portal. When a subscription lapses, the iCal feed serves a single explanatory event so you see a clear in-calendar message instead of a silent 404."
  }
];

export type IntegrationStep = { name: string; text: string };

export const SUBSCRIBE_GOOGLE_STEPS: ReadonlyArray<IntegrationStep> = [
  { name: "Open the dashboard", text: "Sign in and open the Feeds page in the dashboard." },
  { name: "Copy the feed URL", text: "Copy the HTTPS URL for the feed you want to subscribe to (for example, the timemap feed)." },
  { name: "Open Google Calendar settings", text: "In Google Calendar on the web, open Settings → Add calendar → From URL." },
  { name: "Paste the URL", text: "Paste the copied feed URL into the URL field and click Add calendar." },
  { name: "Wait for the first sync", text: "Google fetches the feed. Initial sync may take several minutes; subsequent refreshes are controlled by Google and typically run every several hours." }
];

export const SUBSCRIBE_APPLE_STEPS: ReadonlyArray<IntegrationStep> = [
  { name: "Copy the feed URL", text: "From the Calendar Automations dashboard Feeds page, copy the webcal:// or HTTPS feed URL." },
  { name: "Open Calendar on macOS or iOS", text: "On macOS open Calendar → File → New Calendar Subscription. On iOS open Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar." },
  { name: "Paste the URL", text: "Paste the URL and confirm." },
  { name: "Set refresh interval", text: "Choose a refresh interval (every 15 minutes is supported). Apple Calendar will fetch the feed and display the planned blocks." }
];

export type Article = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  keywords: ReadonlyArray<string>;
};

export const ARTICLES: ReadonlyArray<Article> = [
  {
    slug: "ical-vs-calendar-write",
    title: "iCal subscription vs Calendar API write: which one should a planning app use?",
    description:
      "A side-by-side comparison of publishing iCal feeds versus writing events directly to Google or Microsoft calendars: latency, OAuth scope, multi-platform reach, and reversibility.",
    publishedAt: "2026-04-28",
    keywords: ["iCal", "Google Calendar API", "OAuth", "calendar subscription", "ICS feed"]
  },
  {
    slug: "calendar-privacy-model",
    title: "A privacy model for calendar-derived planning",
    description:
      "How Calendar Automations stores busy intervals (not full event detail), encrypts OAuth refresh tokens at rest, and rotates per-feed tokens — explained with the actual scope list and storage layout.",
    publishedAt: "2026-04-28",
    keywords: ["calendar privacy", "OAuth scopes", "least privilege", "data retention"]
  },
  {
    slug: "energy-aware-time-blocking",
    title: "Energy-aware time blocking: hyperfocus, hyperaware, neutral",
    description:
      "How Calendar Automations uses energy tags to order weekly goals — what each mode means as a scheduling label (not a medical claim), and how the allocator avoids long hyperaware runs.",
    publishedAt: "2026-04-28",
    keywords: ["time blocking", "deep work", "weekly planning", "Wheel of Life", "PPF"]
  },
  {
    slug: "wheel-of-life-weekly-planning",
    title: "Using Wheel of Life as a weekly planning constraint",
    description:
      "How to translate a Wheel of Life self-assessment into weekly minimum minutes per area so neglected domains get guaranteed slots in your calendar.",
    publishedAt: "2026-04-28",
    keywords: ["Wheel of Life", "life balance", "weekly planning", "time allocation"]
  },
  {
    slug: "ppf-personal-professional-financial",
    title: "The PPF framework: keeping Personal, Professional, and Financial in balance every week",
    description:
      "A practical breakdown of the PPF (Personal / Professional / Financial) framework as a weekly scheduling constraint, with horizon planning across one, three, and five years.",
    publishedAt: "2026-04-28",
    keywords: ["PPF framework", "Natalie Dawson", "weekly mix", "horizon planning"]
  },
  {
    slug: "hp6-habits-monthly-touch-goals",
    title: "HP6 habits as monthly minimum-touch goals",
    description:
      "How to use the six high performance habits — clarity, energy, necessity, productivity, influence, courage — as tags that guarantee each habit gets touch time across the month.",
    publishedAt: "2026-04-28",
    keywords: ["HP6", "high performance habits", "Brendon Burchard", "monthly goals"]
  },
  {
    slug: "consistency-segments-time-blocking",
    title: "Consistency segments: protecting non-negotiable blocks before the planner runs",
    description:
      "Why fixed-clock recurring blocks beat floating goals for habit-formation, and how Calendar Automations reserves consistency segments before allocating the rest of your week.",
    publishedAt: "2026-04-28",
    keywords: ["consistency", "time blocking", "habit formation", "scheduling"]
  },
  {
    slug: "perfect-week-allocation-walkthrough",
    title: "A perfect-week allocation walkthrough, step by step",
    description:
      "An end-to-end example: connecting calendars, configuring goals, applying balance constraints, ordering by energy, and reading the resulting iCal feed.",
    publishedAt: "2026-04-28",
    keywords: ["perfect week", "weekly planning", "allocation", "walkthrough"]
  },
  {
    slug: "subscribing-icalendar-google-calendar",
    title: "Subscribing to an iCalendar feed in Google Calendar: the deep version",
    description:
      "Beyond the three-step quick guide: how Google handles ICS subscriptions, refresh cadence, time zones, color customization, and the gotchas that catch most users.",
    publishedAt: "2026-04-28",
    keywords: ["Google Calendar", "ICS subscription", "From URL", "refresh"]
  },
  {
    slug: "subscribing-icalendar-apple-calendar",
    title: "Subscribing to an iCalendar feed in Apple Calendar (macOS, iOS, iPadOS)",
    description:
      "Step-by-step instructions for adding a Calendar Automations feed across Apple Calendar surfaces, including the right place to configure refresh interval and time zones.",
    publishedAt: "2026-04-28",
    keywords: ["Apple Calendar", "iCloud subscription", "macOS", "iOS"]
  },
  {
    slug: "busy-interval-merging-and-gap-finding",
    title: "Busy interval merging and gap-finding: the geometry of a planned week",
    description:
      "How Calendar Automations turns dozens of overlapping calendar events into a clean list of free intervals, including the transparency-aware merge that handles SkedPal-style soft holds.",
    publishedAt: "2026-04-28",
    keywords: ["interval algebra", "busy merging", "gap finding", "scheduling"]
  },
  {
    slug: "sleep-and-travel-overlays",
    title: "Sleep and travel overlays in a weekly planner",
    description:
      "Why a planner that respects sleep windows and known travel time produces dramatically better weekly schedules, and how Calendar Automations layers those reservations before goals.",
    publishedAt: "2026-04-28",
    keywords: ["sleep schedule", "travel time", "weekly planning", "circadian"]
  },
  {
    slug: "mobile-first-settings-design",
    title: "Mobile-first settings design for a configuration-heavy app",
    description:
      "A planner has dozens of knobs. How to keep all of them configurable on a phone in five minutes without burying anything important — Calendar Automations' design philosophy.",
    publishedAt: "2026-04-28",
    keywords: ["mobile-first", "UX", "settings UI", "progressive disclosure"]
  },
  {
    slug: "when-to-rotate-feed-tokens",
    title: "When to rotate your iCal feed tokens (and why it matters)",
    description:
      "A practical security checklist for managing per-feed tokens: when to rotate, how cached subscriptions react, and the operational habits that keep your planner private.",
    publishedAt: "2026-04-28",
    keywords: ["feed tokens", "calendar security", "rotation", "operational security"]
  },
  {
    slug: "background-jobs-vercel-cron-inngest",
    title: "Why a planner needs background jobs: Vercel Cron + Inngest, explained",
    description:
      "A serverless function timing out mid-allocation is a feature, not a bug. Calendar Automations splits regeneration into chunked Inngest steps triggered by Vercel Cron — here is why and how.",
    publishedAt: "2026-04-28",
    keywords: ["Vercel Cron", "Inngest", "background jobs", "serverless"]
  }
];

export const PRICING_NOTE =
  "A$6/month or A$54/year (save 25%) in AUD, with a 7-day no-card free trial. Pricing is shown on the in-app billing page after sign-in. The app uses Stripe Checkout and the Stripe Customer Portal; cancel any time.";

/**
 * Build the canonical URL set for a given site origin. Pass the consumer's
 * resolved base URL (no trailing slash); the function never reads env.
 */
export function urlsFor(siteUrl: string) {
  const base = siteUrl.replace(/\/$/, "");
  return {
    home: base,
    faq: `${base}/faq`,
    learn: `${base}/learn`,
    about: `${base}/about`,
    contact: `${base}/contact`,
    privacy: `${base}/privacy`,
    terms: `${base}/terms`,
    signIn: `${base}/api/auth/signin`,
    dashboard: `${base}/dashboard`,
    billing: `${base}/dashboard/billing`,
    feeds: `${base}/dashboard/feeds`,
    llms: `${base}/llms.txt`,
    llmsFull: `${base}/llms-full.txt`
  } as const;
}

export type CanonicalUrls = ReturnType<typeof urlsFor>;
