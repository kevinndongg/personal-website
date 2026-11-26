// Walking round things, for the people and robots of the DARPA Triage Challenge area (see dtcflight.ts): a grid of the site, a path
// across it that keeps clear of the wreck, the tent, the cones and every casualty's body (A*, then pulled straight wherever it can be), and
// a safety net that pushes a walker out of anything it has been nudged into. Plain numbers only, no three.
import type { NavShape } from "./scenes";

export interface Pt {
  x: number;
  y: number;
}

const CELL = 2; // px per grid cell
/** How far a walker's centre keeps from anything solid (px): its radius, and a little. */
export const AGENT = 3.4;
/** How far a path keeps from the centre of somebody standing still. */
export const PEOPLE = 5.4;
/** How far a walker's centre keeps from the body of a casualty it is going to, or has just left (it kneels right beside them). */
const BESIDE = 1.2;
/** How close to the start or the end of a path (px) that is allowed. */
const NEAR_ENDS = 9;

interface Ctx {
  from: Pt;
  to: Pt;
  leaving: number[];
  target: number;
  agents: Pt[];
}

/** Whether (x, y) is inside `shape` grown by `margin`. */
function near(s: NavShape, x: number, y: number, margin: number): boolean {
  if (s.kind === "circle") return Math.hypot(x - s.x, y - s.y) < s.r + margin;
  const a = s.angle ?? 0;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const dx = x - s.x;
  const dy = y - s.y;
  return Math.abs(dx * c + dy * n) < s.w / 2 + margin && Math.abs(-dx * n + dy * c) < s.h / 2 + margin;
}

/** How far to move (x, y) to stand `margin` clear of `shape` (the shortest way out), or null when it already does. */
function pushOut(s: NavShape, x: number, y: number, margin: number): Pt | null {
  if (s.kind === "circle") {
    const dx = x - s.x;
    const dy = y - s.y;
    const d = Math.hypot(dx, dy);
    const need = s.r + margin;
    if (d >= need) return null;
    return d > 1e-6 ? { x: (dx * (need - d)) / d, y: (dy * (need - d)) / d } : { x: need, y: 0 };
  }
  const a = s.angle ?? 0;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const dx = x - s.x;
  const dy = y - s.y;
  const u = dx * c + dy * n;
  const v = -dx * n + dy * c;
  const hu = s.w / 2 + margin;
  const hv = s.h / 2 + margin;
  if (Math.abs(u) >= hu || Math.abs(v) >= hv) return null;
  const penU = hu - Math.abs(u);
  const penV = hv - Math.abs(v);
  const pu = penU < penV ? (u >= 0 ? penU : -penU) : 0;
  const pv = penU < penV ? 0 : v >= 0 ? penV : -penV;
  return { x: pu * c - pv * n, y: pu * n + pv * c };
}

export class Nav {
  private cols: number;
  private rows: number;
  private fixedCell: Uint8Array; // the cells that the fixed things block, worked out once

  /**
   * `area` is the ground that can be walked; `fixed` the things that stay where they are (the wreck, the tent, the cones); `bodies` the
   * casualties, which are the same but are told apart so that a walker can go right up to the one it is going to.
   */
  constructor(
    private area: { x: number; y: number; w: number; h: number },
    private fixed: NavShape[],
    private bodies: NavShape[]
  ) {
    this.cols = Math.ceil(area.w / CELL);
    this.rows = Math.ceil(area.h / CELL);
    this.fixedCell = new Uint8Array(this.cols * this.rows);
    for (let cy = 0; cy < this.rows; cy++)
      for (let cx = 0; cx < this.cols; cx++) {
        const p = this.centre(cx, cy);
        this.fixedCell[cy * this.cols + cx] = this.fixedBlocked(p.x, p.y) ? 1 : 0;
      }
  }

  private centre(cx: number, cy: number): Pt {
    return { x: this.area.x + (cx + 0.5) * CELL, y: this.area.y + (cy + 0.5) * CELL };
  }

  private cellOf(p: Pt): [number, number] {
    return [
      Math.min(this.cols - 1, Math.max(0, Math.floor((p.x - this.area.x) / CELL))),
      Math.min(this.rows - 1, Math.max(0, Math.floor((p.y - this.area.y) / CELL))),
    ];
  }

  private fixedBlocked(x: number, y: number): boolean {
    const edge = AGENT + 1;
    if (x < this.area.x + edge || y < this.area.y + edge || x > this.area.x + this.area.w - edge || y > this.area.y + this.area.h - edge) return true;
    return this.fixed.some((s) => near(s, x, y, AGENT));
  }

  /** The casualties within `d` px of `p` (their bodies, that is): the ones a walker standing there is beside. */
  bodiesNear(p: Pt, d: number): number[] {
    const out: number[] = [];
    this.bodies.forEach((b, i) => {
      if (near(b, p.x, p.y, d)) out.push(i);
    });
    return out;
  }

  /**
   * Whether a walker cannot stand at (x, y). It keeps well clear of every body but two: the casualty it is leaving (`leaving`, if it is
   * within a few px of where it started, `from`) and the one it is going to (`target`, within a few px of where it ends, `to`), which it may
   * stand right beside; and it keeps clear of the `agents`.
   */
  private blockedAt(x: number, y: number, ctx: Ctx): boolean {
    if (this.fixedBlocked(x, y)) return true;
    for (let i = 0; i < this.bodies.length; i++) {
      const close = (ctx.leaving.includes(i) && Math.hypot(x - ctx.from.x, y - ctx.from.y) < NEAR_ENDS) || (i === ctx.target && Math.hypot(x - ctx.to.x, y - ctx.to.y) < NEAR_ENDS);
      if (near(this.bodies[i], x, y, close ? BESIDE : AGENT)) return true;
    }
    return ctx.agents.some((a) => Math.hypot(x - a.x, y - a.y) < PEOPLE);
  }

