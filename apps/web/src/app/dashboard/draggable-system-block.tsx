"use client";

/**
 * Draggable wrapper around sleep + routine blocks on the week calendar.
 *
 * Behaviour:
 *   • Pointer-down captures the pointer; subsequent moves shift the block
 *     vertically only, snapping to 15-minute increments.
 *   • Pointer-up persists the new time via the `setBlockOverride` server
 *     action. Block height stays fixed — drag moves both endpoints.
 *   • Already-overridden blocks show a small "modified" dot and a reset
 *     link that calls `clearBlockOverride`.
 *   • Drag cancels (Escape, contextmenu) snap the block back without
 *     persisting.
 *
 * We intentionally avoid a drag library — the parent grid is already
 * absolute-positioned with a stable px-per-hour scale, so a custom
 * pointer-event hook keeps the bundle small. Snap math is shared with the
 * server-rendered placement (`PX_PER_HOUR`).
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { setBlockOverride, clearBlockOverride } from "./plan/actions";

const SNAP_MIN = 15;
const MS_PER_MIN = 60_000;

interface DraggableSystemBlockProps {
  topPx: number;
  heightPx: number;
  pxPerHour: number;
  /** Title to display inside the block. */
  title: string;
  /** Tailwind colour utility classes for the block body. */
  styles: string;
  /** Original (rendered) start/end of the block in epoch ms. */
  startMs: number;
  endMs: number;
  /** Override identity — used for both the upsert + reset calls. */
  overrideKind: "sleep" | "routine";
  overrideKey: string;
  /** Whether the user has previously dragged this block. */
  isOverridden: boolean;
}

export function DraggableSystemBlock({
  topPx,
  heightPx,
  pxPerHour,
  title,
  styles,
  startMs,
  endMs,
  overrideKind,
  overrideKey,
  isOverridden
}: DraggableSystemBlockProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startY: number;
    cancelled: boolean;
  } | null>(null);
  // Live offset (in px) applied during drag; cleared on pointerup/save.
  const [dragPx, setDragPx] = useState(0);
  const [pending, setPending] = useState(false);

  const pxPerMin = pxPerHour / 60;
  const snapPx = SNAP_MIN * pxPerMin;

  function snapToGrid(deltaPx: number): number {
    return Math.round(deltaPx / snapPx) * snapPx;
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

    const finalPx = snapToGrid(e.clientY - drag.startY);
    setDragPx(0);
    if (drag.cancelled || finalPx === 0) return;

    const deltaMin = finalPx / pxPerMin;
    const deltaMs = deltaMin * MS_PER_MIN;
    setPending(true);
    try {
      await setBlockOverride({
        kind: overrideKind,
        key: overrideKey,
        startMs: startMs + deltaMs,
        endMs: endMs + deltaMs,
        source: "drag"
      });
    } catch (err) {
      console.warn("setBlockOverride failed", err);
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

  // Escape during drag cancels.
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
      await clearBlockOverride(overrideKind, overrideKey);
    } catch (err) {
      console.warn("clearBlockOverride failed", err);
    } finally {
      setPending(false);
    }
  }

  const bodyStyle: CSSProperties = {
    top: topPx + dragPx,
    height: heightPx,
    cursor: dragState.current ? "grabbing" : "grab",
    touchAction: "none"
  };

  return (
    <div
      ref={elRef}
      title={title}
      role="button"
      tabIndex={0}
      aria-label={`${title}. Drag vertically to override.`}
      className={`group absolute inset-x-0.5 select-none overflow-hidden rounded px-1 py-0.5 text-[10px] shadow-sm ${styles} ${
        pending ? "opacity-60" : ""
      } ${isOverridden ? "ring-1 ring-current/40" : ""}`}
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
        {isOverridden && (
          <span
            aria-label="Modified by drag"
            title="Modified — click reset to restore"
            className="mt-0.5 block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current"
          />
        )}
      </div>
      {isOverridden && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void reset();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={pending}
          className="absolute bottom-0.5 right-0.5 hidden rounded bg-current/15 px-1 text-[9px] font-medium text-current hover:bg-current/25 group-hover:block"
        >
          reset
        </button>
      )}
    </div>
  );
}
