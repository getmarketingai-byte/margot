"use client";

/**
 * Drag-to-move for weekly proposed goal blocks on the calendar (same pointer +
 * 15-minute vertical snap as DraggableSystemBlock; horizontal drag moves across
 * day columns). Persists via `setGoalBlockOverridesBatch` when a merged bar
 * maps to multiple allocator slices.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { dispatchGoalFocus } from "@/lib/goal-focus";
import { clearGoalDragOverrides, setGoalBlockOverridesBatch } from "./plan/actions";

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const SNAP_MIN = 15;
const MS_PER_MIN = 60_000;
/** Calendar-day shift between columns (DST handled imperfectly; rare edge case). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Finds `[data-week-day-index]` under the pointer. The dragged block must be
 * excluded from hit-testing (it stays DOM-parented under the source column
 * while `transform` moves it visually), otherwise we always resolve the
 * original day.
 */
function weekDayIndexUnderPoint(
  clientX: number,
  clientY: number,
  ignoreHitTarget: HTMLElement | null
): number | null {
  const prevPointerEvents = ignoreHitTarget?.style.pointerEvents;
  if (ignoreHitTarget) ignoreHitTarget.style.pointerEvents = "none";
  try {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      let node: Element | null = el;
      while (node) {
        if (node instanceof HTMLElement && node.dataset.weekDayIndex !== undefined) {
          const n = Number(node.dataset.weekDayIndex);
          return Number.isFinite(n) ? n : null;
        }
        node = node.parentElement;
      }
    }
    return null;
  } finally {
    if (ignoreHitTarget) {
      ignoreHitTarget.style.pointerEvents = prevPointerEvents ?? "";
    }
  }
}

export interface GoalCalendarSlice {
  dragKey: string;
  startMs: number;
  endMs: number;
  dragOverrideSaved?: boolean;
}

interface DraggableProposedGoalBlockProps {
  topPx: number;
  heightPx: number;
  pxPerHour: number;
  title: string;
  backgroundColor: string;
  opacity: number;
  goalId: string;
  slices: GoalCalendarSlice[];
  /** Which week column this block sits in (same index as `WeekCalendar` day columns). */
  dayIndex: number;
  /**
   * Sleep, routines, travel, and calendar busy — drags that would overlap any
   * of these are rejected (matches planner hard constraints).
   */
  reservedForGoalDrag: readonly { startMs: number; endMs: number }[];
}

export function DraggableProposedGoalBlock({
  topPx,
  heightPx,
  pxPerHour,
  title,
  backgroundColor,
  opacity,
  goalId,
  slices,
  dayIndex,
  reservedForGoalDrag
}: DraggableProposedGoalBlockProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cancelled: boolean;
  } | null>(null);
  const [dragPx, setDragPx] = useState(0);
  const [dragPxX, setDragPxX] = useState(0);
  const [pending, setPending] = useState(false);

  const pxPerMin = pxPerHour / 60;
  const snapPx = SNAP_MIN * pxPerMin;

  function snapToGrid(deltaPx: number): number {
    return Math.round(deltaPx / snapPx) * snapPx;
  }

  const hasSavedOverride = slices.some((s) => s.dragOverrideSaved);

  function snapDeltaMs(deltaPx: number): number {
    const deltaMin = snapToGrid(deltaPx) / pxPerMin;
    return deltaMin * MS_PER_MIN;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = elRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      cancelled: false
    };
    setDragPx(0);
    setDragPxX(0);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const deltaY = e.clientY - drag.startY;
    setDragPx(snapToGrid(deltaY));
    setDragPxX(e.clientX - drag.startX);
  }

  async function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = elRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragState.current = null;

    const rawDeltaY = e.clientY - drag.startY;
    const rawDeltaX = e.clientX - drag.startX;
    setDragPx(0);
    setDragPxX(0);

    if (drag.cancelled) return;

    const targetDay = weekDayIndexUnderPoint(e.clientX, e.clientY, el ?? null);
    const dayDelta = targetDay !== null ? targetDay - dayIndex : 0;
    const deltaMsVertical = snapDeltaMs(rawDeltaY);
    const deltaMs = deltaMsVertical + dayDelta * DAY_MS;

    if (deltaMs === 0) {
      if (Math.abs(rawDeltaY) < 4 && Math.abs(rawDeltaX) < 4) dispatchGoalFocus(goalId);
      return;
    }

    for (const s of slices) {
      const ns = s.startMs + deltaMs;
      const ne = s.endMs + deltaMs;
      for (const r of reservedForGoalDrag) {
        if (intervalsOverlap(ns, ne, r.startMs, r.endMs)) {
          console.warn("Goal drag rejected: overlaps sleep, routine, travel, or an existing event.");
          return;
        }
      }
    }

    setPending(true);
    try {
      await setGoalBlockOverridesBatch(
        slices.map((s) => ({
          kind: "goal" as const,
          key: s.dragKey,
          startMs: s.startMs + deltaMs,
          endMs: s.endMs + deltaMs,
          source: "drag" as const
        }))
      );
    } catch (err) {
      console.warn("setGoalBlockOverridesBatch failed", err);
    } finally {
      setPending(false);
    }
  }

  function abortDrag() {
    const drag = dragState.current;
    if (!drag) return;
    drag.cancelled = true;
    setDragPx(0);
    setDragPxX(0);
    const el = elRef.current;
    if (el && el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
    dragState.current = null;
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current && dragState.current.pointerId !== e.pointerId) return;
    abortDrag();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dragState.current) abortDrag();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reset() {
    setPending(true);
    try {
      await clearGoalDragOverrides(slices.map((s) => s.dragKey));
    } catch (err) {
      console.warn("clearGoalDragOverrides failed", err);
    } finally {
      setPending(false);
    }
  }

  const bodyStyle: CSSProperties = {
    top: topPx,
    height: heightPx,
    transform: `translate(${dragPxX}px, ${dragPx}px)`,
    cursor: dragState.current ? "grabbing" : "grab",
    touchAction: "none",
    backgroundColor,
    opacity: pending ? opacity * 0.6 : opacity
  };

  return (
    <div
      ref={elRef}
      title={`${title} (proposed)`}
      role="button"
      tabIndex={0}
      aria-label={`${title}. Drag to move this goal slot within the week.`}
      className={`group absolute inset-x-0.5 z-20 select-none overflow-hidden rounded px-1 py-0.5 text-[10px] font-medium text-white shadow-sm ${
        hasSavedOverride ? "ring-1 ring-white/50" : ""
      }`}
      style={bodyStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        if (dragState.current) {
          e.preventDefault();
          abortDrag();
        }
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 leading-tight">{title}</span>
        {hasSavedOverride && (
          <span
            aria-label="Modified by drag"
            title="Modified — click reset to restore"
            className="mt-0.5 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white"
          />
        )}
      </div>
      {hasSavedOverride && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void reset();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={pending}
          className="absolute bottom-0.5 right-0.5 hidden rounded bg-black/20 px-1 text-[9px] font-medium text-white hover:bg-black/30 group-hover:block"
        >
          reset
        </button>
      )}
    </div>
  );
}
