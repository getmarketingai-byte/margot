"use client";

/**
 * Drag-to-move for weekly proposed goal blocks on the calendar (same pointer +
 * 15-minute snap behaviour as DraggableSystemBlock). Persists via
 * `setGoalBlockOverridesBatch` when a merged bar maps to multiple allocator slices.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { dispatchGoalFocus } from "@/lib/goal-focus";
import { clearGoalDragOverrides, setGoalBlockOverridesBatch } from "./plan/actions";

const SNAP_MIN = 15;
const MS_PER_MIN = 60_000;

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
}

export function DraggableProposedGoalBlock({
  topPx,
  heightPx,
  pxPerHour,
  title,
  backgroundColor,
  opacity,
  goalId,
  slices
}: DraggableProposedGoalBlockProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startY: number;
    cancelled: boolean;
  } | null>(null);
  const [dragPx, setDragPx] = useState(0);
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
      startY: e.clientY,
      cancelled: false
    };
    setDragPx(0);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = e.clientY - drag.startY;
    setDragPx(snapToGrid(delta));
  }

  async function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = elRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragState.current = null;

    const rawDelta = e.clientY - drag.startY;
    setDragPx(0);

    if (drag.cancelled) return;

    const deltaMs = snapDeltaMs(rawDelta);
    if (deltaMs === 0) {
      if (Math.abs(rawDelta) < 4) dispatchGoalFocus(goalId);
      return;
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
    top: topPx + dragPx,
    height: heightPx,
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
      aria-label={`${title}. Drag vertically to move this goal slot.`}
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
