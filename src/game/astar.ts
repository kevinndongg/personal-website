import { TILE, isSolidAtPx } from "./world";
import type { World } from "./world";

export interface Vec {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
// Tiles hugging an obstacle cost a little more, so paths keep a comfortable berth.
const NEAR_SOLID_PENALTY = 0.6;

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.ids.length;
  }

  push(id: number, key: number) {
    let i = this.ids.length;
    this.ids.push(id);
    this.keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/** 8-neighbour A* over tiles, no corner cutting. Returns tile coordinates start..goal, or null. */
export function findPath(world: World, sx: number, sy: number, gx: number, gy: number): Vec[] | null {
  const { w, h, solid, nearSolid } = world;
  if (solid[gy * w + gx]) return null;
  const start = sy * w + sx;
  const goal = gy * w + gx;
  const g = new Float32Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new MinHeap();

  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };

  g[start] = 0;
  heap.push(start, heuristic(sx, sy));

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (solid[n] || closed[n]) continue;
        if (dx && dy && (solid[cy * w + nx] || solid[ny * w + cx])) continue;
        const cost = g[cur] + (dx && dy ? SQRT2 : 1) + (nearSolid[n] ? NEAR_SOLID_PENALTY : 0);
        if (cost < g[n]) {
          g[n] = cost;
          from[n] = cur;
          heap.push(n, cost + heuristic(nx, ny));
        }
      }
    }
  }

  if (from[goal] === -1 && goal !== start) return null;
  const path: Vec[] = [];
  for (let i = goal; i !== -1; i = from[i]) path.push({ x: i % w, y: (i / w) | 0 });
  return path.reverse();
}

const CAR_RADIUS = 5;
const OFFSETS: Vec[] = [
  { x: 0, y: 0 },
  { x: CAR_RADIUS, y: 0 },
  { x: -CAR_RADIUS, y: 0 },
  { x: 0, y: CAR_RADIUS },
  { x: 0, y: -CAR_RADIUS },
];

/** True when a car-sized body can slide along the straight segment a->b without touching a solid tile. */
function clearLine(world: World, a: Vec, b: Vec): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const o of OFFSETS) if (isSolidAtPx(world, x + o.x, y + o.y)) return false;
  }
  return true;
}

/** Drop waypoints that the car can skip by driving straight. */
export function smoothPath(world: World, points: Vec[]): Vec[] {
  if (points.length <= 2) return points;
  const out: Vec[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !clearLine(world, points[i], points[j])) j--;
    out.push(points[j]);
    i = j;
  }
  return out;
}

/** Plan a drive from a pixel position to a goal tile; returns pixel waypoints (start not included). */
export function planDrive(world: World, from: Vec, goalTile: Vec): Vec[] | null {
  const sx = Math.floor(from.x / TILE);
  const sy = Math.floor(from.y / TILE);
  const tiles = findPath(world, sx, sy, goalTile.x, goalTile.y);
  if (!tiles) return null;
  const centers = tiles.slice(1).map((t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 }));
  if (!centers.length) return [];
  return smoothPath(world, [from, ...centers]);
}
