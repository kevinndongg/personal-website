import { ZONE_FALLBACK_ACCENTS } from "./palette";
import { buildScene, sceneSize } from "./scenes";
import type { Decal, Footprint, Rect, Scene, ZoneVariant } from "./scenes";
import { SOLID_KINDS } from "./sprites";
import type { ItemColor, ItemKind } from "./sprites";

export type { Decal, Rect, ZoneVariant };

export const TILE = 16;
export const WORLD_W = 48;
export const WORLD_H = 48;
/** Navigation / collision cell size in px (finer than the 16 px terrain tiles). */
export const NAV = 4;

export type ZoneKind = "project" | "gallery" | "contact";

export interface ZoneAction {
  label: string;
  href: string;
  external?: boolean;
}

export interface ZoneInput {
  id: string;
  kind: ZoneKind;
  variant?: ZoneVariant;
  label: string;
  summary: string;
  href?: string;
  actions?: ZoneAction[];
  accent?: string;
}

export interface Zone extends ZoneInput {
  variant: ZoneVariant;
  accent: string;
  scene: Scene;
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
  w: number; // terrain tiles
  h: number;
  nw: number; // nav cells
  nh: number;
  terrain: Uint8Array; // tile resolution
  solid: Uint8Array; // nav resolution: real obstacles
  plan: Uint8Array; // nav resolution: obstacles dilated by one cell (what A* plans on)
  nearSolid: Uint8Array; // nav resolution: within ~3 cells of an obstacle (path cost penalty)
  reachable: Uint8Array; // nav resolution, on the planning grid
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

// Zones live on the edge ring. Rearrange by editing ZONE_SLOTS.
export type Slot = "TL" | "TM" | "TR" | "RM" | "BR" | "BM" | "BL" | "LM";
const SLOT_ORDER: Slot[] = ["TL", "TM", "TR", "RM", "BR", "BM", "BL", "LM"];
export const ZONE_SLOTS: Record<string, Slot> = {
  "cmu-racing": "TL",
  "auton-lab-vision": "TM",
  "temple-allen-internship": "TR",
  "uav-obstacle-detection": "RM",
  ftc: "BR",
  gallery: "BM",
  contact: "BL",
};

const SLOT_CELLS: Record<Slot, { col: "L" | "C" | "R"; row: "T" | "M" | "B" }> = {
  TL: { col: "L", row: "T" },
  TM: { col: "C", row: "T" },
  TR: { col: "R", row: "T" },
  RM: { col: "R", row: "M" },
  BR: { col: "R", row: "B" },
  BM: { col: "C", row: "B" },
  BL: { col: "L", row: "B" },
  LM: { col: "L", row: "M" },
};

const EDGE_PX = 3 * TILE;
const BOTTOM_PX = 2 * TILE;

function snap(v: number) {
  return Math.round(v / TILE) * TILE;
}

function slotOrigin(slot: Slot, w: number, h: number, edge: number) {
  const { col, row } = SLOT_CELLS[slot];
  const px = WORLD_W * TILE;
  const x = col === "L" ? edge : col === "R" ? px - edge - w : snap((px - w) / 2);
  const y = row === "T" ? edge : row === "B" ? px - BOTTOM_PX - h : snap((WORLD_H * TILE - h) / 2);
  return { x, y };
}

function defaultVariant(input: ZoneInput): ZoneVariant {
  return input.variant ?? (input.kind === "contact" ? "office" : "building");
}

function layoutZones(inputs: ZoneInput[]): Zone[] {
  const used = new Set<Slot>(inputs.map((i) => ZONE_SLOTS[i.id]).filter(Boolean));
  const spare = SLOT_ORDER.filter((s) => !used.has(s));
  return inputs.map((input, i) => {
    const variant = defaultVariant(input);
    const { w, h } = sceneSize(variant);
    const slot = ZONE_SLOTS[input.id] ?? spare.shift() ?? "LM";
    // the Racing garage sits right against the border wall
    const { x, y } = slotOrigin(slot, w, h, variant === "garage" ? TILE : EDGE_PX);
    return {
      ...input,
      variant,
      accent: input.accent ?? ZONE_FALLBACK_ACCENTS[i % ZONE_FALLBACK_ACCENTS.length],
      scene: buildScene(input.id, variant, x, y),
    } satisfies Zone;
  });
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

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
        }
    }
  return out;
}

function stampFootprint(solid: Uint8Array, nw: number, nh: number, x: number, y: number, fp: Footprint) {
  let x0: number, x1: number, y0: number, y1: number;
  let inside = (_px: number, _py: number) => true;
  if (fp.kind === "rect") {
    x0 = x - fp.w / 2;
    x1 = x + fp.w / 2;
    y0 = y - fp.h;
    y1 = y;
  } else {
    x0 = x - fp.r;
    x1 = x + fp.r;
    y0 = y - fp.r * 2;
    y1 = y;
    const cy = y - fp.r;
    inside = (px, py) => (px - x) ** 2 + (py - cy) ** 2 <= (fp.r + NAV / 2) ** 2;
  }
  for (let cy = Math.floor(y0 / NAV); cy <= Math.ceil(y1 / NAV) - 1; cy++)
    for (let cx = Math.floor(x0 / NAV); cx <= Math.ceil(x1 / NAV) - 1; cx++) {
      if (cx < 0 || cy < 0 || cx >= nw || cy >= nh) continue;
      if (inside(cx * NAV + NAV / 2, cy * NAV + NAV / 2)) solid[cy * nw + cx] = 1;
    }
}

