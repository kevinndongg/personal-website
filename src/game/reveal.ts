/** The card's easing (`--ease` in game.css): cubic-bezier(0.22, 0.8, 0.24, 1). */
const X1 = 0.22;
const Y1 = 0.8;
const X2 = 0.24;
const Y2 = 1;

const bezier = (s: number, a: number, b: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;

/** How far along (0..1) the card's growth is, a given fraction (0..1) of the way through its time. */
export function progressAt(time: number): number {
  const t = Math.min(1, Math.max(0, time));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, X1, X2) < t) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, Y1, Y2);
}

/** The fraction (0..1) of its time at which the card's growth has got a given fraction (0..1) of the way: the inverse of `progressAt`. */
export function timeAt(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, Y1, Y2) < p) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, X1, X2);
}

/**
 * When, in milliseconds into a move of `duration` ms, the card's moving edge (going from `from` to `to`, in any direction) is at `x`.
 * An `x` the edge starts beyond comes out as 0, and one it never reaches as `duration`.
 */
export function edgeTime(x: number, from: number, to: number, duration: number): number {
  if (from === to) return 0;
  return duration * timeAt((x - from) / (to - from));
}
