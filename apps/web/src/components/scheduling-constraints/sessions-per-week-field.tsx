"use client";

/** Perfect Week “Times per week” — min/max session days (1–14) with sliders + numbers. */
export function SessionsPerWeekField({
  minValue,
  maxValue,
  onChange,
  label = "Times per week (1–14)",
  names
}: {
  minValue: number | undefined;
  maxValue: number | undefined;
  onChange: (next: { min: number; max: number }) => void;
  label?: string;
  /** When set, min/max inputs participate in form POST (e.g. server actions). */
  names?: { min?: string; max?: string };
}) {
  const clamp = (n: number) => Math.min(14, Math.max(1, Math.round(n)));
  const lo = clamp(minValue ?? maxValue ?? 3);
  const hi = clamp(maxValue ?? minValue ?? 3);
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  const commit = (nextA: number, nextB: number) => {
    const x = clamp(nextA);
    const y = clamp(nextB);
    onChange({ min: Math.min(x, y), max: Math.max(x, y) });
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <span>{label}</span>
      <label className="flex flex-col gap-1">
        <span>Min times / week</span>
        <input
          type="number"
          min={1}
          max={14}
          name={names?.min}
          value={a}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            commit(n, b);
          }}
          className="field"
        />
        <span className="sr-only">Adjust minimum times per week</span>
        <input
          type="range"
          min={1}
          max={14}
          step={1}
          value={a}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            commit(n, b);
          }}
          className="h-2 w-full cursor-pointer accent-accent"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Max times / week</span>
        <input
          type="number"
          min={1}
          max={14}
          name={names?.max}
          value={b}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            commit(a, n);
          }}
          className="field"
        />
        <span className="sr-only">Adjust maximum times per week</span>
        <input
          type="range"
          min={1}
          max={14}
          step={1}
          value={b}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            commit(a, n);
          }}
          className="h-2 w-full cursor-pointer accent-accent"
        />
      </label>
    </div>
  );
}
