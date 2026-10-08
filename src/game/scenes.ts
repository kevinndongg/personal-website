// Free-form project areas. Everything here is positioned in world pixels, not tiles.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Decal =
  | { kind: "checker"; x: number; y: number; w: number; h: number }
  | { kind: "cable"; points: { x: number; y: number }[] }
  | { kind: "pad"; x: number; y: number; w: number; h: number; color: string };

/** Collision shape, anchored at the prop's bottom-center (x, y). */
export type Footprint = { kind: "rect"; w: number; h: number } | { kind: "circle"; r: number };

export interface Prop {
  sprite: string; // key understood by Sprites.get()
  x: number; // bottom-center, px
  y: number;
  solid?: Footprint;
  ground?: boolean; // flat on the floor: drawn in the ground layer, never y-sorted
}

export interface Scene {
  area: Rect; // clicking anywhere in here drives the car to `stop`
  building: Rect;
  stop: { x: number; y: number }; // where the car parks; the dialogue opens when it gets here
  trigger: Rect;
  labelAt: { x: number; y: number };
  props: Prop[];
  decals: Decal[];
}

export type ZoneVariant = "garage" | "building" | "office";

export const GARAGE_W = 112;
export const GARAGE_H = 72;

const BUILDING = { building: { w: 128, h: 80 }, office: { w: 96, h: 80 } } as const;

/** Area size (px, tile multiples) for a variant. */
export function sceneSize(variant: ZoneVariant): { w: number; h: number } {
  if (variant === "garage") return { w: 272, h: 272 };
  return { w: BUILDING[variant].w + 32, h: 144 };
}

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

/** Carnegie Mellon Racing: garage on the left edge opening right, formula car on batteries in front of it, snaking cone lane to a finish line. */
function racingScene(ox: number, oy: number): Scene {
  const { w, h } = sceneSize("garage");
  const building = { x: ox, y: oy + 16, w: GARAGE_W, h: GARAGE_H };
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const openingY = 52; // vertical center of the garage opening, area-relative
  const props: Prop[] = [
    { sprite: "garage", x: building.x + building.w / 2, y: building.y + building.h, solid: rect(building.w, building.h) },
    { sprite: "formula", ...at(130, openingY + 6), solid: rect(28, 8) },
    { sprite: "battery", ...at(121, 76), solid: rect(8, 5) },
    { sprite: "battery", ...at(132, 76), solid: rect(8, 5) },
    { sprite: "tirestack", ...at(172, 40), solid: circle(4) },
    { sprite: "person-r", ...at(128, 38), solid: circle(2.5) },
    { sprite: "person-w", ...at(158, 72), solid: circle(2.5) },
    { sprite: "person-b", ...at(146, 92), solid: circle(2.5) },
    { sprite: "laptop", ...at(166, 88), ground: true },
  ];

  // snaking lane: a sine-wave centerline with two cone lines at a constant offset, evenly spaced along the path
  const cx = 150;
  const amp = 22;
  const period = 150;
  const startY = 108;
  const endY = 246;
  const half = 14;
  const spacing = 16;
  const slope = (y: number) => ((amp * 2 * Math.PI) / period) * Math.cos((2 * Math.PI * (y - startY)) / period);
  let travelled = spacing;
  let prev = { x: cx, y: startY };
  let count = 0;
  let last = prev;
  for (let y = startY; y <= endY; y += 0.5) {
    const x = cx + amp * Math.sin((2 * Math.PI * (y - startY)) / period);
    travelled += Math.hypot(x - prev.x, y - prev.y);
    prev = { x, y };
    if (travelled < spacing) continue;
    travelled = 0;
    const d = slope(y);
    const len = Math.hypot(d, 1);
    const nx = 1 / len;
    const ny = -d / len;
    const first = count < 3;
    props.push({ sprite: first ? "cone-o" : "cone-b", ...at(x - nx * half, y - ny * half), solid: circle(3) });
    props.push({ sprite: first ? "cone-o" : "cone-y", ...at(x + nx * half, y + ny * half), solid: circle(3) });
    last = { x, y };
    count++;
  }

  const decals: Decal[] = [
    { kind: "checker", ...at(last.x - 22, last.y + 8), w: 44, h: 8 },
    { kind: "cable", points: [at(121, 72), at(119, 68), at(122, 64), at(121, openingY + 6)] },
  ];

  const stop = at(196, 62);
  return {
    area: { x: ox, y: oy, w, h },
    building,
    stop,
    trigger: { x: stop.x - 14, y: stop.y - 8, w: 28, h: 16 },
    labelAt: { x: building.x + building.w / 2, y: building.y + 2 },
    props,
    decals,
  };
}

/** Placeholder scene for every other zone: one building, a pad in front of the door. */
function defaultScene(ox: number, oy: number, id: string, variant: "building" | "office"): Scene {
  const { w, h } = sceneSize(variant);
  const b = BUILDING[variant];
  const building = { x: ox + 16, y: oy + 8, w: b.w, h: b.h };
  const stop = { x: building.x + b.w / 2, y: building.y + b.h + 16 };
  return {
    area: { x: ox, y: oy, w, h },
    building,
    stop,
    trigger: { x: stop.x - 28, y: stop.y - 12, w: 56, h: 24 },
    labelAt: { x: building.x + b.w / 2, y: building.y + 2 },
    props: [
      { sprite: `bld:${id}`, x: building.x + b.w / 2, y: building.y + b.h, solid: rect(b.w, b.h) },
      { sprite: "cone-o", x: stop.x - 44, y: stop.y + 10, solid: circle(3) },
      { sprite: "cone-o", x: stop.x + 44, y: stop.y + 10, solid: circle(3) },
    ],
    decals: [{ kind: "pad", x: stop.x - 32, y: stop.y - 16, w: 64, h: 32, color: "" }],
  };
}

export function buildScene(id: string, variant: ZoneVariant, ox: number, oy: number): Scene {
  return variant === "garage" ? racingScene(ox, oy) : defaultScene(ox, oy, id, variant);
}
