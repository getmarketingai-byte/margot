"use client";

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "dashboard.plan.split.leftPercent";
const DEFAULT_LEFT_PERCENT = 60;
const MIN_LEFT_PERCENT = 30;
const MAX_LEFT_PERCENT = 75;

function clampPercent(v: number): number {
  return Math.min(MAX_LEFT_PERCENT, Math.max(MIN_LEFT_PERCENT, v));
}

export function ResizableColumns({
  left,
  right
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPercent, setLeftPercent] = useState<number>(DEFAULT_LEFT_PERCENT);
  const leftPercentRef = useRef<number>(DEFAULT_LEFT_PERCENT);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      setLeftPercent(clampPercent(parsed));
    } catch {
      // Ignore storage failures (private mode, denied access, etc.).
    }
  }, []);

  const cssVars = useMemo(
    () =>
      ({
        "--left-col": `${leftPercent}%`,
        "--right-col": `${100 - leftPercent}%`
      }) as CSSProperties,
    [leftPercent]
  );

  useEffect(() => {
    leftPercentRef.current = leftPercent;
  }, [leftPercent]);

  const startDrag = (startClientX: number) => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0) return;
    const initialLeft = leftPercent;

    const onMove = (clientX: number) => {
      const deltaPx = clientX - startClientX;
      const deltaPercent = (deltaPx / rect.width) * 100;
      setLeftPercent(clampPercent(initialLeft + deltaPercent));
    };

    const handlePointerMove = (event: PointerEvent) => onMove(event.clientX);
    const handleMouseMove = (event: MouseEvent) => onMove(event.clientX);
    const onEnd = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", onEnd);
      try {
        window.localStorage.setItem(STORAGE_KEY, String(leftPercentRef.current));
      } catch {
        // Ignore storage failures.
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", onEnd);
  };

  return (
    <div
      ref={containerRef}
      style={cssVars}
      className="relative grid gap-5 lg:[grid-template-columns:minmax(0,var(--left-col))_minmax(0,var(--right-col))]"
    >
      {/* Below lg, single column: week preview (right) stacks above goals (left). */}
      <div className="order-2 min-w-0 lg:order-none">{left}</div>
      <aside className="order-1 min-w-0 lg:order-none">{right}</aside>

      <button
        type="button"
        aria-label="Resize goals and calendar panels"
        title="Drag to resize panels"
        onPointerDown={(e) => {
          e.preventDefault();
          startDrag(e.clientX);
        }}
        className="absolute bottom-0 top-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize bg-transparent lg:block"
        style={{ left: `var(--left-col)` }}
      >
        <span
          aria-hidden
          className="absolute bottom-4 left-1/2 top-4 w-0.5 -translate-x-1/2 rounded-full bg-ink-200 hover:bg-accent dark:bg-ink-600"
        />
      </button>
    </div>
  );
}
