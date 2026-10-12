// Free-form project areas. Everything here is positioned in world pixels, not tiles.
import { constructionScene } from "./construction";
import { contactScene } from "./contact";
import { photoDeskScene } from "./photodesk";

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
  | { kind: "pad"; x: number; y: number; w: number; h: number; color: string }
  /** A filled polygon on the ground (a desk mat, water, a gravel patch) with an optional border and speckle. */
  | { kind: "pool"; points: { x: number; y: number }[]; fill: string; border?: string; speckle?: string[] };

/** Collision shape, anchored at the prop's bottom-center (x, y). */
export type Footprint = { kind: "rect"; w: number; h: number } | { kind: "circle"; r: number };

export interface Prop {
  sprite: string; // key understood by Sprites.get()
  x: number; // bottom-center, px
  y: number;
  solid?: Footprint;
  /** Height (px) the model is raised off the floor, e.g. a car on a lift. */
  elevation?: number;
  /** Rotation about the vertical axis: the direction (radians, world plane, y = south) the model's front (+x) faces.
   *  When set, x/y is the prop's center instead of its bottom-center, and a rect footprint rotates with it. */
  angle?: number;
  ground?: boolean; // flat on the floor: drawn in the ground layer, never y-sorted
  /** Variation for models that differ from one project to the next (a construction site is seeded by its project id). */
  seed?: number;
  /**
   * What the prop does when the camera zooms into its project: it scales about its own centre and moves by (dx, dz)
   * world px, easing in with the zoom and back out again on the map. `tall` replaces it on portrait screens.
   */
  focus?: PropFocus & { tall?: PropFocus };
}

export interface PropFocus {
  /** Uniform scale at full zoom (default 1). */
  scale?: number;
  /** Per-axis scale along the ground, for flat props such as a mat that has to cover a bigger area (default `scale`). */
  sx?: number;
  sz?: number;
  dx?: number;
  dz?: number;
}

export interface Scene {
  area: Rect; // the project box: hovering it lifts the props; clicking it opens the project
  /** The world rect to frame (and keep sharp) when zoomed in, for props that grow beyond `area`. Defaults to `area`. */
  focusArea?: Rect;
  /** Like `focusArea` but for portrait screens, where the props are laid out stacked rather than side by side. */
  focusAreaTall?: Rect;
  /** How much of the free part of the screen the framed area fills when zoomed in (0..1). Defaults to 0.82. */
  focusFill?: number;
  /**
   * When this project is zoomed into, the whole map (ground, neighbours, everything) scales up by `scale` about the
   * point `about`, so what grows stays in proportion with what is around it. Props then describe their own `focus`
   * relative to that, and `focusArea` is the framing after the map has grown. `tall` is the scale on portrait screens.
   */
  zoom?: { about: { x: number; y: number }; scale: number; tall?: number };
  building: Rect;
  labelAt: { x: number; y: number };
  labelHeight: number; // how high above the ground the HTML label hovers (3D px)
  /** Tallest prop (world units), used when the camera frames the whole box. Defaults to 26. */
  height?: number;
  /** Optional per-scene tuning of the hover effect (defaults live in render3d.ts). */
  hover?: { lift?: number; glow?: number }; // lift is in rendered pixels
  /** Animations default to running all the time; a scene can freeze them while its box is hovered. */
  animation?: { pauseOnHover?: boolean };
  props: Prop[];
  decals: Decal[];
}

export type ZoneVariant = "garage" | "building" | "office" | "photodesk" | "plaques" | "construction";

export const GARAGE_W = 150; // roofed workshop + a 66 px open bay big enough for the formula car
export const GARAGE_H = 56;

const BUILDING = { building: { w: 128, h: 80 }, office: { w: 96, h: 80 } } as const;

/** Area size (px, tile multiples) for a variant. */
export function sceneSize(variant: ZoneVariant): { w: number; h: number } {
  if (variant === "garage") return { w: 224, h: 256 };
  if (variant === "photodesk") return { w: 256, h: 144 };
  if (variant === "plaques") return { w: 128, h: 144 };
  if (variant === "construction") return { w: 160, h: 144 }; // the same footprint as the generic building
  return { w: BUILDING[variant].w + 32, h: 144 };
}

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

