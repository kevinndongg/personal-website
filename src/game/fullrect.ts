export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the card goes when it is expanded: the whole view, less `margin` on every side (never smaller than nothing). */
export function fullRect(view: { w: number; h: number }, margin: number): Rect {
  const m = Math.max(0, Math.min(margin, view.w / 2, view.h / 2));
  return { left: m, top: m, width: view.w - 2 * m, height: view.h - 2 * m };
}
