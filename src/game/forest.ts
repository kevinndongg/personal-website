import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { Material, MeshToonMaterial, Object3D, Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon } from "./models";
import type { Rect } from "./scenes";

/**
 * A preview of the projects living in a forest instead of on a square yard (switched on with `?forest` on the home page;
 * `?forest=grass` for a lawn clearing instead of packed earth). The map's tiles and outlines are gone (see `buildGroundLayer`'s
 * `bare`): this is the floor they stand on, a clearing that follows the projects and is not a rectangle, and what grows round
 * them. Nothing here is part of the map as such, it is scenery in the map's own group, so that it zooms with it.
 *
 * A trail circles the name and branches to every project; another comes in from the front. Wide-crowned trees stand far apart,
 * never where their crown would hide a project, and run on into the dark as silhouettes. A small camp sits by the trail: a
 * fire, a tent, stumps to sit on, a pile of logs, lanterns, a string of lights. The light is late afternoon: soft long shade
 * from the trees, patches of leaf shade near them only, a few shafts of sun.
 */
export type ForestStyle = "yard" | "grass";

/** The forest as the renderer uses it: what to add to the map, a per-frame step (the fire), and a way to let go of it. */
export interface Forest {
  group: Group;
  update(time: number): void;
  /** A grey-scale mask over a square of side `extent` centred on the map: how much leaf shade there is (little in the clearing, full in the woods). */
  canopyMask(extent: number): CanvasTexture;
  dispose(): void;
}

/** What the forest needs to know of a project: where it stands. */
export interface ForestZone {
  kind: string;
  area: Rect;
  /** A road the project brings (the racing car's lap, in map px): the trail to it lands on the road instead of at its edge. */
  route?: { x: number; z: number }[];
}

/** How far past the projects the trees (and the floor texture) reach, in world px. Past it the floor is dark, but not black. */
export const FOREST_REACH = 280;

/** How far past the map the trees and floor go on each axis (the camera shows more sideways on a wide screen, more up and down on a tall one). */
export interface ForestReach {
  x: number;
  z: number;
}
const TAU = Math.PI * 2;
/** The margin of bare ground round a project. */
const CLEARING_MARGIN = 22;

// ------------------------------------------------------------------ small helpers

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

function hash(x: number, y: number, n = 0) {
  let h = (x * 374761393 + y * 668265263 + n * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1, one lattice cell per unit. */
function vnoise(x: number, y: number, n = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, n);
  const b = hash(xi + 1, yi, n);
  const c = hash(xi, yi + 1, n);
  const d = hash(xi + 1, yi + 1, n);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function smooth(x: number, a: number, b: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Signed distance from a point to a rectangle (negative inside it). */
function rectSdf(x: number, z: number, r: Rect) {
  const qx = Math.abs(x - (r.x + r.w / 2)) - r.w / 2;
  const qz = Math.abs(z - (r.y + r.h / 2)) - r.h / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

// ------------------------------------------------------------------ the trails

interface Pt {
  x: number;
  z: number;
}

/** A trail: a line of points and its half-width at the first and at the last (or, with `widths`, at every point). */
interface Trail {
  pts: Pt[];
  w0: number;
  w1: number;
  widths?: number[];
}

/** The trail in from the front of the map to the ring round the name. */
interface PathLayout {
  mapSize: number;
  /** Where it ends: the south side of the ring. */
  hub: Pt;
  /** Where it passes between the projects along the front. */
  gapX: number;
  /** The top of those projects: it has reached `gapX` by here. */
  rowTop: number;
}

/** The entrance's middle `z` px down the map: from the ring, over to the gap in the front row, then wandering off south. */
function pathCenter(p: PathLayout, z: number) {
  const t = smooth(z, p.hub.z, Math.max(p.hub.z + 1, p.rowTop - 30));
  const wander = 20 * Math.sin((z - p.mapSize) / 52) * smooth(z, p.mapSize, p.mapSize + 80);
  return lerp(p.hub.x, p.gapX, t) + wander;
}

/** A curved line from `a` to `b`, bowed sideways by `bend`. */
function curve(a: Pt, b: Pt, bend: number, steps = 10): Pt[] {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const cx = mx + (-(b.z - a.z) / len) * bend;
  const cz = mz + ((b.x - a.x) / len) * bend;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x,
      z: (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * cz + t * t * b.z,
    });
  }
  return pts;
}

/** A rounded, lumpy ring: a squared-off ellipse round `c`, its radius swelling and shrinking with a few slow waves (it must not read as a track). */
function ringPoints(c: Pt, rx: number, rz: number, steps = 72): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    // (the last point meets the first: every wave has a whole number of turns)
    const lump = 1 + 0.05 * Math.sin(2 * a + 0.9) + 0.035 * Math.sin(3 * a + 1.3) + 0.025 * Math.sin(5 * a + 2.1);
    pts.push({
      x: c.x + rx * Math.sign(cs) * Math.sqrt(Math.abs(cs)) * lump * (1 + 0.04 * cs),
      z: c.z + rz * Math.sign(sn) * Math.sqrt(Math.abs(sn)) * lump,
    });
  }
  return pts;
}

/** Where a trail from the name meets a project: the middle of the edge that faces the name, kept off the corners. */
function doorOf(a: Rect, c: Pt): Pt {
  const rx = (c.x - (a.x + a.w / 2)) / (a.w / 2);
  const rz = (c.z - (a.y + a.h / 2)) / (a.h / 2);
  const mx = Math.min(36, a.w / 2 - 1);
  const mz = Math.min(36, a.h / 2 - 1);
  if (Math.abs(rx) > Math.abs(rz)) return { x: rx > 0 ? a.x + a.w : a.x, z: clamp(c.z, a.y + mz, a.y + a.h - mz) };
  return { x: clamp(c.x, a.x + mx, a.x + a.w - mx), z: rz > 0 ? a.y + a.h : a.y };
}

/** The way into the area from a door on its edge: a unit vector. */
function inward(a: Rect, door: Pt): Pt {
  if (door.x <= a.x + 0.5) return { x: 1, z: 0 };
  if (door.x >= a.x + a.w - 0.5) return { x: -1, z: 0 };
  return door.z <= a.y + 0.5 ? { x: 0, z: 1 } : { x: 0, z: -1 };
}

