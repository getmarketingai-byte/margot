import Link from "next/link";
import type { Metadata } from "next";
import { ARTICLES, PRODUCT, SITE_URL } from "@/lib/marketing";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Learn",
  description:
    "Pillar articles from Calendar Automations on iCal subscription versus calendar write access, the privacy model for calendar-derived planning, and energy-aware time blocking.",
  alternates: { canonical: "/learn" }
};

export default function LearnIndex() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-10 sm:max-w-3xl">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-xs uppercase tracking-widest text-ink-400">
          ← {PRODUCT.name}
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Learn</h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          Short, specific articles on the design choices behind Calendar Automations. Each starts
          with a direct answer and cites the actual implementation.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {ARTICLES.map((a) => (
          <li key={a.slug}>
            <Link href={`/learn/${a.slug}`} className="card flex h-full flex-col gap-2">
              <span className="text-sm font-semibold">{a.title}</span>
              <span className="text-xs text-ink-600 dark:text-ink-200">{a.description}</span>
              <span className="mt-1 text-[10px] uppercase tracking-wider text-ink-400">
                {a.keywords.slice(0, 3).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
