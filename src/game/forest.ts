import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
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
 * Wide-crowned trees stand far apart, never where their crown would hide a project; a dirt path comes in from the front to the
 * name; and there is a small camp in the quietest corner: a fire, a tent, stumps to sit on, a pile of logs, lanterns, and a
 * string of lights over the path.
 */
export type ForestStyle = "yard" | "grass";

/** The forest as the renderer uses it: what to add to the map, a per-frame step (the fire), and a way to let go of it. */
export interface Forest {
  group: Group;
  update(time: number): void;
  dispose(): void;
}

/** What the forest needs to know of a project: where it stands. */
export interface ForestZone {
  kind: string;
  area: Rect;
}

/** How far past the projects the trees (and the floor texture) reach, in world px. Past it the floor is nearly black. */
export const FOREST_REACH = 230;
const TAU = Math.PI * 2;

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

/** Signed distance from a point to a rectangle (negative inside it). */
function rectSdf(x: number, z: number, r: Rect) {
  const qx = Math.abs(x - (r.x + r.w / 2)) - r.w / 2;
  const qz = Math.abs(z - (r.y + r.h / 2)) - r.h / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

// ------------------------------------------------------------------ where things are

/** The path in from the front of the map to the name in the middle of it. */
interface PathLayout {
  mapSize: number;
  /** Where the path ends: just south of the name. */
  hub: { x: number; z: number };
  /** Where it passes between the projects along the front. */
  gapX: number;
  /** The top of those projects: the path has reached `gapX` by here. */
  rowTop: number;
}

/** The path and the camp, shared by the floor, the trees and the props. */
interface Layout extends PathLayout {
  camp: { x: number; z: number };
}

/** The path's middle `z` px down the map: from the name, over to the gap in the front row, then wandering off south. */
function pathCenter(p: PathLayout, z: number) {
  const t = smooth(z, p.hub.z, Math.max(p.hub.z + 1, p.rowTop - 30));
  const wander = 20 * Math.sin((z - p.mapSize) / 52) * smooth(z, p.mapSize, p.mapSize + 80);
  return lerp(p.hub.x, p.gapX, t) + wander;
}

function pathHalfWidth(dz: number) {
  return lerp(8.5, 5, smooth(dz, 0, 170));
}

/** How far a point is beyond the path's edge (negative on the path), or past its end at the name. */
function pathGap(p: PathLayout, x: number, z: number) {
  const lateral = Math.abs(x - pathCenter(p, z)) * 0.93 - pathHalfWidth(z - p.mapSize);
  return Math.max(lateral, p.hub.z - z);
}

function pathLayout(mapSize: number, zones: ForestZone[]): PathLayout {
  // the name stands in the middle of the map: the path ends at its front edge
  const name = zones.find((z) => z.kind === "about")?.area;
  const hub = name ? { x: name.x + name.w / 2, z: name.y + name.h + 12 } : { x: mapSize / 2, z: mapSize / 2 };
  // the widest gap between the projects of the front row, where the path passes through them
  const row = zones.map((z) => z.area).filter((a) => a.y + a.h > mapSize - 110);
  const spans = row.map((a) => [a.x, a.x + a.w] as const).sort((p, q) => p[0] - q[0]);
  const lo = 40;
  const hi = mapSize - 40;
  let best = { w: 0, c: mapSize / 2 };
  let cursor = lo;
  for (const [s, e] of spans) {
    if (s - cursor > best.w) best = { w: s - cursor, c: (s + cursor) / 2 };
    cursor = Math.max(cursor, e);
  }
  if (hi - cursor > best.w) best = { w: hi - cursor, c: (hi + cursor) / 2 };
  return { mapSize, hub, gapX: best.c, rowTop: row.length ? Math.min(...row.map((a) => a.y)) : mapSize - 150 };
}

/** The camp goes where there is the most room: far from every project and from the path, leaning east. */
function pickCamp(p: PathLayout, zones: ForestZone[]) {
  const { mapSize } = p;
  let best = { score: -1, x: 0, z: 0 };
  for (let z = mapSize * 0.25; z <= mapSize * 0.8; z += 16) {
    for (let x = mapSize * 0.45; x <= mapSize - 50; x += 16) {
      let s = 999;
      for (const zone of zones) s = Math.min(s, rectSdf(x, z, zone.area));
      s = Math.min(s, pathGap(p, x, z) + 20) + (x / mapSize) * 10;
      if (s > best.score) best = { score: s, x, z };
    }
  }
  // (no room inside the map: it goes just outside it, on the east side)
  return best.score >= 75 ? { x: best.x, z: best.z } : { x: mapSize + 70, z: mapSize * 0.5 };
}

/**
 * How far a point is outside the clearing, in px (negative inside it): the projects' areas with a margin, melted together at
 * their corners, and the camp, with the edge made ragged. The floor texture and the tree placement both read this, so the trees
 * keep to the line the floor draws. The smooth part is worked out once on a coarse grid.
 */
function clearingField(mapSize: number, zones: ForestZone[], camp: { x: number; z: number }) {
  const pad = FOREST_REACH + 4;
  const step = 4;
  const n = Math.ceil((mapSize + 2 * pad) / step) + 1;
  const grid = new Float32Array(n * n);
  const K = 22; // how far the corners melt together
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * step - pad;
      const z = j * step - pad;
      let sum = Math.exp(-(Math.hypot(x - camp.x, z - camp.z) - 44) / K);
      for (const zone of zones) sum += Math.exp(-rectSdf(x, z, zone.area) / K);
      grid[j * n + i] = -K * Math.log(sum + 1e-12) - 18;
    }
  }
  return (x: number, z: number) => {
    const fx = Math.min(n - 1.001, Math.max(0, (x + pad) / step));
    const fz = Math.min(n - 1.001, Math.max(0, (z + pad) / step));
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
const PATH: RGB = [0x9a, 0x82, 0x5c];
const GRASS: RGB = [0x44, 0x70, 0x3a];
const MOSS: RGB = [0x27, 0x44, 0x2a];
const DEEP: RGB = [0x16, 0x28, 0x1c];
const DARK: RGB = [0x0c, 0x16, 0x11];
const LITTER: RGB = [0x5e, 0x42, 0x28];
const CAMP_DIRT: RGB = [0x5c, 0x4a, 0x34];
const ASH: RGB = [0x2a, 0x22, 0x1c];

function mix(out: RGB, a: RGB, b: RGB, t: number) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** The ground everything stands on, one texture over the map and `FOREST_REACH` past it: earth or lawn, grass, moss, dusk, and the path. */
function floorTexture(l: Layout, field: (x: number, z: number) => number, style: ForestStyle): CanvasTexture {
  const { mapSize } = l;
  const pad = FOREST_REACH + 4;
  const size = Math.ceil(mapSize + 2 * pad);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const col: RGB = [0, 0, 0];
  const tmp: RGB = [0, 0, 0];
  const pathCol: RGB = [0, 0, 0];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - pad;
      const z = py - pad;
      const d = field(x, z);
      const n = vnoise(x / 14, z / 14, 8);
      // grass beyond the clearing, moss under the first trees, then deepening into the dark
      mix(col, GRASS, MOSS, smooth(d, 10, 60));
      mix(col, col, DEEP, smooth(d, 60, 140));
      mix(col, col, DARK, smooth(d, 140, FOREST_REACH));
      if (style === "yard") {
        // packed earth where the projects stand, worn through the grass; ragged at the edge, with tufts coming through
        const e = 1 - smooth(d + (n - 0.5) * 8, -3, 6);
        mix(tmp, col, EARTH, e * (1 - 0.35 * smooth(vnoise(x / 9, z / 9, 21), 0.62, 0.8)));
        col[0] = tmp[0];
        col[1] = tmp[1];
        col[2] = tmp[2];
      }
      // the path: packed earth with a lighter worn middle and the odd pebble, fading into the dusk with the rest
      const pg = pathGap(l, x, z);
      if (pg < 3) {
        const t = 1 - smooth(pg + (n - 0.5) * 3, -1.5, 1.5);
        if (t > 0) {
          const dim = 1 - 0.8 * smooth(z - mapSize, 70, 225);
          const worn = 1 + 0.1 * smooth(-pg, 2, 6);
          const stone = hash(px, py, 13) < 0.03 ? (hash(px, py, 14) < 0.5 ? 0.78 : 1.2) : 1;
          for (let k = 0; k < 3; k++) pathCol[k] = Math.min(255, PATH[k] * dim * worn * stone);
          mix(col, col, pathCol, t);
        }
      }
      // the campsite: bare earth round the fire, ash in the middle of it
      const cd = Math.hypot(x - l.camp.x, z - l.camp.z) + (n - 0.5) * 5;
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

/** A conifer about 38 high and 26 across: a trunk and three stacked skirts, darker at the bottom. Scaled per tree. */
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

/** A broadleaf about 52 high and 54 across: a thick trunk and a wide, lumpy crown of eight blobs. Scaled per tree. */
function broadGeometry(): BufferGeometry {
  const blob = (r: number, x: number, y: number, z: number, hex: string) =>
    painted(moved(new IcosahedronGeometry(r, 1), x, y, z), hex);
  return mergeGeometries([
    painted(moved(new CylinderGeometry(2.6, 4, 22, 7), 0, 11, 0), "#4d3622"),
    blob(14, 0, 34, 0, "#2f6a2c"),
    blob(12, 15, 29, 4, "#2a5f28"),
    blob(12, -14, 30, -5, "#27582a"),
    blob(11, 4, 29, 15, "#2d6429"),
    blob(11, -5, 31, -14, "#2a5f28"),
    blob(10, 0, 43, 0, "#3d7c34"),
    blob(8, 17, 36, -8, "#35722f"),
    blob(8, -17, 35, 9, "#306b2c"),
  ])!;
}

function bushGeometry(): BufferGeometry {
  const blob = (r: number, x: number, y: number, z: number, hex: string) =>
    painted(moved(new IcosahedronGeometry(r, 1), x, y, z), hex);
  return mergeGeometries([blob(5.5, 0, 4, 0, "#2a5f2b"), blob(4.2, 5, 3, 2, "#235327"), blob(4, -4, 3, -2, "#326b30")])!;
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
  return mergeGeometries([painted(body, "#a48a5e"), painted(flap, "#241b13")])!;
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
  /** How far its crown reaches (a tree), for the patch of shade under it. */
  r?: number;
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
 * The forest: a floor, a few wide-crowned trees far apart, and the cosy things at the clearing's edge.
 *
 * The camera looks over the front of the map from above, so a tree hides the ground north of it: a crown at height h covers
 * the ground `0.625 h` further north, and a building stands up 28 px or so of ground-equivalent besides. A tree is only put where
 * that patch (see `hides`) misses every project, and shrunk until it does, so the ones near the projects are small and the big
 * ones stand further out, behind and beside. Trees cast no shadow (the sun's shadow map is fitted to the map), so each gets a soft
 * dark patch on the ground instead.
 */
export function buildForest(mapSize: number, style: ForestStyle, zones: ForestZone[], seed = 11): Forest {
  const rand = rng(seed);
  const group = new Group();
  group.name = "forest";
  const path = pathLayout(mapSize, zones);
  const layout: Layout = { ...path, camp: pickCamp(path, zones) };
  const { camp } = layout;
  const field = clearingField(mapSize, zones, camp);
  const areas = zones.map((z) => z.area);

  // the floor under it all, and a dark plane past its end for wide and tall screens
  const total = mapSize + 2 * (FOREST_REACH + 4);
  const floor = new Mesh(new PlaneGeometry(total, total), new MeshBasicMaterial({ map: floorTexture(layout, field, style) }));
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
  const bushes: Placed[] = [];
  const rocks: Placed[] = [];
  const logs: Placed[] = [];
  const stumps: Placed[] = [];
  const campDist = (x: number, z: number) => Math.hypot(x - camp.x, z - camp.z);

  /** Would a tree here, with a crown `r` wide and `h` high, hide any project (or hang over one)? */
  const hides = (x: number, z: number, r: number, h: number) =>
    areas.some((a) => x + r > a.x - 6 && x - r < a.x + a.w + 6 && z + 0.6 * r + 28 > a.y - 6 && z - (0.625 * h + 0.5 * r) < a.y + a.h + 6);

  /** Plants a tree of about size `grow` here, or a smaller one if that would hide a project, or none. */
  const plant = (x: number, z: number, grow: number, r2: number, r3: number, r4: number, r5: number) => {
    const pine = vnoise(x / 90, z / 90, 4) + (r4 - 0.5) * 0.5 > 0.62;
    const l = 0.85 + r3 * 0.3;
    const tint = new Color();
    if (pine) tint.setRGB(l * 0.92, l, l * 1.04);
    else if (r5 < 0.13) tint.setRGB(l * 2.6, l * 1.15, l * 0.4); // (turned to yellow and orange)
    else tint.setRGB(l * (0.9 + r3 * 0.2), l, l * 0.9);
    const baseR = pine ? 13 : 26;
    const baseH = pine ? 48 : 52;
    for (const f of [1, 0.8, 0.62, 0.5]) {
      const g = grow * f;
      const r = baseR * g;
      if (hides(x, z, r, baseH * g)) continue;
      // (a pine is stretched up and a broadleaf spreads: wide crowns are the point)
      const tree: Placed = pine
        ? { x, z, r, yaw: r2 * TAU, sx: g * 0.95, sy: g * 1.25, tint }
        : { x, z, r, yaw: r2 * TAU, sx: g * (0.92 + r5 * 0.16), sy: g * (0.9 + r3 * 0.2), tint };
      (pine ? pines : broads).push(tree);
      return;
    }
  };

  // the big trees: a jittered grid with wide cells, thinned toward the far edge and into the groves' gaps
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
      if (d < 14 || d > FOREST_REACH) continue;
      const keep = lerp(0.6, 0.9, smooth(d, 30, 80)) * (1 - 0.4 * smooth(d, 100, FOREST_REACH)) * (0.75 + 0.5 * vnoise(x / 120, z / 120, 9));
      if (r1 > keep) continue;
      if (pathGap(layout, x, z) < 16 || campDist(x, z) < 70) continue;
      // lower at the clearing's edge, tall (well past a building) out in the woods
      plant(x, z, lerp(1.1, 2.2, smooth(d, 20, 110)) * (0.85 + r2 * 0.3), r2, r3, r4, r5);
    }
  }

  // young trees, undergrowth, stumps, rocks and fallen logs round the clearing
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
      if (d < 5 || d > 90) continue;
      if (pathGap(layout, x, z) < 6 || campDist(x, z) < 40) continue;
      const clump = vnoise(x / 30, z / 30, 6);
      const l = 0.85 + r3 * 0.3;
      if (r1 < 0.12 * clump * 2) {
        const s = 0.9 + r2 * 0.8;
        bushes.push({ x, z, yaw: r3 * TAU, sx: s, sy: s * 0.9, tint: new Color(l, l * 1.02, l * 0.92) });
      } else if (r1 > 0.8 && r1 < 0.825 && d > 22) {
        // a young tree, small enough to stand close to a project
        plant(x, z, Math.min(0.9, Math.max(0.4, d / 40)) * (0.8 + r2 * 0.4), r2, r3, r4, r5);
      } else if (r1 > 0.955 && r1 < 0.965 && d > 12) {
        const s = 0.9 + r2 * 0.4;
        stumps.push({ x, z, yaw: r3 * TAU, sx: s, sy: s, tint: new Color(l, l, l) });
      } else if (r1 > 0.972 && r1 < 0.985 && d > 20) {
        logs.push({ x, z, yaw: r3 * TAU, sx: 0.8 + r2 * 0.5, sy: 0.8 + r2 * 0.5, tint: new Color(l, l, l) });
      } else if (r1 > 0.985) {
        const s = 0.7 + r2 * 1.0;
        rocks.push({ x, z, yaw: r3 * TAU, sx: s, sy: s * 0.7, tint: new Color(l, l, l * 1.02) });
      }
    }
  }

  // ---- the camp: a fire in a ring of stones, crossed logs, stumps to sit on, a tent behind, a pile of logs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    rocks.push({ x: camp.x + Math.cos(a) * 7.5, z: camp.z + Math.sin(a) * 7.5, yaw: a, sx: 0.5, sy: 0.4, tint: WHITE });
  }
  for (let i = 0; i < 3; i++) logs.push({ x: camp.x, z: camp.z, y: 1.3, yaw: (i * Math.PI) / 3 + 0.3, sx: 0.55, sy: 0.55, tint: WHITE });
  for (const a of [Math.PI, Math.PI * 0.55, Math.PI * 1.45]) {
    stumps.push({ x: camp.x + Math.cos(a) * 16, z: camp.z + Math.sin(a) * 16, yaw: a, sx: 1.1, sy: 1.1, tint: WHITE });
  }
  const tent: Placed = { x: camp.x + 24, z: camp.z - 2, yaw: 0, sx: 1, sy: 1, tint: WHITE };
  // three-two-one, resting on each other
  const pile = { x: camp.x + 24, z: camp.z + 24 };
  [-4.8, 0, 4.8].forEach((dz) => logs.push({ x: pile.x, z: pile.z + dz, yaw: 0, sx: 1, sy: 1, tint: WHITE }));
  [-2.4, 2.4].forEach((dz) => logs.push({ x: pile.x, z: pile.z + dz, y: 4.2, yaw: 0, sx: 1, sy: 1, tint: WHITE }));
  logs.push({ x: pile.x, z: pile.z, y: 8.4, yaw: 0, sx: 1, sy: 1, tint: WHITE });

  // ---- lights: posts with a lantern along the path and by the tent, and a string of bulbs over the path in the woods
  const posts: { x: number; z: number }[] = [];
  [18, 60, 102].forEach((dz, i) => {
    const z = mapSize + dz;
    posts.push({ x: pathCenter(layout, z) + (i % 2 ? 1 : -1) * (pathHalfWidth(dz) + 8), z });
  });
  posts.push({ x: camp.x + 6, z: camp.z - 18 });
  const POST_H = 15;
  const poles: Placed[] = posts.map((p) => ({ x: p.x, z: p.z, yaw: 0, sx: 1, sy: 1, tint: WHITE }));
  const STRING_Z = mapSize + 40;
  const stringMid = pathCenter(layout, STRING_Z);
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
    instances(broadGeometry(), treeMat, broads),
    instances(bushGeometry(), treeMat, bushes),
    instances(rockGeometry(), treeMat, rocks),
    instances(logGeometry(), treeMat, logs),
    instances(stumpGeometry(), treeMat, stumps),
    instances(tentGeometry(), treeMat, [tent]),
    instances(poleGeometry(0.9, POST_H), treeMat, poles),
    instances(poleGeometry(1.7, 46), treeMat, tallPoles),
  ]) {
    if (mesh) group.add(mesh);
  }

  // a soft dark patch under each tree, cast a little toward the back-right as the sun is front-left
  const shadowMat = new MeshBasicMaterial({
    map: radialTexture([
      [0, "rgba(0,10,5,0.5)"],
      [0.55, "rgba(0,10,5,0.28)"],
      [1, "rgba(0,10,5,0)"],
    ]),
    transparent: true,
    depthWrite: false,
  });
  const patches = disks(
    shadowMat,
    [...pines, ...broads].map((t) => ({ x: t.x + 0.2 * (t.r ?? 0), y: -0.3, z: t.z - 0.2 * (t.r ?? 0), r: 0.85 * (t.r ?? 0), stretch: 1.35, yaw: Math.PI / 4 }))
  );
  if (patches) {
    patches.renderOrder = -2;
    group.add(patches);
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
  addGlow(new Vector3(camp.x, 7, camp.z), 52, fireMat);
  const firePoolMat = new MeshBasicMaterial({ map: glowMap, color: "#ff9a40", opacity: 0.65, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const firePool = disks(firePoolMat, [{ x: camp.x, y: 0.25, z: camp.z, r: 34 }]);
  if (firePool) {
    firePool.renderOrder = 4;
    group.add(firePool);
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
  };
  update(0);

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

  return { group, update, dispose };
}