/** Carnegie Mellon Racing: garage angled 37 deg south of east, the formula car parked in its open bay, a curved cone track to a finish line. */
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

  const C = at(78, 69); // garage center; its left corner sits against the map edge
  const M = along(C, 75, 0); // mouth of the bay (its open east end)
  const bay = along(C, 42, 0); // center of the bay: the car parks here
  const building = { x: C.x - 77, y: C.y - 68, w: 154, h: 136 }; // bounding box of the rotated garage

  const props: Prop[] = [
    { sprite: "garage", ...C, angle: ANGLE, solid: rect(GARAGE_W, GARAGE_H) },
    // parked inside the bay, nose toward the opening (the garage footprint already blocks the space)
    { sprite: "formula", ...bay, angle: ANGLE, elevation: 1 }, // on the bay floor
    // just outside the mouth: batteries plugged in, crew, a tire stack against the garage's south wall
    { sprite: "battery", ...along(M, 6, -34), angle: ANGLE, solid: rect(8, 5) },
    { sprite: "battery", ...along(M, 18, -34), angle: ANGLE, solid: rect(8, 5) },
    { sprite: "tirestack", ...along(C, -10, 36), solid: circle(4.5) },
    { sprite: "extinguisher", ...along(C, 0, 29.4), elevation: 3 }, // mounted on the wall, on the bay side of the tire stack
    { sprite: "person-r", ...along(M, 14, 42), solid: circle(3) },
    { sprite: "person-w", ...along(M, 10, -50), solid: circle(3) },
    { sprite: "person-b", ...along(M, -8, -46), solid: circle(3) },
    { sprite: "laptop", ...along(M, 24, 36), ground: true },
  ];

  // team dressing around the garage (all positions area-relative, bottom-center anchors)
  props.push(
    { sprite: "pitwall", ...at(114, 208), solid: rect(8, 44) },
    { sprite: "lidar", ...at(204, 44), solid: circle(5) },
    { sprite: "estop", ...at(184, 48), solid: rect(10, 8) },
    { sprite: "cart", ...at(160, 44), solid: rect(18, 12) },
    { sprite: "trailer", ...at(39, 246), solid: rect(58, 28) }, // box truck, no trailer
    { sprite: "tent", ...at(58, 176), solid: rect(28, 28) },
    { sprite: "grill", ...at(26, 176), solid: rect(22, 12) }, // left of the tent
    { sprite: "cook", ...at(14, 176), angle: 0, solid: circle(3.5) },
    { sprite: "sit-r", ...at(42, 190), angle: 0.5, solid: circle(3.5) },
    { sprite: "sit-w", ...at(56, 193), angle: 0.9, solid: circle(3.5) },
    { sprite: "sit-b", ...at(70, 190), angle: 0.3, solid: circle(3.5) },
    { sprite: "tirerack", ...at(92, 176), solid: rect(32, 14) },
    { sprite: "toolchest", ...at(22, 208), solid: rect(18, 12) },
  );

  // slalom: starts right at the bay mouth, straight ahead of the car, then curves south as it weaves.
  // Constant width (28), cones evenly spaced along each boundary: left side blue, right side yellow.
  const half = 18; // half the track width (the formula car is half this wide)
  const GAP = 18; // target spacing between neighbouring cones on a boundary
  const WEAVE = 6; // sideways swing of the centerline (kept gentle so the inside boundary never folds over itself)
  const PERIOD = 110; // length of one weave
  const STEP = 0.5;
  const base: { x: number; y: number; s: number }[] = [];
  let pos = { x: M.x, y: M.y };
  let heading = ANGLE;
  let travelled = 0;
  const advance = (length: number, turn: number) => {
    // turn = total heading change (radians, clockwise on screen) spread evenly over `length`
    for (let d = 0; d < length; d += STEP) {
      base.push({ ...pos, s: travelled });
      heading += (turn * STEP) / length;
      pos = { x: pos.x + Math.cos(heading) * STEP, y: pos.y + Math.sin(heading) * STEP };
      travelled += STEP;
    }
  };
  advance(24, 0); // straight out of the bay
  advance(49, (40 * Math.PI) / 180); // swing toward the south
  advance(48, 0);
  base.push({ ...pos, s: travelled });
  const center = base.map((p, i) => {
    const q = base[Math.min(i + 1, base.length - 1)];
    const o = base[Math.max(i - 1, 0)];
    const len = Math.hypot(q.x - o.x, q.y - o.y) || 1;
    const t = { x: (q.x - o.x) / len, y: (q.y - o.y) / len };
    const ramp = Math.min(1, p.s / 30); // no sideways swing at the start so the first gate lines up with the car
    const w = WEAVE * ramp * Math.sin((2 * Math.PI * p.s) / PERIOD);
    return { x: p.x - t.y * w, y: p.y + t.x * w };
  });

  const offset = (side: number) =>
    center.map((p, i) => {
      const q = center[Math.min(i + 1, center.length - 1)];
      const o = center[Math.max(i - 1, 0)];
      const len = Math.hypot(q.x - o.x, q.y - o.y) || 1;
      const t = { x: (q.x - o.x) / len, y: (q.y - o.y) / len };
      return { x: p.x - t.y * side, y: p.y + t.x * side }; // normal = (-t.y, t.x)
    });
  const evenly = (pts: { x: number; y: number }[], gap: number) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1];
    const n = Math.max(2, Math.round(total / gap) + 1);
    const out: { x: number; y: number }[] = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const target = (total * i) / (n - 1);
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const span = cum[j + 1] - cum[j] || 1;
      const t = (target - cum[j]) / span;
      out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t });
    }
    return out;
  };
  for (const p of evenly(offset(half), GAP)) props.push({ sprite: "cone-b", ...p, solid: circle(3) });
  for (const p of evenly(offset(-half), GAP)) props.push({ sprite: "cone-y", ...p, solid: circle(3) });

  const finish = center[center.length - 1];
  const prev = center[center.length - 3];
  const endT = { x: finish.x - prev.x, y: finish.y - prev.y };
  const endLen = Math.hypot(endT.x, endT.y) || 1;
  const finishAngle = Math.atan2(endT.x / endLen, -endT.y / endLen); // direction across the track
  const decals: Decal[] = [
    { kind: "checker", x: finish.x, y: finish.y, w: 2 * half - 6, h: 8, angle: finishAngle },
    { kind: "cable", points: [along(M, 6, -32), along(M, 2, -26), along(M, -1, -21)] },
  ];

  return {
    area: { x: ox, y: oy, w, h },
    building,
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
  const pad = { x: building.x + b.w / 2, y: building.y + b.h + 16 }; // painted pad in front of the door
  return {
    area: { x: ox, y: oy, w, h },
    building,
    labelAt: { x: building.x + b.w / 2, y: building.y + 6 },
    labelHeight: 40,
    props: [
      { sprite: `bld:${id}`, x: building.x + b.w / 2, y: building.y + b.h, solid: rect(b.w, b.h) },
      { sprite: "cone-o", x: pad.x - 44, y: pad.y + 10, solid: circle(3) },
      { sprite: "cone-o", x: pad.x + 44, y: pad.y + 10, solid: circle(3) },
    ],
    decals: [{ kind: "pad", x: pad.x - 32, y: pad.y - 16, w: 64, h: 32, color: "" }],
  };
}

export function buildScene(id: string, variant: ZoneVariant, ox: number, oy: number): Scene {
  if (variant === "garage") return racingScene(ox, oy);
  if (variant === "photodesk") return photoDeskScene(ox, oy);
  if (variant === "plaques") return contactScene(ox, oy);
  if (variant === "construction") return constructionScene(ox, oy, id);
  return defaultScene(ox, oy, id, variant);
}