function nearestOn(pts: Pt[], p: Pt): Pt {
  let best = pts[0];
  let bd = Infinity;
  for (const q of pts) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

function distToPoints(pts: Pt[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    d = Math.min(d, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return d;
}

interface Plan {
  path: PathLayout;
  ring: Pt[];
  ringCentre: Pt;
  entrance: Pt[];
  trails: Trail[];
  /** Where the camp can stand, or null if the map has no room for it. */
  camp: Pt | null;
}

/**
 * The trails: a ring round the name, a branch from it to the door of every project, and the way in from the front. (The three
 * link buttons at the top right are not projects and get none.) The camp goes where there is room, as near the ring as it
 * can be; its own branch is added by the caller.
 */
function planTrails(mapSize: number, zones: ForestZone[]): Plan {
  const name = zones.find((z) => z.kind === "about")?.area ?? { x: mapSize / 2 - 100, y: mapSize / 2 - 30, w: 200, h: 60 };
  const c: Pt = { x: name.x + name.w / 2, z: name.y + name.h / 2 };
  const others = zones.filter((z) => z.kind !== "about");

  // the biggest ring that clears every project
  let margin = 52;
  let ring = ringPoints(c, name.w / 2 + margin, name.h / 2 + margin * 0.8);
  for (const m of [52, 44, 38, 32, 26, 20]) {
    margin = m;
    ring = ringPoints(c, name.w / 2 + m, name.h / 2 + m * 0.8);
    if (ring.every((p) => others.every((o) => rectSdf(p.x, p.z, o.area) > 12))) break;
  }
  // (the way in leaves from the ring's south side, wherever the lumps put it)
  const hub: Pt = ring[Math.round((ring.length - 1) * 0.25)];

  // the widest gap between the projects of the front row, where the way in passes through them
  const row = zones.map((z) => z.area).filter((a) => a.y + a.h > mapSize - 110);
  const spans = row.map((a) => [a.x, a.x + a.w] as const).sort((p, q) => p[0] - q[0]);
  let best = { w: 0, c: mapSize / 2 };
  let cursor = 40;
  for (const [s, e] of spans) {
    if (s - cursor > best.w) best = { w: s - cursor, c: (s + cursor) / 2 };
    cursor = Math.max(cursor, e);
  }
  if (mapSize - 40 - cursor > best.w) best = { w: mapSize - 40 - cursor, c: (mapSize - 40 + cursor) / 2 };
  const path: PathLayout = { mapSize, hub, gapX: best.c, rowTop: row.length ? Math.min(...row.map((a) => a.y)) : mapSize - 150 };

  // the way in: one long curve from the ring down to the gap (no sideways shuffle), then on south with a little wander
  const entrance: Pt[] = [];
  const bend = path.rowTop - 10 - hub.z;
  let zNext = hub.z;
  if (bend > 60) {
    const dx = path.gapX - hub.x;
    const spline = new CatmullRomCurve3(
      [
        new Vector3(hub.x, 0, hub.z),
        new Vector3(hub.x + 0.04 * dx, 0, hub.z + 0.22 * bend),
        new Vector3(hub.x + 0.4 * dx, 0, hub.z + 0.55 * bend),
        new Vector3(hub.x + 0.9 * dx, 0, hub.z + 0.88 * bend),
        new Vector3(path.gapX, 0, path.rowTop - 10),
      ],
      false,
      "centripetal"
    );
    for (const p of spline.getSpacedPoints(Math.max(4, Math.round(spline.getLength() / 14)))) entrance.push({ x: p.x, z: p.z });
    zNext = path.rowTop - 10 + 14;
  }
  for (let z = zNext; z <= mapSize + 250; z += 14) entrance.push({ x: pathCenter(path, z), z });

  // the ring swells and thins as it goes
  const ringWidths = ring.map((p) => 3.4 + 2.0 * smooth(vnoise(p.x / 45, p.z / 45, 17), 0.25, 0.75));
  const trails: Trail[] = [
    { pts: ring, w0: 4.4, w1: 4.4, widths: ringWidths },
    { pts: entrance, w0: 6.5, w1: 4.5 },
  ];
  const joins = [...ring, ...entrance];
  others.forEach((o, i) => {
    if (o.kind === "link") return;
    const bend = (hash(i, 3, 5) - 0.5) * 26;
    if (o.route && o.route.length > 3) {
      // a project with a road of its own: the trail runs onto the road (the part the cones stand on), at the point nearest the ring
      const road = o.route.slice(2, Math.ceil(o.route.length * 0.5));
      let door = road[0];
      let best = Infinity;
      for (const p of road) {
        const d = distToPoints(ring, p.x, p.z);
        if (d < best) {
          best = d;
          door = p;
        }
      }
      trails.push({ pts: curve(nearestOn(joins, door), door, bend), w0: 3.4, w1: 2.6 });
      return;
    }
    const door = doorOf(o.area, c);
    // (from the ring or from the way in, whichever is nearer: a fork, not two trails side by side)
    trails.push({ pts: curve(nearestOn(joins, door), door, bend), w0: 3.4, w1: 2.4 });
    // and a short wide stub across the edge, a doorstep
    const inn = inward(o.area, door);
    trails.push({
      pts: [
        { x: door.x - inn.x * 8, z: door.z - inn.z * 8 },
        { x: door.x + inn.x * 6, z: door.z + inn.z * 6 },
      ],
      w0: 6,
      w1: 6,
    });
  });

  // the camp: room to spare round it (a tent, a fire, seats), and the nearest such place to the ring
  let camp: Pt | null = null;
  let bestScore = -Infinity;
  for (const need of [72, 60]) {
    for (let z = mapSize * 0.2; z <= mapSize * 0.85; z += 12) {
      for (let x = 50; x <= mapSize - 50; x += 12) {
        let room = Infinity;
        for (const zone of zones) room = Math.min(room, rectSdf(x, z, zone.area));
        const ringD = distToPoints(ring, x, z);
        if (room < need || ringD < 58 || distToPoints(entrance, x, z) < 58) continue;
        const score = -ringD + (x > c.x ? 8 : 0) + 0.1 * room;
        if (score > bestScore) {
          bestScore = score;
          camp = { x, z };
        }
      }
    }
    if (camp) break;
  }
  return { path, ring, ringCentre: c, entrance, trails, camp };
}

/**
 * How far a point is beyond the edge of the nearest trail (negative on one), 999 where none is near. Drawn once on a grid, each
 * trail only where it reaches, so that the many points the floor and the trees ask about each cost little.
 */
function trailField(mapSize: number, trails: Trail[], pad: number) {
  const step = 2;
  const n = Math.ceil((mapSize + 2 * pad) / step) + 1;
  const grid = new Float32Array(n * n).fill(999);
  for (const tr of trails) {
    const m = tr.pts.length - 1;
    for (let s = 0; s < m; s++) {
      const a = tr.pts[s];
      const b = tr.pts[s + 1];
      const hwA = tr.widths ? tr.widths[s] : lerp(tr.w0, tr.w1, s / m);
      const hwB = tr.widths ? tr.widths[s + 1] : lerp(tr.w0, tr.w1, (s + 1) / m);
      const reach = Math.max(hwA, hwB) + 22;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + pad) / step));
      const i1 = Math.min(n - 1, Math.ceil((Math.max(a.x, b.x) + reach + pad) / step));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + pad) / step));
      const j1 = Math.min(n - 1, Math.ceil((Math.max(a.z, b.z) + reach + pad) / step));
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = i * step - pad;
          const z = j * step - pad;
          const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
          const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - lerp(hwA, hwB, t);
          if (d < grid[j * n + i]) grid[j * n + i] = d;
        }
      }
    }
  }
  return (x: number, z: number) => {
    const fx = clamp((x + pad) / step, 0, n - 1.001);
    const fz = clamp((z + pad) / step, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = grid[j * n + i];
    const b = grid[j * n + i + 1];
    const c = grid[(j + 1) * n + i];
    const d = grid[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// ------------------------------------------------------------------ the clearing

/**
 * How far a point is outside the clearing, in px (negative inside it): the projects' areas with a margin, melted together at
 * their corners, and the camp, with the edge made ragged. The floor texture and the tree placement both read this, so the trees
 * keep to the line the floor draws. The smooth part is worked out once on a coarse grid.
 */
function clearingField(mapSize: number, zones: ForestZone[], camp: Pt, pad: number) {
  const step = 4;
  const n = Math.ceil((mapSize + 2 * pad) / step) + 1;
  const grid = new Float32Array(n * n);
  const K = 22; // how far the corners melt together
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * step - pad;
      const z = j * step - pad;
      let sum = Math.exp(-(Math.hypot(x - camp.x, z - camp.z) - 52) / K);
      for (const zone of zones) sum += Math.exp(-rectSdf(x, z, zone.area) / K);
      grid[j * n + i] = -K * Math.log(sum + 1e-12) - CLEARING_MARGIN;
    }
  }
  return (x: number, z: number) => {
    const fx = clamp((x + pad) / step, 0, n - 1.001);
    const fz = clamp((z + pad) / step, 0, n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = grid[j * n + i];
    const b = grid[j * n + i + 1];
    const c = grid[(j + 1) * n + i];
    const d = grid[(j + 1) * n + i + 1];
    const smoothPart = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    return smoothPart + (vnoise(x / 38, z / 38, 3) - 0.5) * 22 + (vnoise(x / 11, z / 11, 5) - 0.5) * 7;
  };
}

// ------------------------------------------------------------------ the forest floor

type RGB = [number, number, number];
const EARTH: RGB = [0x6c, 0x59, 0x3f];
const PATH: RGB = [0x8a, 0x76, 0x56];
const GRASS: RGB = [0x44, 0x70, 0x3a];
const MOSS: RGB = [0x27, 0x44, 0x2a];
const DEEP: RGB = [0x1b, 0x31, 0x24];
const DARK: RGB = [0x18, 0x2a, 0x20];
const LITTER: RGB = [0x5e, 0x42, 0x28];
const CAMP_DIRT: RGB = [0x5c, 0x4a, 0x34];
const ASH: RGB = [0x2a, 0x22, 0x1c];

function mix(out: RGB, a: RGB, b: RGB, t: number) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** The ground everything stands on, one texture over the map and `FOREST_REACH` past it: earth or lawn, grass, moss, dusk, and the trails. */
function floorTexture(
  mapSize: number,
  camp: Pt,
  field: (x: number, z: number) => number,
  trail: (x: number, z: number) => number,
  style: ForestStyle,
  padX: number,
  padZ: number
): CanvasTexture {
  const w = Math.ceil(mapSize + 2 * padX);
  const h = Math.ceil(mapSize + 2 * padZ);
  const size = w;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const col: RGB = [0, 0, 0];
  const tmp: RGB = [0, 0, 0];
  const pathCol: RGB = [0, 0, 0];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px - padX;
      const z = py - padZ;
      const d = field(x, z);
      const n = vnoise(x / 14, z / 14, 8);
      // grass beyond the clearing, moss under the first trees, then deepening slowly into the dusk
      mix(col, GRASS, MOSS, smooth(d, 10, 70));
      mix(col, col, DEEP, smooth(d, 60, 220));
      mix(col, col, DARK, smooth(d, 200, 360));
      if (style === "yard") {
        // packed earth where the projects stand, worn through the grass; ragged at the edge, with tufts coming through
        const e = 1 - smooth(d + (n - 0.5) * 8, -3, 6);
        mix(tmp, col, EARTH, e * (1 - 0.35 * smooth(vnoise(x / 9, z / 9, 21), 0.62, 0.8)));
        col[0] = tmp[0];
        col[1] = tmp[1];
        col[2] = tmp[2];
      }
      // the trails: packed earth with a lighter worn middle and the odd pebble, fading into the dusk with the rest
      const pg = trail(x, z);
      if (pg < 3) {
        const t = 1 - smooth(pg + (n - 0.5) * 3, -1.5, 1.5);
        if (t > 0) {
          const dim = 1 - 0.8 * smooth(z - mapSize, 70, 225);
          const worn = 1 + 0.1 * smooth(-pg, 2, 5);
          const stone = hash(px, py, 13) < 0.03 ? (hash(px, py, 14) < 0.5 ? 0.78 : 1.2) : 1;
          for (let k = 0; k < 3; k++) pathCol[k] = Math.min(255, PATH[k] * dim * worn * stone);
          mix(col, col, pathCol, t);
        }
      }
      // the campsite: bare earth round the fire, ash in the middle of it
      const cd = Math.hypot(x - camp.x, z - camp.z) + (n - 0.5) * 5;
      if (cd < 22) {
        mix(col, col, CAMP_DIRT, 1 - smooth(cd, 14, 22));
        mix(col, col, ASH, 1 - smooth(cd, 4, 8));
      }
      // soft patches and a grain of single pixels; needles and leaf litter, mostly under the trees
      const patch = 1 + (n - 0.5) * 0.24 + (vnoise(x / 40, z / 40, 2) - 0.5) * 0.14 + (hash(px, py) - 0.5) * 0.07;
      if (d > 10 && pg > 4 && hash(px, py, 7) < 0.025) mix(col, col, LITTER, 0.5);
      const i = (py * size + px) * 4;
      data[i] = Math.min(255, col[0] * patch);
      data[i + 1] = Math.min(255, col[1] * patch);
      data[i + 2] = Math.min(255, col[2] * patch);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  return t;
}

/** A soft round blob as a texture: `stops` are [position 0..1, css color]. */
function radialTexture(stops: [number, string][]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** A shaft of sun: soft at both sides, fading in and out along its length. */
function shaftTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const across = ctx.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 32, 128);
  ctx.globalCompositeOperation = "destination-in";
  const along = ctx.createLinearGradient(0, 0, 0, 128);
  along.addColorStop(0, "rgba(255,255,255,0)");
  along.addColorStop(0.3, "rgba(255,255,255,1)");
  along.addColorStop(0.7, "rgba(255,255,255,1)");
  along.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 32, 128);
  return new CanvasTexture(c);
}

