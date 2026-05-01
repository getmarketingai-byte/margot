import type { Hp6HabitKey } from "@calendar-automations/schema";
import { updateHpp } from "./framework-rules-actions";

const HP6_ROWS: Readonly<{ key: Hp6HabitKey; label: string }[]> = [
  { key: "clarity", label: "Seek clarity" },
  { key: "energy", label: "Generate energy" },
  { key: "necessity", label: "Raise necessity" },
  { key: "productivity", label: "Increase productivity" },
  { key: "influence", label: "Develop influence" },
  { key: "courage", label: "Demonstrate courage" }
];

export function Hp6HabitsForm({
  hp6MinTouchesPerMonth
}: {
  hp6MinTouchesPerMonth: Partial<Record<Hp6HabitKey, number>>;
}) {
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">High-performance habits (HP6)</summary>
      <p className="mt-1 text-xs text-ink-400">
        Tag goals with a habit and we&apos;ll ensure each habit hits its minimum touches per month.
      </p>
      <form action={updateHpp} className="mt-3 grid gap-3 sm:grid-cols-2">
        {HP6_ROWS.map((h) => (
          <label key={h.key} className="flex flex-col gap-1 text-xs">
            {h.label}
            <input
              name={`hp6_${h.key}`}
              type="number"
              min={0}
              defaultValue={hp6MinTouchesPerMonth[h.key] ?? 0}
              className="field"
            />
          </label>
        ))}
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary w-full text-xs">
            Save habits
          </button>
        </div>
      </form>
    </details>
  );
}
