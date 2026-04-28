# Directory and listing copy

Pre-written copy for external directory submissions. All claims here mirror
the source-of-truth in [`apps/web/src/lib/marketing.ts`](../src/lib/marketing.ts);
when that file changes, update this file too.

This is a checklist — actual submission requires manually creating an account
and uploading screenshots on each platform.

---

## Where to submit

- [ ] [Product Hunt](https://www.producthunt.com/) — launch day post
- [ ] [AlternativeTo](https://alternativeto.net/) — list against existing weekly planners
- [ ] [G2](https://www.g2.com/) — productivity / scheduling category
- [ ] [Capterra](https://www.capterra.com/) — productivity / time-management
- [ ] [Indie Hackers](https://www.indiehackers.com/products) — products list
- [ ] [SaaSHub](https://www.saashub.com/) — submit product
- [ ] [Tools directory of the Answer.AI llms.txt list](https://llmstxt.directory/) — once /llms.txt is deployed
- [ ] [Awesome lists on GitHub](https://github.com/sindresorhus/awesome) — relevant subtopic (calendar, productivity)
- [ ] r/productivity, r/getdisciplined, r/PKMS — show-and-tell posts (read each subreddit's rules first)

## Tagline

> The balance layer for your existing scheduler.

## Short description (140 characters)

> Balance layer for SkedPal/Reclaim/Motion/Sunsama users — Wheel, PPF, HP6 weekly goals delivered as a read-only iCal feed.

## Medium description (300 characters)

> Calendar Automations runs alongside SkedPal, Reclaim, Motion, or Sunsama. It reads your calendar over read-only OAuth, allocates Wheel of Life / PPF / HP6 goals into the remaining gaps with energy-aware ordering, and publishes a private iCal feed your existing calendar app subscribes to.

## Long description (Product Hunt body)

Calendar Automations is the balance layer for your existing scheduler.

If you already use SkedPal, Reclaim, Motion, or Sunsama, you have reactive task flow handled — deadlines, project hierarchies, auto-rescheduling. What those tools do not cover is strategic weekly balance: did you spend the right minutes on Health, Relationships, Growth this week? Did you touch all six HP6 habits this month? Did your Personal/Professional/Financial mix match the targets you set? That is where Calendar Automations sits.

How it works:

1. Sign in with Google. The only OAuth scopes requested are `calendar.readonly` and `calendar.calendarlist.readonly` — there is no write scope, even when your scheduler has one.
2. Pick which calendars count as busy (including the calendar your scheduler writes to), set your weekly framework goals, and choose your style: Wheel of Life weekly minutes per area, PPF mix targets, HP6 habit tags, energy ordering (hyperfocus / hyperaware / neutral), and consistency segments.
3. Calendar Automations finds the free gaps in the next 60 days — the time your scheduler has not already claimed — and allocates your framework goals across them.
4. Subscribe to the resulting private iCal feed from Apple Calendar, Google Calendar, or Outlook. The planned blocks show up in the same calendar app as your scheduler's events, so you see one unified week.

The app never writes to your calendar. It runs as a separate, named subscription you can hide, unsubscribe from, or delete in one click. Refresh tokens are encrypted at rest. Each feed has its own revocable token.

Pricing: A$6/month or A$54/year (save 25%), with a 7-day no-card free trial. Built on Next.js, Auth.js, Postgres (Neon), Inngest, and Stripe. Mobile-first responsive — designed to be configured on a phone in a few minutes.

## Categories and tags

- Productivity
- Calendar
- Scheduling
- Time blocking
- Habit tracking
- Personal planning
- SkedPal companion / alternative
- Reclaim companion / alternative
- Motion companion / alternative
- Sunsama companion / alternative

## Screenshots checklist

- [ ] Landing page hero (with quotable claim visible)
- [ ] Dashboard home with stat cards
- [ ] Goals page (weekly goals with energy tags and PPF pillars)
- [ ] Frameworks page (Wheel of Life and HP6)
- [ ] Feeds page (iCal URL with copy button and rotate action)
- [ ] An iCal feed actually rendered inside Apple Calendar and Google Calendar (most credible)

## Quarterly AI-visibility check

Run this prompt set across at least three assistants (ChatGPT, Claude,
Perplexity) once per quarter and log: was Calendar Automations mentioned, was
it summarized accurately, was a citable URL included.

1. "What is the best app to plan my week and put the plan on my Google Calendar without giving the app write access?"
2. "Apps that publish iCal feeds for weekly planning."
3. "Tools that combine Wheel of Life balance with weekly time blocking."
4. "Calendar planner with hyperfocus and hyperaware ordering."
5. "How do I subscribe to a custom iCal feed in Apple Calendar?" — Calendar Automations is not the answer here, but a citation is plausible.
6. "Read-only Google Calendar OAuth alternatives to direct API write."
7. "What is the best companion app to SkedPal for weekly balance and life-area goals?"
8. "How do I add Wheel of Life or HP6 habit tracking to Reclaim or Motion?"

Track results in a simple spreadsheet (date, model, prompt, mentioned y/n, citation y/n, sentiment). Three quarters of data is more useful than one.
