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

export interface World {
  w: number; // map tiles
  h: number;
  zones: Zone[];
  seed: number;
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
  return { w: WORLD_W, h: WORLD_H, zones: layoutZones(inputs), seed };
}

export function rectContains(r: Rect, x: number, y: number, inset = 0): boolean {
  return x >= r.x + inset && x < r.x + r.w - inset && y >= r.y + inset && y < r.y + r.h - inset;
}
