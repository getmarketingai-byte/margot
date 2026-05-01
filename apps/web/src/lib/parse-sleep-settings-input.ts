export type IdealWakeParts = { hour: number; minute: number };

const FALLBACK_WAKE: IdealWakeParts = { hour: 7, minute: 0 };

/**
 * Parses ideal wake strings such as `6:30am`, `06:30`, `18:45`, `7`, `12pm`.
 * Without a.m./p.m., a lone `H` or `H:MM` is treated as 24-hour wall clock.
 */
export function parseIdealWakeInput(raw: string, fallback: IdealWakeParts = FALLBACK_WAKE): IdealWakeParts {
  const parsed = tryParseIdealWake(raw);
  return parsed ?? fallback;
}

export function tryParseIdealWake(raw: string): IdealWakeParts | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;

  const ampm = s.match(/^(\d{1,2})(?::(\d{1,2}))?\s*([ap])m$/);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2] !== undefined ? Number(ampm[2]) : 0;
    const mer = ampm[3];
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59 || m < 0) return null;
    if (h < 1 || h > 12) return null;
    const isPm = mer === "p";
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
    return clampWake(h, m);
  }

  const h24col = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (h24col) {
    const h = Number(h24col[1]);
    const m = Number(h24col[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59 || m < 0 || h > 23 || h < 0) return null;
    return clampWake(h, m);
  }

  const plain = s.match(/^(\d{1,2})$/);
  if (plain) {
    const h = Number(plain[1]);
    if (!Number.isFinite(h) || h > 23 || h < 0) return null;
    return clampWake(h, 0);
  }

  return null;
}

function clampWake(hour: number, minute: number): IdealWakeParts {
  return {
    hour: Math.max(0, Math.min(23, Math.trunc(hour))),
    minute: Math.max(0, Math.min(59, Math.trunc(minute)))
  };
}

/** Display default for the ideal-wake text field (12-hour with a.m./p.m.). */
export function formatIdealWakeForInput(hour: number, minute: number): string {
  const { hour: h, minute: m } = clampWake(hour, minute);
  const suffix = h < 12 ? "am" : "pm";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  if (m === 0) return `${h12}${suffix}`;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Parses sleep duration as decimal hours (`8`, `7.5`) or hours:minutes (`7:30` → 7.5).
 * Rejects a.m./p.m. tokens (wake-time syntax).
 */
export function parseSleepDurationInput(raw: string, fallbackHours: number): number {
  const parsed = tryParseSleepDurationHours(raw);
  if (parsed === null) return fallbackHours;
  return parsed;
}

export function tryParseSleepDurationHours(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/\b[ap]m\b/.test(s)) return null;

  const hm = s.match(/^(\d+)\s*:\s*(\d{1,2})\s*$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59 || m < 0 || h < 0) return null;
    return h + m / 60;
  }

  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Prefer `H:MM` when there is a fractional hour so the field matches how people type. */
export function formatSleepDurationForInput(durationHours: number): string {
  if (!Number.isFinite(durationHours) || durationHours <= 0) return "8";
  const totalMinutes = Math.round(durationHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return String(h);
  return `${h}:${String(m).padStart(2, "0")}`;
}
