"use client";

/**
 * Shared chrome for scheduling / goal constraint panels (matches Perfect Week goal constraint rows).
 */
export function ConstraintCard({
  label,
  children,
  onRemove,
  className = ""
}: {
  label: string;
  children: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border border-ink-200 bg-ink-50/50 p-2 dark:border-ink-600 dark:bg-ink-900/40 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            title={`Remove ${label}`}
            className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-600/40 dark:hover:text-ink-100"
          >
            ✕
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
