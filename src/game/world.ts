import { FIXED_AT } from "./name";
import { ZONE_FALLBACK_ACCENTS } from "./palette";
import { buildScene, sceneSize } from "./scenes";
import type { Decal, Rect, Scene, ZoneVariant } from "./scenes";

export type { Decal, Rect, ZoneVariant };

export const TILE = 16;
export const WORLD_W = 48;
export const WORLD_H = 48;

/**
 * A "link" is a slab plate that opens its `href` when pressed (no panel); an "about" is the name, which opens a card about you.
 */
export type ZoneKind = "project" | "gallery" | "link" | "about";

export interface ZoneAction {
  label: string;
  href: string;
  external?: boolean;
}

/** What the page tells the game about one project / area (all plain data). */
export interface ZoneInput {
  id: string;
  kind: ZoneKind;
  variant?: ZoneVariant;
  label: string;
  summary: string;
  href?: string;
  actions?: ZoneAction[];
  accent?: string;
  // overlay content
  role?: string;
  period?: string;
  organization?: string;
  /** The line beside the logo on the card, and the one under it (both optional: see `orgLine` for the default). */
  brand?: string;
  brandNote?: string;
  /** The card has a button that expands it to nearly the whole window. */
  expandable?: boolean;
  /** With `brand`: the line that takes the title's place, smaller (without it the title is dropped). */
  subtitle?: string;
  techStack?: string[];
  bullets?: string[];
  /** Photos and videos shown at the bottom of the card, in order. */
  media?: ZoneMedia[];
  image?: string;
  /** The photos the light table cycles through, in order, photodesk variant only. */
  photos?: ZonePhoto[];
}

/**
 * One photo or video on a project's card. All paths are final (the page has made them). Halves pair up two to a row, a
 * full one takes a row; `width` and `height` reserve the space before the file has loaded.
 */
interface MediaPlacing {
  size: "half" | "full";
  caption?: string;
}
export type ZoneMedia =
  | ({ type: "image"; src: string; width: number; height: number; alt: string } & MediaPlacing)
  | ({ type: "video"; src: string; poster: string; width: number; height: number; alt: string } & MediaPlacing)
  /** A YouTube video that loads only when it is pressed: `embed` is the url of its player. */
  | ({ type: "youtube"; embed: string; poster: string; title: string } & MediaPlacing);

export interface ZonePhoto {
  /** The image: big enough to fill the screen when the camera is zoomed into it. */
  src: string;
  /** Width over height: it decides which slot of a page it goes in, and layouts do not wait for images. */
  aspect: number;
  title: string;
  location?: string;
}

export interface Zone extends ZoneInput {
  variant: ZoneVariant;
  accent: string;
  scene: Scene;
}

export interface Item {
  tx: number;
  ty: number;
}

export const Terrain = { Asphalt: 0, Concrete: 1 } as const;

export interface World {
  w: number; // terrain tiles
  h: number;
  terrain: Uint8Array;
  items: Item[]; // loose yard tires
  zones: Zone[];
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
  "uav-obstacle-detection": "BL",
  ftc: "BR",
  gallery: "BM",
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

/** Zones that sit a little off their slot: px to move them east and south. The top-right project is lowered to make room above it for the link slabs. */
const SLOT_SHIFT: Record<string, { dx?: number; dy?: number }> = {
  "temple-allen-internship": { dy: 40 },
};

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
  // a project without a scene of its own is still being built
  return input.variant ?? (input.kind === "link" ? "slab" : input.kind === "about" ? "name" : input.kind === "project" ? "construction" : "building");
}

function layoutZones(inputs: ZoneInput[]): Zone[] {
  const used = new Set<Slot>(inputs.map((i) => ZONE_SLOTS[i.id]).filter(Boolean));
  const spare = SLOT_ORDER.filter((s) => !used.has(s));
  return inputs.map((input, i) => {
    const variant = defaultVariant(input);
    const { w, h } = sceneSize(variant);
    // the name and its slabs have places of their own; everything else sits on the edge ring
    const fixed = FIXED_AT[input.id];
    const slot = fixed ? undefined : (ZONE_SLOTS[input.id] ?? spare.shift() ?? "LM");
    // the Racing garage sits right against the border wall
    const origin = fixed ?? slotOrigin(slot!, w, h, variant === "garage" ? TILE : EDGE_PX);
    const shift = fixed ? undefined : SLOT_SHIFT[input.id];
    const x = origin.x + (shift?.dx ?? 0);
    const y = origin.y + (shift?.dy ?? 0);
    return {
      ...input,
      variant,
      accent: input.accent ?? ZONE_FALLBACK_ACCENTS[i % ZONE_FALLBACK_ACCENTS.length],
      scene: buildScene(input.id, variant, x, y),
    } satisfies Zone;
  });
}

export function generateWorld(inputs: ZoneInput[], seed = 7): World {
  const zones = layoutZones(inputs);
  const w = WORLD_W;
  const h = WORLD_H;
  const rand = rng(seed);
  const terrain = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  const idx = (x: number, y: number) => y * w + x;

  // keep loose tires off the outermost ring so nothing sits right on the edge of the board
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) blocked[idx(x, y)] = 1;
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) blocked[idx(x, y)] = 1;
  }

  // keep loose yard tires out of every project box (plus a one-tile margin)
  for (const zone of zones) {
    const a = zone.scene.area;
    const x0 = Math.max(1, Math.floor(a.x / TILE) - 1);
    const y0 = Math.max(1, Math.floor(a.y / TILE) - 1);
    const x1 = Math.min(w - 2, Math.ceil((a.x + a.w) / TILE) + 1);
    const y1 = Math.min(h - 2, Math.ceil((a.y + a.h) / TILE) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked[idx(x, y)] = 1;
  }

  // a few worn tire piles scattered in the open yard
  const items: Item[] = [];
  for (let n = 0; n < 8; n++) {
    const x0 = 1 + Math.floor(rand() * (w - 2));
    const y0 = 1 + Math.floor(rand() * (h - 2));
    const count = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const tx = x0 + (k % 2);
      const ty = y0 + Math.floor(k / 2);
      if (tx < 1 || ty < 1 || tx >= w - 1 || ty >= h - 1 || blocked[idx(tx, ty)]) continue;
      blocked[idx(tx, ty)] = 1;
      items.push({ tx, ty });
    }
  }

  return { w, h, terrain, items, zones, seed };
}

export function rectContains(r: Rect, x: number, y: number, inset = 0): boolean {
  return x >= r.x + inset && x < r.x + r.w - inset && y >= r.y + inset && y < r.y + r.h - inset;
}
