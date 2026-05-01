"use client";

/** Matches Perfect Week “Times per week” constraint (sliders + number). */
export function SessionsPerWeekField({
  value,
  onChange,
  label = "Times per week (1–14)",
  name
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  label?: string;
  /** When set, the number input participates in form POST (e.g. server actions). */
  name?: string;
}) {
  const clamp = (n: number) => Math.min(14, Math.max(1, Math.round(n)));
  const sliderPos = clamp(value ?? 3);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span>{label}</span>
        <input
          type="number"
          min={1}
          max={14}
          name={name}
          value={value === undefined ? "" : value}
          onChange={(e) => {
            if (e.target.value === "") {
              onChange(undefined);
              return;
            }
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(clamp(n));
          }}
          placeholder="3"
          className="field"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Adjust times per week with a slider</span>
        <input
          type="range"
          min={1}
          max={14}
          step={1}
          value={sliderPos}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(clamp(n));
          }}
          className="h-2 w-full cursor-pointer accent-accent"
        />
      </label>
    </div>
  );
}