// ------------------------------------------------------------------ geometry

/** Gives a geometry one flat color per vertex (merged shapes keep their own colors this way), non-indexed so they merge. */
function painted(geo: BufferGeometry, hex: string): BufferGeometry {
  return paintedBy(geo, hex, hex, () => false);
}

/** Like `painted`, with the vertices `isCap` picks (by their normal) in `cap` and the rest in `side`: a stump's cut top, a log's ends. */
function paintedBy(geo: BufferGeometry, side: string, cap: string, isCap: (nx: number, ny: number, nz: number) => boolean) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const a = new Color(side);
  const b = new Color(cap);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const rgb = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = isCap(nor.getX(i), nor.getY(i), nor.getZ(i)) ? b : a;
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return g;
}

function moved(geo: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  return geo.translate(x, y, z);
}

function blob(r: number, x: number, y: number, z: number, hex: string) {
  return painted(moved(new IcosahedronGeometry(r, 1), x, y, z), hex);
}

/** A conifer about 48 high and 26 across: a trunk and three stacked skirts, darker at the bottom. Scaled per tree. */
function pineGeometry(): BufferGeometry {
  const skirt = (r: number, h: number, base: number, hex: string) =>
    painted(moved(new ConeGeometry(r, h, 8, 1, true), 0, base + h / 2, 0), hex);
  return mergeGeometries([
    painted(moved(new CylinderGeometry(1.5, 2.3, 10, 6), 0, 5, 0), "#4a3323"),
    skirt(13, 18, 6, "#1f4a2b"),
    skirt(10.5, 16, 15, "#265533"),
    skirt(7.5, 14, 24, "#2f6439"),
  ])!;
}

