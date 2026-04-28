/**
 * Lightweight timezone helpers built on Intl.DateTimeFormat — no external deps.
 * Sufficient for the planner's needs (day-key derivation, hour-of-day in tz).
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    cache.set(timeZone, f);
  }
  return f;
}

interface TimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parts(ms: number, timeZone: string): TimeParts {
  const tokens = fmt(timeZone)
    .formatToParts(new Date(ms))
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  return {
    year: Number(tokens.year),
    month: Number(tokens.month),
    day: Number(tokens.day),
    hour: Number(tokens.hour === "24" ? "0" : tokens.hour),
    minute: Number(tokens.minute),
    second: Number(tokens.second)
  };
}

export function dateKeyInTz(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p.year.toString().padStart(4, "0")}-${p.month
    .toString()
    .padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

export function hourInTz(ms: number, timeZone: string): number {
  return parts(ms, timeZone).hour;
}

/**
 * Returns the UTC epoch ms of midnight (00:00:00) on the given local date in tz.
 * Iterates a candidate guess until the formatted local date matches; safe across
 * DST transitions.
 */
export function localMidnightMs(year: number, month: number, day: number, timeZone: string): number {
  const targetKey = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  let guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = parts(guess, timeZone);
    const key = `${p.year.toString().padStart(4, "0")}-${p.month
      .toString()
      .padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
    const offsetMin = (p.hour * 60 + p.minute) - 0;
    if (key === targetKey && p.hour === 0 && p.minute === 0 && p.second === 0) {
      return guess;
    }
    if (key < targetKey) {
      guess += (24 * 60 - offsetMin) * 60_000;
    } else if (key > targetKey) {
      guess -= (offsetMin + 1) * 60_000;
      const r = parts(guess, timeZone);
      guess -= (r.hour * 3600 + r.minute * 60 + r.second) * 1000;
    } else {
      guess -= (p.hour * 3600 + p.minute * 60 + p.second) * 1000;
    }
  }
  return guess;
}

export function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

/** Returns Monday 00:00 (in `timeZone`) of the ISO week containing `ms`. */
export function startOfIsoWeekMs(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  const midnight = localMidnightMs(p.year, p.month, p.day, timeZone);
  // Compute weekday using the same midnight in tz; JS Date.getUTCDay gives correct
  // weekday for the *UTC* moment — which is fine because midnight is unique.
  const weekday = new Date(midnight).getUTCDay(); // 0=Sun .. 6=Sat
  const diff = (weekday + 6) % 7; // days since Monday
  return midnight - diff * 24 * 60 * 60 * 1000;
}
