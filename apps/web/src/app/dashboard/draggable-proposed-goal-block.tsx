"use client";

/**
 * Drag-to-move for weekly proposed goal blocks on the calendar (same pointer +
 * 15-minute vertical snap as DraggableSystemBlock; horizontal drag moves across
 * day columns). Persists via `setGoalBlockOverridesBatch` when a merged bar
 * maps to multiple allocator slices.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
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
  overrideSource?: "drag" | "actual";
  pinnedFromOverride?: boolean;
  /** True when this slice is a minimum-on-busy overlay (may overlap calendar busy when dragging). */
  overBusy?: boolean;
}

export type GoalDragReservation = {
  startMs: number;
  endMs: number;
  /** When true, drag may overlap this interval if the block is an NN busy overlay. */
  calendarBusyLayer: boolean;
};

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
  reservedForGoalDrag: readonly GoalDragReservation[];
  /**
   * When true, calendar busy intervals in `reservedForGoalDrag` are ignored for collision
   * (NN minimum overlay blocks).
   */
  allowCalendarBusyOverlap?: boolean;
  /**
   * When set, called with new epoch times per `dragKey` after a successful save.
   */
  onDragCommit?: (updates: Record<string, { startMs: number; endMs: number }>) => void;
  /** When drag overrides are cleared (reset), parent can drop optimistic patches without a full reload. */
  onDragOverridesCleared?: (dragKeys: string[]) => void;
  /** Tiny framework chips under the goal title (Perfect Week overlays). */
  frameworkOverlayChips?: ReadonlyArray<{ abbr: string; title: string }>;
  /** Stacking vs timemap ribbons (Perfect Week hybrid layering). */
  layerZClass?: string;
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
  reservedForGoalDrag,
  onDragCommit,
  frameworkOverlayChips,
  onDragOverridesCleared,
  layerZClass = "z-20",
  allowCalendarBusyOverlap = false
}: DraggableProposedGoalBlockProps) {
  const router = useRouter();
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const pxPerMin = pxPerHour / 60;
  const snapPx = SNAP_MIN * pxPerMin;

  function snapToGrid(deltaPx: number): number {
    return Math.round(deltaPx / snapPx) * snapPx;
  }

  const isLocked =
    slices.some(
      (s) =>
        s.dragOverrideSaved ||
        s.pinnedFromOverride ||
        s.overrideSource === "actual"
    );

  /** Calendar drag pins only — day-sheet `actual` pins use the hover reset / day sheet. */
  const canContextMenuReset = slices.some(
    (s) =>
      s.overrideSource === "drag" ||
      (s.overrideSource !== "actual" && Boolean(s.dragOverrideSaved || s.pinnedFromOverride))
  );

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
        if (allowCalendarBusyOverlap && r.calendarBusyLayer) continue;
        if (intervalsOverlap(ns, ne, r.startMs, r.endMs)) {
          console.warn("Goal drag rejected: overlaps sleep, routine, travel, day-sheet log, or an existing event.");
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
      const updates: Record<string, { startMs: number; endMs: number }> = {};
      for (const s of slices) {
        updates[s.dragKey] = { startMs: s.startMs + deltaMs, endMs: s.endMs + deltaMs };
      }
      if (onDragCommit) {
        onDragCommit(updates);
      }
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
    const keys = slices.map((s) => s.dragKey);
    try {
      await clearGoalDragOverrides(keys);
      onDragOverridesCleared?.(keys);
      if (!onDragOverridesCleared) {
        router.refresh();
      }
    } catch (err) {
      console.warn("clearGoalDragOverrides failed", err);
    } finally {
      setPending(false);
    }
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  useEffect(() => {
    if (!contextMenu) return;
    function onPointerDown(e: PointerEvent) {
      const menu = contextMenuRef.current;
      if (menu?.contains(e.target as Node)) return;
      closeContextMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeContextMenu();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const isFromDaySheet = slices.some((s) => s.overrideSource === "actual");
  const isBusyOverlay = slices.some((s) => s.overBusy);

  const bodyStyle: CSSProperties = {
    top: topPx,
    height: heightPx,
    transform: `translate(${dragPxX}px, ${dragPx}px)`,
    cursor: dragState.current ? "grabbing" : "grab",
    touchAction: "none",
    backgroundColor,
    opacity: pending ? opacity * 0.6 : opacity,
    ...(isFromDaySheet
      ? {
          backgroundImage:
            "linear-gradient(105deg, rgba(15,23,42,0.2), rgba(15,23,42,0.08)), repeating-linear-gradient(45deg, rgba(0,0,0,0.14) 0 2px, transparent 2px 6px)"
        }
      : {})
  };

  const overlayHint =
    frameworkOverlayChips && frameworkOverlayChips.length > 0
      ? ` · Frameworks: ${frameworkOverlayChips.map((c) => c.title).join(" · ")}`
      : "";

  return (
    <div
      ref={elRef}
      title={`${title}${isLocked ? " (locked)" : " (proposed)"}${overlayHint}`}
      role="button"
      tabIndex={0}
      aria-label={`${title}. ${isLocked ? "Locked time from your plan or day sheet — drag to adjust." : "Drag to move within the week."}`}
      className={`group absolute inset-x-0.5 ${layerZClass} select-none overflow-hidden rounded px-1 py-0.5 text-[10px] font-medium text-white shadow-sm ${
        isLocked ? "ring-1 ring-white/50" : ""
      } ${
        isFromDaySheet
          ? "ring-1 ring-ink-900/25 ring-inset dark:ring-white/20"
          : ""
      } ${isBusyOverlay ? "ring-1 ring-dashed ring-white/80 ring-inset" : ""}`}
      style={bodyStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        if (dragState.current) {
          e.preventDefault();
          abortDrag();
          return;
        }
        if (!canContextMenuReset) return;
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-start justify-between gap-1">
          <span className="line-clamp-2 leading-tight">{title}</span>
          {isLocked && (
            <span
              aria-label={
                slices.some((s) => s.overrideSource === "actual")
                  ? "From day sheet"
                  : "Locked on calendar"
              }
              title={
                slices.some((s) => s.overrideSource === "actual")
                  ? "Day-sheet actual — reset in day sheet or drag to change"
                  : "Locked — click reset to restore auto time"
              }
              className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-white"
            />
          )}
        </div>
        {frameworkOverlayChips && frameworkOverlayChips.length > 0 ? (
          <div className="pointer-events-none flex flex-wrap gap-0.5 pb-4">
            {frameworkOverlayChips.map((c, idx) => (
              <span
                key={`${c.abbr}-${idx}`}
                title={c.title}
                className="rounded bg-black/35 px-1 text-[7px] font-semibold uppercase leading-none text-white/95 backdrop-blur-sm"
              >
                {c.abbr}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {isLocked && (
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
      {contextMenu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contextMenuRef}
            role="menu"
            className="fixed z-[100] min-w-[12rem] rounded-md border border-ink-200 bg-white py-1 text-sm shadow-lg dark:border-ink-600 dark:bg-ink-900"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              className="block w-full px-3 py-2 text-left text-ink-800 hover:bg-ink-100 disabled:opacity-50 dark:text-ink-100 dark:hover:bg-ink-800"
              onClick={() => {
                closeContextMenu();
                void reset();
              }}
            >
              Reset to scheduled time
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
