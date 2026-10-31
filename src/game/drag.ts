export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Keep a dragged card at least this far inside the window. */
export const DRAG_MARGIN = 8;

/** Clamps `value` to [lo, hi]; if there is no room (hi < lo), the low end wins, so the top/left of an oversized card stays in view. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, Math.max(lo, hi)));
}

/**
 * Where a dragged card's offset (from its resting place) ends up after the pointer has moved by `delta`, kept inside the
 * window. `rect` is the card's box now, with `offset` already applied; the card never leaves the window by more than the margin.
 */
export function clampDrag(rect: Box, offset: Point, delta: Point, view: { w: number; h: number }, margin = DRAG_MARGIN): Point {
  const restLeft = rect.left - offset.x;
  const restTop = rect.top - offset.y;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return {
    x: clamp(offset.x + delta.x, margin - restLeft, view.w - margin - width - restLeft),
    y: clamp(offset.y + delta.y, margin - restTop, view.h - margin - height - restTop),
  };
}