  private blockedCell(cx: number, cy: number, ctx: Ctx): boolean {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true;
    if (this.fixedCell[cy * this.cols + cx]) return true;
    const p = this.centre(cx, cy);
    return this.blockedAt(p.x, p.y, ctx);
  }

  /** The nearest free cell to (cx, cy) within a few cells, or null. */
  private nearestFree(cx: number, cy: number, free: (x: number, y: number) => boolean): [number, number] | null {
    if (free(cx, cy)) return [cx, cy];
    for (let r = 1; r <= 9; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !free(cx + dx, cy + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = [cx + dx, cy + dy];
          }
        }
      if (best) return best;
    }
    return null;
  }

  /** A*, 8 ways, between two free cells. The cells of the way (both ends included), or null if there is none. */
  private search(s: [number, number], g: [number, number], free: (x: number, y: number) => boolean): [number, number][] | null {
    const { cols, rows } = this;
    const n = cols * rows;
    const cost = new Float32Array(n).fill(Infinity);
    const rank = new Float32Array(n);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap: number[] = [];
    const h = (i: number) => {
      const dx = Math.abs((i % cols) - g[0]);
      const dy = Math.abs(Math.floor(i / cols) - g[1]);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const push = (i: number) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const up = (k - 1) >> 1;
        if (rank[heap[up]] <= rank[heap[k]]) break;
        [heap[up], heap[k]] = [heap[k], heap[up]];
        k = up;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && rank[heap[l]] < rank[heap[m]]) m = l;
          if (r < heap.length && rank[heap[r]] < rank[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const start = s[1] * cols + s[0];
    const goal = g[1] * cols + g[0];
    cost[start] = 0;
    rank[start] = h(start);
    push(start);
    while (heap.length) {
      const i = pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === goal) break;
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !free(nx, ny)) continue;
          if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue; // (no cutting a corner)
          const j = ny * cols + nx;
          if (closed[j]) continue;
          const c = cost[i] + (dx && dy ? 1.414 : 1);
          if (c < cost[j]) {
            cost[j] = c;
            from[j] = i;
            rank[j] = c + h(j);
            push(j);
          }
        }
    }
    if (goal !== start && from[goal] < 0) return null;
    const way: [number, number][] = [];
    for (let i = goal; i >= 0; i = i === start ? -1 : from[i]) way.unshift([i % cols, Math.floor(i / cols)]);
    return way;
  }

  /**
   * A way from `from` to `to` as a polyline that stays clear of everything, `target` being the casualty it is going to (it may go right up
   * to them, as to any it is standing beside at the start) and `agents` the people standing still on the way. The ends may stand inside something that is in the way (a walker leaving a
   * casualty it has just treated, a goal that has been crowded); the path then leaves it, or ends, at the nearest clear ground. If there is
   * no way at all it is null.
   */
  path(from: Pt, to: Pt, opts: { target?: number; agents?: Pt[] } = {}): Pt[] | null {
    // the casualty it is going to may be gone right up to; so may any it is standing beside now (it has just treated them), where it starts
    const ctx: Ctx = { from, to, leaving: this.bodiesNear(from, 8), target: opts.target ?? -1, agents: opts.agents ?? [] };
    const free = (cx: number, cy: number) => !this.blockedCell(cx, cy, ctx);
    const s0 = this.cellOf(from);
    const g0 = this.cellOf(to);
    const s = this.nearestFree(s0[0], s0[1], free);
    const g = this.nearestFree(g0[0], g0[1], free);
    if (!s || !g) return null;
    const cells = this.search(s, g, free);
    if (!cells) return null;
    const startBlocked = !free(s0[0], s0[1]);
    const goalBlocked = !free(g0[0], g0[1]);
    const end = goalBlocked ? this.centre(g[0], g[1]) : to;
    const pts: Pt[] = [from, ...cells.map(([cx, cy]) => this.centre(cx, cy)), end];

    // pull it straight: from each point, on to the furthest one it can see
    const clear = (a: Pt, b: Pt, graceA: number, graceB: number) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.ceil(d);
      for (let k = 1; k < steps; k++) {
        const u = k / steps;
        if (u * d < graceA || (1 - u) * d < graceB) continue;
        if (this.blockedAt(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, ctx)) return false;
      }
      return true;
    };
    const out: Pt[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !clear(pts[i], pts[j], i === 0 && startBlocked ? 9 : 0, j === pts.length - 1 && goalBlocked ? 9 : 0)) j--;
      out.push(pts[j]);
      i = j;
    }
    // (drop points that are on top of each other: a path of zero length has no direction)
    return out.filter((p, k) => k === 0 || Math.hypot(p.x - out[k - 1].x, p.y - out[k - 1].y) > 0.3 || k === out.length - 1);
  }

  /** The safety net: (x, y) pushed out of anything it has been nudged into (not by as much as a path keeps clear: this is only to stop it standing in them). */
  resolve(p: Pt): Pt {
    let x = p.x;
    let y = p.y;
    for (let pass = 0; pass < 3; pass++) {
      for (const s of this.fixed) {
        const push = pushOut(s, x, y, 1);
        if (push) {
          x += push.x;
          y += push.y;
        }
      }
      for (const s of this.bodies) {
        const push = pushOut(s, x, y, 0.3);
        if (push) {
          x += push.x;
          y += push.y;
        }
      }
    }
    return { x, y };
  }
}
