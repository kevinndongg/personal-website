import { ZONE_FALLBACK_ACCENTS } from "./palette";
import { BUILDING_H, BUILDING_W, SOLID_KINDS } from "./sprites";
import type { ItemColor, ItemKind } from "./sprites";

export const TILE = 16;
export const WORLD_W = 64;

export interface ZoneInput {
  id: string;
  kind: "project" | "gallery";
  label: string;
  summary: string;
  href: string;
  accent?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone extends ZoneInput {
  accent: string;
  building: Rect; // px
  pad: Rect; // px, the parking spot that triggers the overlay
  labelPos: { x: number; y: number }; // px, above the building
}

export interface Item {
  kind: ItemKind;
  tx: number;
  ty: number;
  color: ItemColor;
  solid: boolean;
}

export const Terrain = { Asphalt: 0, Concrete: 1, Border: 2 } as const;

export interface World {
  w: number;
  h: number;
  solid: Uint8Array;
  nearSolid: Uint8Array;
  reachable: Uint8Array;
  terrain: Uint8Array;
  items: Item[];
  zones: Zone[];
  start: { x: number; y: number }; // px
  seed: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLS = 3;
const SLOT_X = [5, 28, 51];
const ROW_PITCH = 20;
const ROW_TOP = 6;
const PAD_ROWS = 2;

function layoutZones(inputs: ZoneInput[]): { zones: Zone[]; h: number; startTy: number } {
  const rows = Math.max(1, Math.ceil(inputs.length / COLS));
  const h = ROW_TOP + (rows - 1) * ROW_PITCH + BUILDING_H + PAD_ROWS + 10;
  const zones = inputs.map((input, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const tx = SLOT_X[col];
    const ty = ROW_TOP + row * ROW_PITCH;
    return {
      ...input,
      accent: input.accent ?? ZONE_FALLBACK_ACCENTS[i % ZONE_FALLBACK_ACCENTS.length],
      building: { x: tx * TILE, y: ty * TILE, w: BUILDING_W * TILE, h: BUILDING_H * TILE },
      pad: {
        x: (tx + 2) * TILE,
        y: (ty + BUILDING_H) * TILE,
        w: 4 * TILE,
        h: PAD_ROWS * TILE,
      },
      labelPos: { x: (tx + BUILDING_W / 2) * TILE, y: ty * TILE + 2 },
    } satisfies Zone;
  });
  const startTy = rows > 1 ? ROW_TOP + BUILDING_H + PAD_ROWS + 6 : ROW_TOP + BUILDING_H + PAD_ROWS + 3;
  return { zones, h, startTy };
}

function flood(solid: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || solid[j]) continue;
        if (dx && dy && (solid[y * w + nx] || solid[ny * w + x])) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}

function tryGenerate(inputs: ZoneInput[], seed: number): World | null {
  const { zones, h, startTy } = layoutZones(inputs);
  const w = WORLD_W;
  const rand = rng(seed);
  const solid = new Uint8Array(w * h);
  const terrain = new Uint8Array(w * h);
  const reserved = new Uint8Array(w * h);
  const items: Item[] = [];
  const idx = (x: number, y: number) => y * w + x;

  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      solid[idx(x, y)] = 1;
      terrain[idx(x, y)] = Terrain.Border;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      solid[idx(x, y)] = 1;
      terrain[idx(x, y)] = Terrain.Border;
    }
  }

  const fillTiles = (r: Rect, margin: number, fn: (i: number) => void) => {
    const x0 = Math.max(1, r.x / TILE - margin);
    const y0 = Math.max(1, r.y / TILE - margin);
    const x1 = Math.min(w - 2, (r.x + r.w) / TILE - 1 + margin);
    const y1 = Math.min(h - 2, (r.y + r.h) / TILE - 1 + margin);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(idx(x, y));
  };

  for (const zone of zones) {
    fillTiles(zone.building, 0, (i) => (solid[i] = 1));
    fillTiles(zone.building, 1, (i) => (reserved[i] = 1));
    fillTiles(zone.pad, 1, (i) => (reserved[i] = 1));
    // concrete apron around the building + pad
    const apron: Rect = {
      x: zone.building.x,
      y: zone.building.y,
      w: zone.building.w,
      h: zone.building.h + zone.pad.h,
    };
    fillTiles(apron, 2, (i) => {
      if (!solid[i]) terrain[i] = Terrain.Concrete;
    });
  }

  const start = { x: (w / 2) * TILE, y: startTy * TILE + TILE / 2 };
  const stx = (start.x / TILE) | 0;
  const sty = (start.y / TILE) | 0;
  for (let y = sty - 3; y <= sty + 3; y++)
    for (let x = stx - 3; x <= stx + 3; x++) reserved[idx(x, y)] = 1;

  const occupied = new Uint8Array(w * h);
  const free = (x: number, y: number) =>
    x >= 1 && y >= 1 && x < w - 1 && y < h - 1 && !solid[idx(x, y)] && !reserved[idx(x, y)] && !occupied[idx(x, y)];

  const place = (kind: ItemKind, x: number, y: number, color: ItemColor = "o") => {
    if (!free(x, y)) return false;
    const isSolid = SOLID_KINDS.has(kind);
    items.push({ kind, tx: x, ty: y, color, solid: isSolid });
    occupied[idx(x, y)] = 1;
    if (isSolid) solid[idx(x, y)] = 1;
    return true;
  };

  const rx = () => 1 + Math.floor(rand() * (w - 2));
  const ry = () => 1 + Math.floor(rand() * (h - 2));
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

  // cone lines (orange or racing blue), spaced so a car can slip between them
  for (let n = 0; n < 16; n++) {
    const color: ItemColor = rand() < 0.5 ? "o" : "b";
    const horiz = rand() < 0.5;
    const x0 = rx();
    const y0 = ry();
    const len = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < len; k++) place("cone", x0 + (horiz ? k * 2 : 0), y0 + (horiz ? 0 : k * 2), color);
  }
  // worn tire piles
  for (let n = 0; n < 12; n++) {
    const x0 = rx();
    const y0 = ry();
    const count = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) place("tire", x0 + (k % 2), y0 + Math.floor(k / 2));
  }
  // FTC game pieces in red / yellow / blue
  for (let n = 0; n < 8; n++) {
    const x0 = rx();
    const y0 = ry();
    const count = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++)
      place("cube", x0 + Math.floor(rand() * 3), y0 + Math.floor(rand() * 2), pick<ItemColor>(["r", "b", "y"]));
  }
  for (let n = 0; n < 14; n++) place("laptop", rx(), ry());
  for (let n = 0; n < 8; n++) place("toolbox", rx(), ry());
  for (let n = 0; n < 12; n++) place("gear", rx(), ry());
  for (let n = 0; n < 8; n++) {
    const x0 = rx();
    const y0 = ry();
    const horiz = rand() < 0.5;
    const len = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < len; k++) place("barrier", x0 + (horiz ? k : 0), y0 + (horiz ? 0 : k));
  }

  const nearSolid = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      if (!solid[idx(x, y)])
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (solid[idx(x + dx, y + dy)]) nearSolid[idx(x, y)] = 1;

  const reachable = flood(solid, w, h, stx, sty);
  for (const zone of zones) {
    const cx = ((zone.pad.x + zone.pad.w / 2) / TILE) | 0;
    const cy = ((zone.pad.y + zone.pad.h / 2) / TILE) | 0;
    if (!reachable[idx(cx, cy)]) return null;
  }

  return { w, h, solid, nearSolid, reachable, terrain, items, zones, start, seed };
}

export function generateWorld(inputs: ZoneInput[], seed = 7): World {
  for (let attempt = 0; attempt < 50; attempt++) {
    const world = tryGenerate(inputs, seed + attempt);
    if (world) return world;
  }
  throw new Error("Could not generate a connected world");
}

export function isSolidAtPx(world: World, px: number, py: number): boolean {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
  return world.solid[ty * world.w + tx] === 1;
}

/** Nearest tile the car can actually reach from the start area, searching outward from (tx, ty). */
export function nearestReachable(world: World, tx: number, ty: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let r = 0; r < Math.max(world.w, world.h); r++) {
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        if (!world.reachable[y * world.w + x]) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best && r >= Math.ceil(Math.sqrt(bestD))) break;
  }
  return best;
}

export function rectContains(r: Rect, x: number, y: number, inset = 0): boolean {
  return x >= r.x + inset && x < r.x + r.w - inset && y >= r.y + inset && y < r.y + r.h - inset;
}