/** A broadleaf about 52 high and 54 across: a thick trunk and a wide, lumpy crown of eight blobs, in `c` (bottom to top). */
function broadGeometry(c: [string, string, string, string, string, string, string, string]): BufferGeometry {
  return mergeGeometries([
    painted(moved(new CylinderGeometry(2.6, 4, 22, 7), 0, 11, 0), "#4d3622"),
    blob(14, 0, 34, 0, c[0]),
    blob(12, 15, 29, 4, c[1]),
    blob(12, -14, 30, -5, c[2]),
    blob(11, 4, 29, 15, c[3]),
    blob(11, -5, 31, -14, c[4]),
    blob(10, 0, 43, 0, c[5]),
    blob(8, 17, 36, -8, c[6]),
    blob(8, -17, 35, 9, c[7]),
  ])!;
}

const GREEN_CROWN: Parameters<typeof broadGeometry>[0] = ["#2f6a2c", "#2a5f28", "#27582a", "#2d6429", "#2a5f28", "#3d7c34", "#35722f", "#306b2c"];
const AUTUMN_CROWN: Parameters<typeof broadGeometry>[0] = ["#c9861c", "#b86d1a", "#d6a22a", "#bb6a1c", "#c27a1e", "#e2b836", "#cf8f22", "#b9731d"];
/** The one tree that is on fire with the season: red-orange below, gold on top. */
const HERO_CROWN: Parameters<typeof broadGeometry>[0] = ["#c4561a", "#b8481a", "#d9731f", "#c25a1b", "#cf6a1e", "#f0c040", "#e58f24", "#d97a20"];

/** A taller, rounder crown about 52 high and 30 across: four blobs, stacked. */
function roundGeometry(): BufferGeometry {
  return mergeGeometries([
    painted(moved(new CylinderGeometry(2.2, 3.4, 20, 7), 0, 10, 0), "#4d3622"),
    blob(12, 0, 30, 0, "#2c6429"),
    blob(10, 0, 42, 0.5, "#38753a"),
    blob(9, 6, 24, 4, "#27582a"),
    blob(9, -6, 25, -4, "#2a5f28"),
  ])!;
}

function bushGeometry(): BufferGeometry {
  return mergeGeometries([blob(5.5, 0, 4, 0, "#2a5f2b"), blob(4.2, 5, 3, 2, "#235327"), blob(4, -4, 3, -2, "#326b30")])!;
}

/** A few blades of tall grass, for the edges of the trails. */
function tuftGeometry(): BufferGeometry {
  const blade = (x: number, z: number, h: number, tilt: number, hex: string) => {
    const g = new ConeGeometry(0.9, h, 4);
    g.rotateZ(tilt);
    return painted(moved(g, x, h / 2, z), hex);
  };
  return mergeGeometries([
    blade(0, 0, 7, 0.1, "#4f8a3c"),
    blade(1.6, 0.6, 5.5, -0.25, "#447a35"),
    blade(-1.5, 0.4, 6, 0.3, "#5a9444"),
    blade(0.3, -1.4, 4.5, 0.05, "#3f7232"),
  ])!;
}

function rockGeometry(): BufferGeometry {
  return painted(moved(new DodecahedronGeometry(4.5, 0), 0, 2.5, 0), "#7d8079");
}

/** A log lying along x, its ends cut pale. */
function logGeometry(): BufferGeometry {
  const g = new CylinderGeometry(2.3, 2.3, 18, 7);
  g.rotateZ(Math.PI / 2);
  return paintedBy(moved(g, 0, 2.3, 0), "#5e4028", "#c9a074", (nx) => Math.abs(nx) > 0.7);
}

/** A stump to sit on, its top cut pale. */
function stumpGeometry(): BufferGeometry {
  return paintedBy(moved(new CylinderGeometry(4.6, 5.4, 5.5, 8), 0, 2.75, 0), "#5e4028", "#c9a074", (_x, ny) => ny > 0.7);
}

function poleGeometry(r: number, h: number): BufferGeometry {
  return painted(moved(new CylinderGeometry(r * 0.8, r, h, 6), 0, h / 2, 0), "#5a3f28");
}

/** An A-frame tent about 24 long, its ridge along x and its door at the west end (toward the fire). */
function tentGeometry(): BufferGeometry {
  const w = 9;
  const h = 10;
  const len = 24;
  const roof = new Shape();
  roof.moveTo(-w, 0);
  roof.lineTo(w, 0);
  roof.lineTo(0, h);
  roof.closePath();
  const body = new ExtrudeGeometry(roof, { depth: len, bevelEnabled: false });
  body.translate(0, 0, -len / 2);
  body.rotateY(Math.PI / 2); // (ridge along x)
  const door = new Shape();
  door.moveTo(-3.2, 0);
  door.lineTo(3.2, 0);
  door.lineTo(0, 7.2);
  door.closePath();
  const flap = new ShapeGeometry(door);
  flap.rotateY(-Math.PI / 2); // (facing west)
  flap.translate(-len / 2 - 0.15, 0, 0);
  // (the two roof slopes face different ways: one catches the light, the other is in shade; the ends in between)
  const canvas = painted(body, "#a08857");
  const nor = canvas.attributes.normal;
  const rgb = canvas.attributes.color;
  const lit = new Color("#c9b27c");
  const shade = new Color("#7d6a42");
  for (let i = 0; i < rgb.count; i++) {
    const nz = nor.getZ(i);
    const c = nz > 0.3 ? lit : nz < -0.3 ? shade : null;
    if (c) rgb.setXYZ(i, c.r, c.g, c.b);
  }
  return mergeGeometries([canvas, painted(flap, "#241b13")])!;
}

