"use client";

export function PlannerWeekdaysField({
  value,
  onChange,
  name,
  placeholder = "e.g. monday,wednesday — leave blank for any day",
  hint = "Comma-separated English weekday names."
}: {
  value: string;
  onChange: (next: string) => void;
  name?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      Only on these weekdays (optional)
      <input
        type="text"
        {...(name ? { name } : {})}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field w-full"
      />
      <span className="text-[11px] text-ink-400">{hint}</span>
    </label>
  );
}
