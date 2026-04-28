/**
 * Generated event types — what the planner produces and what the ICS feed renders.
 *
 * Stable across schema versions; UIDs are deterministic so calendar clients update
 * existing entries on regeneration instead of duplicating them.
 */

import { z } from "zod";

export const generatedEventKindSchema = z.enum([
  "timemap",
  "sleep",
  "travel",
  "gym",
  "routine",
  "weekly-goal",
  "weekly-review",
  "monthly-strategy",
  "consistency-segment",
  "errand"
]);
export type GeneratedEventKind = z.infer<typeof generatedEventKindSchema>;

export const generatedEventSchema = z.object({
  /** Stable UID for ICS; survives regeneration. */
  uid: z.string().min(1),
  kind: generatedEventKindSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  /** Epoch ms in UTC. */
  startMs: z.number().int(),
  /** Epoch ms in UTC, exclusive. */
  endMs: z.number().int(),
  /** Whether the client should treat the event as busy (opaque) or free (transparent). */
  busy: z.boolean().default(true),
  /** Tags surfaced to the user; not required for ICS rendering. */
  tags: z.array(z.string()).default([])
});
export type GeneratedEvent = z.infer<typeof generatedEventSchema>;

export const calendarSnapshotSchema = z.object({
  generatedAt: z.number().int(),
  windowStartMs: z.number().int(),
  windowEndMs: z.number().int(),
  events: z.array(generatedEventSchema)
});
export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