function foliageMaterial(): MeshToonMaterial {
  const m = toon("#ffffff").clone();
  m.vertexColors = true;
  return m;
}

interface Placed {
  x: number;
  z: number;
  /** Height above the ground (a log in a pile). */
  y?: number;
  /** How far its crown reaches, and how high it is (a tree), for the shade it casts. */
  r?: number;
  h?: number;
  yaw: number;
  sx: number;
  sy: number;
  tint: Color;
}

const up = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);

function instances(geo: BufferGeometry, mat: Material, list: Placed[]): InstancedMesh | null {
  if (!list.length) return null;
  const mesh = new InstancedMesh(geo, mat, list.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    m.compose(pos.set(p.x, p.y ?? 0, p.z), q, scale.set(p.sx, p.sy, p.sx));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, p.tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // (the ring is wider than anything on screen: there is nothing to cull it against)
  return mesh;
}

/** Flat round things lying on the ground (a soft shadow, a pool of light): one per spot, `r` the radius, `stretch` along `yaw`. */
function disks(mat: Material, spots: { x: number; y: number; z: number; r: number; stretch?: number; yaw?: number }[]): InstancedMesh | null {
  if (!spots.length) return null;
  const mesh = new InstancedMesh(new PlaneGeometry(2, 2), mat, spots.length);
  const m = new Matrix4();
  const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const q = new Quaternion();
  spots.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw ?? 0).multiply(flat);
    m.compose(new Vector3(s.x, s.y, s.z), q, new Vector3(s.r * (s.stretch ?? 1), s.r, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ the forest

/**
 * The forest: a floor, trails, wide-crowned trees far apart, and the cosy things at the clearing's edge.
 *
 * The camera looks over the front of the map from above, so a tree hides the ground north of it: a crown at height h covers
 * the ground `0.625 h` further north, and a building stands up 28 px or so of ground-equivalent besides. A tree is only put where
 * that patch (see `hides`) misses every project, and shrunk until it does, so the ones near the projects are small and the big
 * ones stand further out, behind and beside. Trees cast no real shadow (the sun's shadow map is fitted to the map), so each gets
 * a soft dark patch on the ground, stretched away from the sun and shorter than a true shadow, which would blanket the projects.
 *
 * `toSun` is the unit vector from the map to the sun (for the shafts of light).
 */
export function buildForest(
  mapSize: number,
  style: ForestStyle,
  zones: ForestZone[],
  toSun: Vector3,
  reach: ForestReach = { x: FOREST_REACH, z: FOREST_REACH },
  seed = 11
): Forest {
  const rand = rng(seed);
  const padX = reach.x + 4;
  const padZ = reach.z + 4;
  const group = new Group();
  group.name = "forest";
  const areas = zones.map((z) => z.area);

  const plan = planTrails(mapSize, zones);
  // (no room inside the map: the camp goes just outside it, on the east side)
  const camp: Pt = plan.camp ?? { x: mapSize + 70, z: mapSize * 0.5 };
  const trails = [...plan.trails];
  // a branch from the ring to the camp, ending at its edge
  {
    const from = nearestOn(plan.ring, camp);
    const len = Math.hypot(camp.x - from.x, camp.z - from.z) || 1;
    const stop = { x: camp.x + ((from.x - camp.x) / len) * 18, z: camp.z + ((from.z - camp.z) / len) * 18 };
    trails.push({ pts: curve(from, stop, 14), w0: 3.4, w1: 2.8 });
  }
  const trail = trailField(mapSize, trails, Math.max(padX, padZ));
  const field = clearingField(mapSize, zones, camp, Math.max(padX, padZ));

  // the floor under it all, and a dark plane past its end for wider screens still
  const totalX = mapSize + 2 * padX;
  const totalZ = mapSize + 2 * padZ;
  const total = Math.max(totalX, totalZ);
  const floor = new Mesh(
    new PlaneGeometry(totalX, totalZ),
    new MeshBasicMaterial({ map: floorTexture(mapSize, camp, field, trail, style, padX, padZ) })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(mapSize / 2, -0.4, mapSize / 2);
  floor.renderOrder = -3;
  const beyond = new Mesh(new PlaneGeometry(total * 8, total * 8), new MeshBasicMaterial({ color: new Color(DARK[0] / 255, DARK[1] / 255, DARK[2] / 255) }));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.set(mapSize / 2, -0.5, mapSize / 2);
  beyond.renderOrder = -4;
  group.add(beyond, floor);

  const pines: Placed[] = [];
  const broads: Placed[] = [];
  const autumns: Placed[] = [];
  const rounds: Placed[] = [];
  const heroes: Placed[] = [];
  const bushes: Placed[] = [];
  const tufts: Placed[] = [];
  const rocks: Placed[] = [];
  const logs: Placed[] = [];
  const stumps: Placed[] = [];
  const campDist = (x: number, z: number) => Math.hypot(x - camp.x, z - camp.z);

  /** Would a tree here, with a crown `r` wide and `h` high, hide any project (or hang over one)? */
  const hides = (x: number, z: number, r: number, h: number) =>
    areas.some((a) => x + r > a.x - 6 && x - r < a.x + a.w + 6 && z + 0.6 * r + 28 > a.y - 6 && z - (0.625 * h + 0.5 * r) < a.y + a.h + 6);

  /** Plants a tree of about size `grow` here (`d` from the clearing), or a smaller one if that would hide a project, or none. */
  const plant = (x: number, z: number, d: number, grow: number, r2: number, r3: number, r4: number, r5: number) => {
    const pine = vnoise(x / 90, z / 90, 4) + (r4 - 0.5) * 0.5 > 0.62;
    const kind = pine ? "pine" : r5 < 0.13 ? "autumn" : r5 < 0.4 ? "round" : "broad";
    const l = 0.85 + r3 * 0.3;
    // far trees are darker and bluer, as if seen through the dusk
    const haze = smooth(d, 80, 330);
    const k = l * lerp(1, 0.6, haze);
    const tint = kind === "autumn" ? new Color(k, k, k) : new Color(k * (pine ? 0.92 : 0.95), k, k * lerp(pine ? 1.04 : 0.95, 1.15, haze));
    const baseR = kind === "pine" ? 13 : kind === "round" ? 16 : 26;
    const baseH = kind === "pine" ? 48 : 52;
    for (const f of [1, 0.8, 0.62, 0.5]) {
      const g = grow * f;
      const r = baseR * g;
      const h = baseH * g;
      if (hides(x, z, r, h)) continue;
      // (a pine is stretched up and a broadleaf spreads: wide crowns are the point)
      const tree: Placed =
        kind === "pine"
          ? { x, z, r, h, yaw: r2 * TAU, sx: g * 0.95, sy: g * 1.25, tint }
          : { x, z, r, h, yaw: r2 * TAU, sx: g * (0.92 + r5 * 0.16), sy: g * (0.9 + r3 * 0.2), tint };
      (kind === "pine" ? pines : kind === "autumn" ? autumns : kind === "round" ? rounds : broads).push(tree);
      return;
    }
  };

  // the big trees near the clearing: a jittered grid with wide cells, thinned into the groves' gaps
  const CELL = 110;
  for (let gz = -FOREST_REACH; gz < mapSize + FOREST_REACH; gz += CELL) {
    for (let gx = -FOREST_REACH; gx < mapSize + FOREST_REACH; gx += CELL) {
      // (every random number is drawn whether or not the spot is used, so the same forest comes back each time)
      const jx = rand();
      const jz = rand();
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      const r4 = rand();
      const r5 = rand();
      const x = gx + (jx - 0.5) * CELL * 0.75;
      const z = gz + (jz - 0.5) * CELL * 0.75;
      const d = field(x, z);
      if (d < 14 || d > 110) continue;
      const keep = lerp(0.6, 0.9, smooth(d, 30, 80)) * (0.75 + 0.5 * vnoise(x / 120, z / 120, 9));
      if (r1 > keep) continue;
      if (trail(x, z) < 16 || campDist(x, z) < 70) continue;
      // lower at the clearing's edge, taller (well past a building) further out
      plant(x, z, d, lerp(1.1, 2.2, smooth(d, 20, 110)) * (0.85 + r2 * 0.3), r2, r3, r4, r5);
    }
  }
  // and further out, closer together and bigger, running off the edge of the screen and into the dark
  const FAR = 58;
  for (let gz = -reach.z; gz < mapSize + reach.z; gz += FAR) {
    for (let gx = -reach.x; gx < mapSize + reach.x; gx += FAR) {
      const jx = rand();
      const jz = rand();
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      const r4 = rand();
      const r5 = rand();
      const x = gx + (jx - 0.5) * FAR * 0.8;
      const z = gz + (jz - 0.5) * FAR * 0.8;
      const d = field(x, z);
      if (d < 110) continue;
      // (nearly every spot takes a tree out here: the outskirts are a wall, with only the odd gap. Right at the end of the reach
      // they thin out, so that a screen wider than expected fades into the dark floor instead of ending at a hard line)
      const edge = Math.min(x + reach.x, mapSize + reach.x - x, z + reach.z, mapSize + reach.z - z);
      if (r1 > 0.93 * (0.9 + 0.2 * vnoise(x / 100, z / 100, 12)) * smooth(edge, 0, 110)) continue;
      plant(x, z, d, lerp(2.0, 3.4, smooth(d, 110, 230)) * (0.85 + r2 * 0.3), r2, r3, r4, r5);
    }
  }

  // the hero: one tree on fire with the season, as near the name as there is room, in the pocket to the left of it
  {
    const target = { x: plan.ringCentre.x - 250, z: plan.ringCentre.z + 70 };
    const g = 2.4;
    const all = [...pines, ...broads, ...autumns, ...rounds];
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let z = 230; z <= mapSize - 120; z += 20) {
      for (let x = 40; x <= mapSize - 40; x += 20) {
        const dist = Math.hypot(x - target.x, z - target.z);
        if (dist >= bestD) continue;
        if (hides(x, z, 26 * g, 52 * g) || trail(x, z) < 34 || campDist(x, z) < 90 || field(x, z) < 40) continue;
        if (all.some((t) => Math.hypot(t.x - x, t.z - z) < (t.r ?? 20) + 26 * g * 0.7)) continue;
        best = { x, z };
        bestD = dist;
      }
    }
    if (best) heroes.push({ x: best.x, z: best.z, r: 26 * g, h: 52 * g, yaw: 0.7, sx: g, sy: g, tint: WHITE });
  }

  // how close a point is to a big tree, in crown radii
  const bigTrees = [...pines, ...broads, ...autumns, ...rounds, ...heroes];
  const nearTree = (x: number, z: number) => {
    let m = 9;
    for (const t of bigTrees) m = Math.min(m, Math.hypot(x - t.x, z - t.z) / (t.r ?? 20));
    return m;
  };

  // undergrowth gathers under the trees and along the trails; the lawn round each project stays clean
  const SMALL = 14;
  for (let gz = -90; gz < mapSize + 90; gz += SMALL) {
    for (let gx = -90; gx < mapSize + 90; gx += SMALL) {
      const jx = rand();
      const jz = rand();
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      const r4 = rand();
      const r5 = rand();
      const x = gx + (jx - 0.5) * SMALL;
      const z = gz + (jz - 0.5) * SMALL;
      const d = field(x, z);
      if (d < 8 || d > 110) continue;
      const pg = trail(x, z);
      if (pg < 2 || campDist(x, z) < 44) continue;
      const clump = vnoise(x / 30, z / 30, 6);
      const l = 0.85 + r3 * 0.3;
      const under = nearTree(x, z) < 1.3;
      const pBush = 0.012 + (under ? 0.3 * smooth(clump, 0.35, 0.75) : 0);
      if (pg < 11 && r1 < 0.5 * smooth(clump, 0.25, 0.65)) {
        // tall grass along the trail's edge
        const s = 0.8 + r2 * 0.6;
        tufts.push({ x, z, yaw: r3 * TAU, sx: s, sy: s, tint: new Color(l, l, l) });
      } else if (r1 < pBush) {
        const s = 0.9 + r2 * 0.8;
        bushes.push({ x, z, yaw: r3 * TAU, sx: s, sy: s * 0.9, tint: new Color(l, l * 1.02, l * 0.92) });
      } else if (r1 > 0.85 && r1 < 0.865 && d > 34 && nearTree(x, z) < 2.2) {
        // a young tree in the shelter of a big one
        plant(x, z, d, Math.min(0.9, Math.max(0.4, d / 40)) * (0.8 + r2 * 0.4), r2, r3, r4, r5);
      } else if (r1 > 0.955 && r1 < 0.962 && d > 14) {
        const s = 0.9 + r2 * 0.4;
        stumps.push({ x, z, yaw: r3 * TAU, sx: s, sy: s, tint: new Color(l, l, l) });
      } else if (r1 > 0.972 && r1 < 0.982 && d > 24) {
        logs.push({ x, z, yaw: r3 * TAU, sx: 0.8 + r2 * 0.5, sy: 0.8 + r2 * 0.5, tint: new Color(l, l, l) });
      } else if (r1 > 0.99) {
        const s = 0.7 + r2 * 1.0;
        rocks.push({ x, z, yaw: r3 * TAU, sx: s, sy: s * 0.7, tint: new Color(l, l, l * 1.02) });
      }
    }
  }

  // ---- the camp: a fire in a ring of stones, crossed logs, stumps to sit on, a tent behind, a pile of logs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    rocks.push({ x: camp.x + Math.cos(a) * 8, z: camp.z + Math.sin(a) * 8, yaw: a, sx: 0.55, sy: 0.45, tint: WHITE });
  }
  for (let i = 0; i < 3; i++) logs.push({ x: camp.x, z: camp.z, y: 1.3, yaw: (i * Math.PI) / 3 + 0.3, sx: 0.6, sy: 0.6, tint: WHITE });
  for (const a of [Math.PI, Math.PI * 0.55, Math.PI * 1.45]) {
    stumps.push({ x: camp.x + Math.cos(a) * 21, z: camp.z + Math.sin(a) * 21, yaw: a, sx: 1.5, sy: 1.5, tint: WHITE });
  }
  const tent: Placed = { x: camp.x + 34, z: camp.z - 2, yaw: 0, sx: 1.45, sy: 1.45, tint: WHITE };
  // three-two-one, resting on each other
  const pile = { x: camp.x + 34, z: camp.z + 28 };
  [-5.8, 0, 5.8].forEach((dz) => logs.push({ x: pile.x, z: pile.z + dz, yaw: 0, sx: 1.2, sy: 1.2, tint: WHITE }));
  [-2.9, 2.9].forEach((dz) => logs.push({ x: pile.x, z: pile.z + dz, y: 4.9, yaw: 0, sx: 1.2, sy: 1.2, tint: WHITE }));
  logs.push({ x: pile.x, z: pile.z, y: 9.8, yaw: 0, sx: 1.2, sy: 1.2, tint: WHITE });

  // ---- lights: posts with a lantern along the way in, by the tent and at the ring; a string of bulbs over the way in
  const posts: Pt[] = [];
  [14, 48, 82].forEach((dz, i) => {
    const z = mapSize + dz;
    posts.push({ x: pathCenter(plan.path, z) + (i % 2 ? 1 : -1) * 15, z });
  });
  posts.push({ x: camp.x + 8, z: camp.z - 24 });
  for (const t of [Math.PI * 0.2, Math.PI * 0.8]) {
    // (just outside the ring, on its south side)
    const p = plan.ring[Math.round((t / TAU) * (plan.ring.length - 1))];
    const away = Math.hypot(p.x - plan.ringCentre.x, p.z - plan.ringCentre.z) || 1;
    posts.push({ x: p.x + ((p.x - plan.ringCentre.x) / away) * 10, z: p.z + ((p.z - plan.ringCentre.z) / away) * 10 });
  }
  const POST_H = 15;
  const poles: Placed[] = posts.map((p) => ({ x: p.x, z: p.z, yaw: 0, sx: 1, sy: 1, tint: WHITE }));
  const STRING_Z = mapSize + 30;
  const stringMid = pathCenter(plan.path, STRING_Z);
  const stringA = new Vector3(stringMid - 32, 44, STRING_Z);
  const stringB = new Vector3(stringMid + 32, 44, STRING_Z);
  const tallPoles: Placed[] = [stringA, stringB].map((p) => ({ x: p.x, z: p.z, yaw: 0, sx: 1, sy: 1, tint: WHITE }));
  const bulbSpots: Vector3[] = [];
  const wire: Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    wire.push(new Vector3(lerp(stringA.x, stringB.x, t), 44 - 4 * 8 * t * (1 - t), STRING_Z));
  }
  for (let i = 1; i < 24; i += 2) bulbSpots.push(wire[i].clone().setY(wire[i].y - 1));

  // ---- build the meshes
  const treeMat = foliageMaterial();
  for (const mesh of [
    instances(pineGeometry(), treeMat, pines),
    instances(broadGeometry(GREEN_CROWN), treeMat, broads),
    instances(broadGeometry(AUTUMN_CROWN), treeMat, autumns),
    instances(roundGeometry(), treeMat, rounds),
    instances(broadGeometry(HERO_CROWN), treeMat, heroes),
    instances(bushGeometry(), treeMat, bushes),
    instances(tuftGeometry(), treeMat, tufts),
    instances(rockGeometry(), treeMat, rocks),
    instances(logGeometry(), treeMat, logs),
    instances(stumpGeometry(), treeMat, stumps),
    instances(tentGeometry(), treeMat, [tent]),
    instances(poleGeometry(0.9, POST_H), treeMat, poles),
    instances(poleGeometry(1.7, 46), treeMat, tallPoles),
  ]) {
    if (mesh) group.add(mesh);
  }

  // Soft shade under and beyond each tree, cast away from the sun (the sun is front-left, so toward the back-right). A true
  // shadow at this sun would be about twice the tree's height and cover the projects; this is a little under one height.
  const shadeMat = new MeshBasicMaterial({
    map: radialTexture([
      [0, "rgba(0,10,5,0.58)"],
      [0.55, "rgba(0,10,5,0.36)"],
      [1, "rgba(0,10,5,0)"],
    ]),
    transparent: true,
    depthWrite: false,
  });
  // (away from the real sun, so it moves with it; a true shadow is `h / tan(elevation)` long, and the far trees, where no project
  // is in the way, get most of that: a wall of trees in the dusk all throw their shade the same way, or they look pasted on)
  const away = Math.hypot(toSun.x, toSun.z) || 1;
  const SHADE_X = -toSun.x / away;
  const SHADE_Z = -toSun.z / away;
  const SHADE_YAW = Math.atan2(-SHADE_Z, SHADE_X);
  const trueLen = away / Math.max(0.2, toSun.y);
  const shade = disks(
    shadeMat,
    [...pines, ...broads, ...autumns, ...rounds, ...heroes].map((t) => {
      const r = t.r ?? 20;
      const len = lerp(0.8, Math.min(1.7, 0.8 * trueLen), smooth(field(t.x, t.z), 30, 130)) * (t.h ?? 50);
      const along = 0.42 * len + 0.1 * r; // (where the middle of the patch is)
      const short = 0.8 * r;
      return { x: t.x + SHADE_X * along, y: -0.3, z: t.z + SHADE_Z * along, r: short, stretch: (0.5 * len + 0.7 * r) / short, yaw: SHADE_YAW };
    })
  );
  if (shade) {
    shade.renderOrder = -2;
    group.add(shade);
  }

  // glowing things are drawn unlit, in one warm color
  const glowMap = radialTexture([
    [0, "rgba(255,214,140,1)"],
    [0.35, "rgba(255,170,70,0.45)"],
    [1, "rgba(255,140,40,0)"],
  ]);
  const bulbMat = new MeshBasicMaterial({ color: "#ffe7ae" });
  const lanterns = new InstancedMesh(new BoxGeometry(3.4, 4.6, 3.4), bulbMat, posts.length);
  posts.forEach((p, i) => lanterns.setMatrixAt(i, new Matrix4().setPosition(p.x, POST_H + 2.3, p.z)));
  const bulbs = new InstancedMesh(new IcosahedronGeometry(1.2, 0), bulbMat, bulbSpots.length);
  bulbSpots.forEach((p, i) => bulbs.setMatrixAt(i, new Matrix4().setPosition(p)));
  lanterns.frustumCulled = bulbs.frustumCulled = false;
  group.add(lanterns, bulbs);

  const wireLine = new Line(new BufferGeometry().setFromPoints(wire), new LineBasicMaterial({ color: "#2b2118" }));
  group.add(wireLine);

  const glowMat = new SpriteMaterial({ map: glowMap, color: "#ffc271", opacity: 0.55, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const addGlow = (p: Vector3, size: number, mat: SpriteMaterial = glowMat) => {
    const s = new Sprite(mat);
    s.position.copy(p);
    s.scale.set(size, size, 1);
    s.renderOrder = 5;
    group.add(s);
    return s;
  };
  for (const p of posts) addGlow(new Vector3(p.x, POST_H + 2.5, p.z), 30);
  bulbSpots.forEach((p, i) => {
    if (i % 3 === 0) addGlow(p, 14);
  });

  // pools of warm light on the ground
  const poolMat = new MeshBasicMaterial({ map: glowMap, color: "#ffb560", opacity: 0.55, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const pools = disks(poolMat, [
    ...posts.map((p) => ({ x: p.x, y: 0.2, z: p.z, r: 18 })),
    { x: stringMid, y: 0.2, z: STRING_Z, r: 26, stretch: 1.4 },
  ]);
  if (pools) {
    pools.renderOrder = 4;
    group.add(pools);
  }

  // the fire: three flames that lick up and down, a glow round it and a pool of light on the ground
  const flameMats = ["#ff8a1c", "#ffb62e", "#fff0a0"].map((c) => new MeshBasicMaterial({ color: c }));
  const flames = [
    new Mesh(new ConeGeometry(2.8, 9, 6), flameMats[0]),
    new Mesh(new ConeGeometry(1.9, 12, 6), flameMats[1]),
    new Mesh(new ConeGeometry(1.1, 7, 6), flameMats[2]),
  ];
  const flameH = [9, 12, 7];
  flames.forEach((f, i) => {
    f.position.set(camp.x + (i - 1) * 0.8, 1.3 + flameH[i] / 2, camp.z + (i === 1 ? -0.5 : 0.6));
    group.add(f);
  });
  const fireMat = new SpriteMaterial({ map: glowMap, color: "#ffb04a", opacity: 0.8, transparent: true, blending: AdditiveBlending, depthWrite: false });
  addGlow(new Vector3(camp.x, 7, camp.z), 56, fireMat);
  const firePoolMat = new MeshBasicMaterial({ map: glowMap, color: "#ff9a40", opacity: 0.65, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const firePool = disks(firePoolMat, [{ x: camp.x, y: 0.25, z: camp.z, r: 38 }]);
  if (firePool) {
    firePool.renderOrder = 4;
    group.add(firePool);
  }

  // shafts of low sun through gaps in the canopy: along the way the light travels, standing on the trail near the name, at the
  // camp, and at the way in
  const shaftMats: MeshBasicMaterial[] = [];
  {
    const map = shaftTexture();
    const ringAt = (f: number) => plan.ring[Math.round(f * (plan.ring.length - 1))];
    const feet: Pt[] = [ringAt(0.5), ringAt(0.14), ringAt(0.82), camp, { x: pathCenter(plan.path, mapSize + 6), z: mapSize + 6 }];
    const along = toSun.clone().normalize();
    const side = new Vector3().crossVectors(up, along).normalize();
    const normal = new Vector3().crossVectors(side, along).normalize();
    const basis = new Matrix4().makeBasis(side, along, normal);
    const length = 150;
    const geo = new PlaneGeometry(26, length);
    feet.forEach((p, i) => {
      const mat = new MeshBasicMaterial({ map, color: "#ffd9a0", opacity: 0.14, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      shaftMats.push(mat);
      const m = new Mesh(geo, mat);
      m.matrixAutoUpdate = false;
      m.matrix.copy(basis).setPosition(p.x + (along.x * length) / 2, (along.y * length) / 2, p.z + (along.z * length) / 2);
      m.renderOrder = 3;
      m.userData.shaft = i;
      group.add(m);
    });
  }

  const update = (time: number) => {
    flames.forEach((f, i) => {
      const k = 1 + 0.18 * Math.sin(time * 11 + i * 2.1) + 0.1 * Math.sin(time * 17.3 + i * 4.7);
      f.scale.set(1 + 0.07 * Math.sin(time * 13 + i), k, 1 + 0.07 * Math.cos(time * 12 + i));
      f.position.y = 1.3 + (flameH[i] * k) / 2;
      f.rotation.y = time * (1.5 + i * 0.4);
    });
    const flicker = 0.5 + 0.5 * Math.sin(time * 9) * Math.sin(time * 5.3 + 1);
    fireMat.opacity = 0.7 + 0.15 * flicker;
    firePoolMat.opacity = 0.58 + 0.1 * flicker;
    shaftMats.forEach((m, i) => (m.opacity = 0.11 + 0.05 * Math.sin(time * 0.35 + i * 1.9)));
  };
  update(0);

  /** The leaf shade is all there is in the woods and a little in the clearing: it follows how far a point is from the projects. */
  const canopyMask = (extent: number) => {
    const S = 384;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(S, S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = mapSize / 2 - extent / 2 + ((i + 0.5) / S) * extent;
        const z = mapSize / 2 - extent / 2 + ((j + 0.5) / S) * extent;
        const v = Math.round(255 * (0.15 + 0.85 * smooth(field(x, z), -4, 60)));
        const o = (j * S + i) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(c);
    t.minFilter = t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    t.channel = 1; // (the leaf shade's own coordinates are tiled, this mask's are 0..1 across the plane: see render3d.ts)
    return t;
  };

  const dispose = () => {
    group.traverse((o: Object3D) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mats = (m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) as (Material & { map?: Texture | null })[];
      for (const mat of mats) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    glowMap.dispose();
  };

  return { group, update, canopyMask, dispose };
}
