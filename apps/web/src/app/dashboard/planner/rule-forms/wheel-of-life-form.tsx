import type { UserSettings } from "@margot/schema";
import { updateWheel } from "./framework-rules-actions";

export function WheelOfLifeForm({
  wheel
}: {
  wheel: UserSettings["wheel"];
}) {
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">Wheel of Life</summary>
      <p className="mt-1 text-xs text-ink-400">
        Areas of life that should each get some weekly time. Set a floor so neglected ones always get
        scheduled.
      </p>
      <form action={updateWheel} className="mt-3 grid gap-3 sm:grid-cols-2">
        {wheel.areas.map((a) => (
          <fieldset key={a.id} className="rounded border border-ink-200 p-2 dark:border-ink-600">
            <legend className="text-xs font-medium">{a.label}</legend>
            <label className="flex flex-col gap-1 text-xs">
              Score (1–10)
              <input
                name={`score_${a.id}`}
                type="number"
                min={1}
                max={10}
                defaultValue={a.score}
                className="field"
              />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs">
              Min minutes / week
              <input
                name={`floor_${a.id}`}
                type="number"
                min={0}
                step={15}
                defaultValue={a.minMinutesPerWeek}
                className="field"
              />
            </label>
          </fieldset>
        ))}
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary w-full text-xs">
            Save Wheel
          </button>
        </div>
      </form>
    </details>
  );
}
