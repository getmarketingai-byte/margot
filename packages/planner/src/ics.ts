/**
 * ICS (RFC 5545) renderer for generated events.
 *
 * Stable UIDs ensure that re-running the planner updates existing events in the
 * subscriber's calendar instead of creating duplicates. Each kind of event uses
 * a deterministic key (start time + tag) so that scheduling shifts are visible
 * but identity persists for the same logical block.
 */

import type { GeneratedEvent } from "@margot/schema";

interface IcsOptions {
  productId?: string;
  calendarName: string;
  /** Domain or stable identifier used as the UID suffix. */
  domain?: string;
  /** Subscription refresh hint accepted by Apple Calendar / Outlook. */
  refreshIntervalMinutes?: number;
}

const DEFAULT_PRODID = "-//margot//planner//EN";

export function renderIcs(events: readonly GeneratedEvent[], opts: IcsOptions): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(`PRODID:${opts.productId ?? DEFAULT_PRODID}`);
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:${escapeText(opts.calendarName)}`);
  if (opts.refreshIntervalMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshIntervalMinutes}M`);
    lines.push(`X-PUBLISHED-TTL:PT${opts.refreshIntervalMinutes}M`);
  }
  for (const ev of events) {
    if (!isRenderableEvent(ev)) continue;
    pushEvent(lines, ev, opts);
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function pushEvent(lines: string[], ev: GeneratedEvent, opts: IcsOptions): void {
  const dom = sanitiseUidToken(opts.domain ?? "margot");
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${sanitiseUidToken(ev.uid)}@${dom}`);
  lines.push(`DTSTAMP:${formatUtcStamp(Date.now())}`);
  lines.push(`DTSTART:${formatUtcStamp(ev.startMs)}`);
  lines.push(`DTEND:${formatUtcStamp(ev.endMs)}`);
  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  lines.push(`TRANSP:${ev.busy ? "OPAQUE" : "TRANSPARENT"}`);
  if (ev.tags && ev.tags.length > 0) {
    lines.push(`CATEGORIES:${ev.tags.map(escapeText).join(",")}`);
  }
  lines.push("END:VEVENT");
}

function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * RFC 5545 line folding: lines longer than 75 octets must be split with CRLF
 * followed by a single space at the start of the continuation line.
 */
function foldLine(line: string): string {
  // RFC 5545 counts octets (bytes), not JS UTF-16 code units.
  if (utf8ByteLength(line) <= 75) return line;
  const segments: string[] = [];
  let current = "";
  let currentBytes = 0;
  const maxBytesFirst = 75;
  const maxBytesContinuation = 74; // continuation has one leading space

  for (const char of line) {
    const charBytes = utf8ByteLength(char);
    const maxBytes = segments.length === 0 ? maxBytesFirst : maxBytesContinuation;
    if (currentBytes + charBytes > maxBytes) {
      segments.push(segments.length === 0 ? current : ` ${current}`);
      current = char;
      currentBytes = charBytes;
      continue;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current.length > 0) {
    segments.push(segments.length === 0 ? current : ` ${current}`);
  }
  return segments.join("\r\n");
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function sanitiseUidToken(token: string): string {
  return String(token)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._@-]/g, "")
    .slice(0, 200);
}

function isRenderableEvent(ev: GeneratedEvent): boolean {
  if (!ev?.uid || !ev?.title) return false;
  if (!Number.isFinite(ev.startMs) || !Number.isFinite(ev.endMs)) return false;
  return ev.endMs > ev.startMs;
}

/**
 * Build a stable UID for a generated event. Inputs should be deterministic for
 * a given user + plan + block; the same inputs always produce the same UID.
 */
export function buildStableUid(parts: readonly (string | number)[]): string {
  return parts
    .map((p) => String(p).replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .join("-");
}
