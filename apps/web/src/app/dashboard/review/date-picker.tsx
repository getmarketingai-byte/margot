"use client";

import Link from "next/link";

interface ReviewDatePickerProps {
  /** ISO date currently being viewed. */
  date: string;
  /** ISO of "today" in the user's TZ; used to compute prev/next. */
  todayDate: string;
  /** ISO of the previous day. */
  prevDate: string;
  /** ISO of the next day. */
  nextDate: string;
  /** Pretty long-form label, e.g. "Wed 29 Apr 2026". */
  prettyLabel: string;
}

/**
 * Three-button day jumper plus a date input. Server roundtrips on every
 * change since each ISO date is its own row keyed by `(userId, date)` and
 * the page-level data load is server-side.
 */
export function ReviewDatePicker({
  date,
  todayDate,
  prevDate,
  nextDate,
  prettyLabel
}: ReviewDatePickerProps) {
  const isToday = date === todayDate;

  return (
    <section className="card flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-400">
          Reviewing
        </div>
        <div className="text-lg font-semibold">{prettyLabel}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/dashboard/review?date=${prevDate}`}
          className="btn-secondary text-xs"
        >
          ← Previous
        </Link>
        <Link
          href={`/dashboard/review?date=${todayDate}`}
          className={`text-xs ${isToday ? "btn-primary" : "btn-secondary"}`}
        >
          Today
        </Link>
        <Link
          href={`/dashboard/review?date=${nextDate}`}
          className="btn-secondary text-xs"
        >
          Next →
        </Link>
        <form
          action="/dashboard/review"
          method="get"
          className="flex items-center gap-2"
        >
          <label className="sr-only" htmlFor="review-date">
            Pick a date
          </label>
          <input
            id="review-date"
            type="date"
            name="date"
            defaultValue={date}
            className="field text-xs"
          />
          <button type="submit" className="btn-secondary text-xs">
            Go
          </button>
        </form>
      </div>
    </section>
  );
}
