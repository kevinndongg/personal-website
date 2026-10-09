// Free-form project areas. Everything here is positioned in world pixels, not tiles.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Decal =
  | { kind: "checker"; x: number; y: number; w: number; h: number; angle: number } // x,y = center; angle = direction of the width axis
  | { kind: "cable"; points: { x: number; y: number }[] }
  | { kind: "frame"; x: number; y: number; w: number; h: number; angle: number; color: string; fill: string } // painted pit box, x,y = center
  | { kind: "pad"; x: number; y: number; w: number; h: number; color: string };

/** Collision shape, anchored at the prop's bottom-center (x, y). */
export type Footprint = { kind: "rect"; w: number; h: number } | { kind: "circle"; r: number };

export interface Prop {
  sprite: string; // key understood by Sprites.get()
  x: number; // bottom-center, px
  y: number;
  solid?: Footprint;
  /** Rotation about the vertical axis: the direction (radians, world plane, y = south) the model's front (+x) faces.
   *  When set, x/y is the prop's center instead of its bottom-center, and a rect footprint rotates with it. */
  angle?: number;
  ground?: boolean; // flat on the floor: drawn in the ground layer, never y-sorted
}

export interface Scene {
  area: Rect; // clicking anywhere in here drives the car to `stop`
  building: Rect;
  stop: { x: number; y: number }; // where the car parks; the dialogue opens when it gets here
  trigger: Rect;
  labelAt: { x: number; y: number };
  labelHeight: number; // how high above the ground the HTML label hovers (3D px)
  /** Optional per-scene tuning of the hover effect (defaults live in render3d.ts). */
  hover?: { lift?: number; glow?: number }; // lift is in rendered pixels
  props: Prop[];
  decals: Decal[];
}

export type ZoneVariant = "garage" | "building" | "office";

export const GARAGE_W = 120;
export const GARAGE_H = 56;

const BUILDING = { building: { w: 128, h: 80 }, office: { w: 96, h: 80 } } as const;

/** Area size (px, tile multiples) for a variant. */
export function sceneSize(variant: ZoneVariant): { w: number; h: number } {
  if (variant === "garage") return { w: 272, h: 384 };
  return { w: BUILDING[variant].w + 32, h: 144 };
}

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

/** Carnegie Mellon Racing: garage angled 37 deg south of east, formula car on batteries in front of it, snaking cone lane to a finish line. */
function racingScene(ox: number, oy: number): Scene {
  const { w, h } = sceneSize("garage");
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const ANGLE = (37 * Math.PI) / 180;
  const f = { x: Math.cos(ANGLE), y: Math.sin(ANGLE) }; // facing direction (opening side)
  const s = { x: -Math.sin(ANGLE), y: Math.cos(ANGLE) }; // local +z side
  /** Point `a` along the facing direction and `b` along the side, from p. */
  const along = (p: { x: number; y: number }, a: number, b: number) => ({
    x: p.x + f.x * a + s.x * b,
    y: p.y + f.y * a + s.y * b,
  });

  const C = at(66, 62); // garage center; its left corner sits against the map edge
  const F = along(C, 96, 0); // formula car, in front of the bay
  const building = { x: C.x - 65, y: C.y - 59, w: 130, h: 117 }; // bounding box of the rotated garage

  const props: Prop[] = [
    { sprite: "garage", ...C, angle: ANGLE, solid: rect(GARAGE_W, GARAGE_H) },
    { sprite: "formula", ...F, angle: ANGLE, solid: rect(62, 33) },
    { sprite: "battery", ...along(F, -8, -29), angle: ANGLE, solid: rect(8, 5) },
    { sprite: "battery", ...along(F, 6, -29), angle: ANGLE, solid: rect(8, 5) },
    { sprite: "tirestack", ...along(F, -8, 52), solid: circle(4.5) },
    { sprite: "person-r", ...along(F, 2, 35), solid: circle(3) },
    { sprite: "person-w", ...along(F, 44, -4), solid: circle(3) },
    { sprite: "person-b", ...along(F, -12, -42), solid: circle(3) },
    { sprite: "laptop", ...along(F, 14, 46), ground: true },
  ];

  // snaking lane running south: a sine-wave centerline with two cone lines at a constant offset along its normal
  const lane = { x: F.x + 49, y: F.y + 52 };
  const amp = 20;
  const period = 150;
  const length = 186;
  const half = 14;
  const spacing = 22;
  const center = (t: number) => ({ x: lane.x + amp * Math.sin((2 * Math.PI * t) / period), y: lane.y + t });
  const tangent = (t: number) => {
    const dx = ((amp * 2 * Math.PI) / period) * Math.cos((2 * Math.PI * t) / period);
    const len = Math.hypot(dx, 1);
    return { x: dx / len, y: 1 / len };
  };
  let travelled = spacing;
  let prev = center(0);
  let count = 0;
  const PAIRS = 6; // short course: six gates, then the finish line
  for (let t = 0; t <= length && count < PAIRS; t += 0.5) {
    const c = center(t);
    travelled += Math.hypot(c.x - prev.x, c.y - prev.y);
    prev = c;
    if (travelled < spacing) continue;
    travelled = 0;
    const T = tangent(t);
    const N = { x: -T.y, y: T.x };
    const first = count < 3;
    props.push({ sprite: first ? "cone-o" : "cone-b", x: c.x + N.x * half, y: c.y + N.y * half, solid: circle(3) });
    props.push({ sprite: first ? "cone-o" : "cone-y", x: c.x - N.x * half, y: c.y - N.y * half, solid: circle(3) });
    count++;
  }
  // extra cones at the spots Kevin marked: outer corners of the bends
  const extraCones: [string, number, number][] = [
    ["cone-o", 171.3, 172.0],
    ["cone-o", 211.1, 165.0],
    ["cone-b", 167.1, 223.1],
    ["cone-o", 224.8, 220.7],
    ["cone-y", 208.3, 254.2],
  ];
  for (const [sprite, x, y] of extraCones) props.push({ sprite, ...at(x, y), solid: circle(3) });

  const decals: Decal[] = [
    { kind: "frame", ...F, w: 76, h: 44, angle: ANGLE, color: "#c9a526", fill: "#474853" },
    // finish line, placed and angled where Kevin sketched it (area-relative center, 49 deg across the lane)
    { kind: "checker", ...at(172.4, 254.2), w: 52, h: 8, angle: (49.2 * Math.PI) / 180 },
    { kind: "cable", points: [along(F, -8, -26), along(F, -6, -22), along(F, -9, -18)] },
  ];

  const stop = along(F, 6, -60);
  return {
    area: { x: ox, y: oy, w, h },
    building,
    stop,
    trigger: { x: stop.x - 14, y: stop.y - 8, w: 28, h: 16 },
    labelAt: { x: C.x - 6, y: C.y - 30 }, // just above the garage roof
    labelHeight: 26,
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
    labelAt: { x: building.x + b.w / 2, y: building.y + 6 },
    labelHeight: 40,
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