function tryGenerate(inputs: ZoneInput[], seed: number): World | null {
  const zones = layoutZones(inputs);
  const w = WORLD_W;
  const h = WORLD_H;
  const nw = (w * TILE) / NAV;
  const nh = (h * TILE) / NAV;
  const rand = rng(seed);
  const solidT = new Uint8Array(w * h);
  const terrain = new Uint8Array(w * h);
  const reserved = new Uint8Array(w * h);
  const items: Item[] = [];
  const idx = (x: number, y: number) => y * w + x;

  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      solidT[idx(x, y)] = 1;
      terrain[idx(x, y)] = Terrain.Border;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      solidT[idx(x, y)] = 1;
      terrain[idx(x, y)] = Terrain.Border;
    }
  }

  const fillTiles = (r: Rect, margin: number, fn: (i: number) => void) => {
    const x0 = Math.max(1, Math.floor(r.x / TILE) - margin);
    const y0 = Math.max(1, Math.floor(r.y / TILE) - margin);
    const x1 = Math.min(w - 2, Math.ceil((r.x + r.w) / TILE) - 1 + margin);
    const y1 = Math.min(h - 2, Math.ceil((r.y + r.h) / TILE) - 1 + margin);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(idx(x, y));
  };

  for (const zone of zones) {
    fillTiles(zone.scene.area, 1, (i) => (reserved[i] = 1));
  }

  const start = { x: (w / 2) * TILE, y: (h / 2) * TILE };
  const stx = (start.x / TILE) | 0;
  const sty = (start.y / TILE) | 0;
  for (let y = sty - 3; y <= sty + 3; y++)
    for (let x = stx - 3; x <= stx + 3; x++) reserved[idx(x, y)] = 1;

  const occupied = new Uint8Array(w * h);
  const free = (x: number, y: number) =>
    x >= 1 && y >= 1 && x < w - 1 && y < h - 1 && !solidT[idx(x, y)] && !reserved[idx(x, y)] && !occupied[idx(x, y)];

  const place = (kind: ItemKind, x: number, y: number, color: ItemColor = "o") => {
    if (!free(x, y)) return false;
    const isSolid = SOLID_KINDS.has(kind);
    items.push({ kind, tx: x, ty: y, color, solid: isSolid });
    occupied[idx(x, y)] = 1;
    if (isSolid) solidT[idx(x, y)] = 1;
    return true;
  };

  const rx = () => 1 + Math.floor(rand() * (w - 2));
  const ry = () => 1 + Math.floor(rand() * (h - 2));

  // the open yard between project areas only gets worn tire piles
  for (let n = 0; n < 8; n++) {
    const x0 = rx();
    const y0 = ry();
    const count = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) place("tire", x0 + (k % 2), y0 + Math.floor(k / 2));
  }

  // collision / navigation grid: terrain tiles + free-form scene footprints
  const solid = new Uint8Array(nw * nh);
  const per = TILE / NAV;
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++)
      if (solidT[idx(tx, ty)])
        for (let dy = 0; dy < per; dy++)
          for (let dx = 0; dx < per; dx++) solid[(ty * per + dy) * nw + tx * per + dx] = 1;
  for (const zone of zones)
    for (const prop of zone.scene.props) if (prop.solid) stampFootprint(solid, nw, nh, prop.x, prop.y, prop.solid);

  const plan = dilate(solid, nw, nh, 1);
  const nearSolid = dilate(solid, nw, nh, 3);
  const scx = Math.floor(start.x / NAV);
  const scy = Math.floor(start.y / NAV);
  if (plan[scy * nw + scx]) return null;
  const reachable = flood(plan, nw, nh, scx, scy);
  for (const zone of zones) {
    const { stop } = zone.scene;
    if (!reachable[Math.floor(stop.y / NAV) * nw + Math.floor(stop.x / NAV)]) return null;
  }

  return { w, h, nw, nh, terrain, solid, plan, nearSolid, reachable, items, zones, start, seed };
}

export function generateWorld(inputs: ZoneInput[], seed = 7): World {
  for (let attempt = 0; attempt < 50; attempt++) {
    const world = tryGenerate(inputs, seed + attempt);
    if (world) return world;
  }
  throw new Error("Could not generate a connected world");
}

export function isSolidAtPx(world: World, px: number, py: number): boolean {
  const cx = Math.floor(px / NAV);
  const cy = Math.floor(py / NAV);
  if (cx < 0 || cy < 0 || cx >= world.nw || cy >= world.nh) return true;
  return world.solid[cy * world.nw + cx] === 1;
}

/** Center (px) of the reachable nav cell nearest to the given pixel position. */
export function nearestReachable(world: World, px: number, py: number): { x: number; y: number } | null {
  const tx = Math.floor(px / NAV);
  const ty = Math.floor(py / NAV);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let r = 0; r < Math.max(world.nw, world.nh); r++) {
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (x < 0 || y < 0 || x >= world.nw || y >= world.nh) continue;
        if (!world.reachable[y * world.nw + x]) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best && r >= Math.ceil(Math.sqrt(bestD))) break;
  }
  return best && { x: best.x * NAV + NAV / 2, y: best.y * NAV + NAV / 2 };
}

export function rectContains(r: Rect, x: number, y: number, inset = 0): boolean {
  return x >= r.x + inset && x < r.x + r.w - inset && y >= r.y + inset && y < r.y + r.h - inset;
}
