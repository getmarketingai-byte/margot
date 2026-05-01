import { updateEnergyOrdering } from "./framework-rules-actions";

export function EnergyOrderingForm({ mode }: { mode: "strict" | "balanced" | "ignore" }) {
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">Energy ordering</summary>
      <p className="mt-1 text-xs text-ink-400">
        Lay deep-focus goals before scanning ones, matching your daily energy curve. This is the
        built-in <strong>hour / curve</strong> bias—not the optional &quot;Energy and calendar
        transitions&quot; method in this section, which adds transition and calendar-load nudges on
        top.
      </p>
      <form action={updateEnergyOrdering} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Mode
          <select name="mode" className="field" defaultValue={mode}>
            <option value="strict">Strict — refuse scanning before warm-up</option>
            <option value="balanced">Balanced — prefer the curve</option>
            <option value="ignore">Ignore — purely chronological</option>
          </select>
        </label>
        <button className="btn-primary text-xs" type="submit">
          Save
        </button>
      </form>
    </details>
  );
}
