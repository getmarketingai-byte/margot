"use client";

import type { VisionSettings, WeeklyIntent } from "@margot/schema";
import { WeeklyIntentCard } from "../plan/weekly-intent-card";
import { VisionCard } from "./planning-hub-client";

export function WhyWeeklyIntentSection({
  initialWeeklyIntent,
  initialVision,
  saveWeeklyIntent,
  saveVision
}: {
  initialWeeklyIntent: WeeklyIntent;
  initialVision: VisionSettings;
  saveWeeklyIntent: (input: WeeklyIntent) => Promise<void>;
  saveVision: (input: VisionSettings) => Promise<void>;
}) {
  return (
    <section
      className="card flex flex-col gap-5"
      aria-labelledby="why-weekly-intent-heading"
    >
      <header>
        <h2 id="why-weekly-intent-heading" className="text-lg font-semibold">
          Why &amp; weekly intent
        </h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
          Anchor the week in words first; frameworks and rules below shape how blocks are placed.
        </p>
      </header>
      <WeeklyIntentCard
        variant="embedded"
        initial={initialWeeklyIntent}
        save={saveWeeklyIntent}
      />
      <VisionCard embedded initial={initialVision} save={saveVision} />
    </section>
  );
}
