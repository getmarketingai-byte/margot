import Link from "next/link";

const features = [
  {
    title: "Time-mapped weeks",
    body: "Read your existing Google Calendar, find the gaps, and generate Needle-Mover, Execute, Ops, and Play bands for the next 60 days."
  },
  {
    title: "Energy-aware ordering",
    body: "Tag goals as hyperfocus, hyperaware, or neutral. The allocator places deep work first and protects you from afternoons of pure scanning."
  },
  {
    title: "Wheel of Life balance",
    body: "Set weekly minimums per area so neglected domains get guaranteed slots — no week disappears under work pressure."
  },
  {
    title: "PPF mix targets",
    body: "Personal, Professional, Financial — keep all three buckets touched every week with simple percentage and touch-count rules."
  },
  {
    title: "HP6 + HPP rhythms",
    body: "Morning bookends, evening scorecards, weekly reviews and monthly strategy reminders — wire them in your way."
  },
  {
    title: "Mobile-first",
    body: "Built to be configured on a phone in a few minutes; subscription iCal URLs sync to Apple, Google, and Outlook calendars automatically."
  }
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-12 px-5 pb-16 pt-10 sm:max-w-3xl">
      <header className="flex flex-col gap-4">
        <span className="text-xs uppercase tracking-widest text-ink-400">Calendar Automations</span>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          Plan a perfect week. Subscribe to it from any calendar.
        </h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          Connect Google Calendar, set your goals and balance targets, and we publish a private iCal
          feed of the week you intended to live — energy curve and all.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/api/auth/signin" className="btn-primary">
            Sign in with Google
          </Link>
          <Link href="/dashboard" className="btn-secondary">
            Open dashboard
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <article key={f.title} className="card">
            <h2 className="text-base font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{f.body}</p>
          </article>
        ))}
      </section>

      <footer className="text-xs text-ink-400">
        Migration target for the legacy Apps Script project.
      </footer>
    </main>
  );
}
