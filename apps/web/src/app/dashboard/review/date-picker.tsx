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

  const navLinkClass = "text-center";
  const prevNextClass = `btn-secondary text-xs ${navLinkClass} min-w-0 flex-1 sm:flex-initial`;
  const todayClass = `text-xs ${navLinkClass} min-w-0 flex-1 sm:flex-initial ${
    isToday ? "btn-primary" : "btn-secondary"
  }`;

  return (
    <section className="card flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-ink-400">
          Day sheet
        </div>
        <div className="text-lg font-semibold">{prettyLabel}</div>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
        <div className="flex gap-1">
          <Link
            href={`/dashboard/review?date=${prevDate}`}
            className={prevNextClass}
          >
            ← Previous
          </Link>
          <Link
            href={`/dashboard/review?date=${todayDate}`}
            className={todayClass}
          >
            Today
          </Link>
          <Link
            href={`/dashboard/review?date=${nextDate}`}
            className={prevNextClass}
          >
            Next →
          </Link>
        </div>
        <form
          action="/dashboard/review"
          method="get"
          className="flex min-w-0 w-full items-center gap-2 sm:w-auto"
        >
          <label className="sr-only" htmlFor="review-date">
            Pick a date
          </label>
          <input
            id="review-date"
            type="date"
            name="date"
            defaultValue={date}
            className="field min-w-0 flex-1 text-xs"
          />
          <button type="submit" className="btn-secondary shrink-0 text-xs">
            Go
          </button>
        </form>
      </div>
    </section>
  );
}
