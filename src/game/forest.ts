import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  ConeGeometry,
} from "three";
import type { BufferGeometry, MeshToonMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon } from "./models";

/**
 * A preview of the whole scene standing in a forest, the project yard being a small clearing in it (switched on with `?forest`
 * on the home page; `?forest=grass` also turns the yard's asphalt into grass). Nothing here is part of the map: it is only
 * scenery round it, drawn in the map's own group so that it zooms with it.
 *
 *  - `yard`: the asphalt stays, ringed by a worn dirt apron, then grass, then trees.
 *  - `grass`: the whole clearing is a meadow (the ground layer paints grass: see `buildGroundLayer`).
 */
export type ForestStyle = "yard" | "grass";

/** How far past the yard the trees (and the floor texture) reach, in world px. Past it the floor is nearly black. */
export const FOREST_REACH = 260;
/** Where trees may start: the distance from the (ragged) clearing edge to the first trunk. The apron and grass lie inside it. */
const TREE_LINE = 20;
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

/**
 * How far a point is outside the yard, in px (negative inside it), with the edge made ragged so the clearing is not a
 * rectangle: the floor texture and the tree placement both read this, so the trees keep to the line the floor draws.
 */
function clearingDist(x: number, z: number, mapSize: number) {
  const h = mapSize / 2;
  const qx = Math.abs(x - h) - h;
  const qz = Math.abs(z - h) - h;
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  return sd + (vnoise(x / 38, z / 38, 3) - 0.5) * 22 + (vnoise(x / 11, z / 11, 5) - 0.5) * 7;
}

// ------------------------------------------------------------------ the forest floor

type RGB = [number, number, number];
const DIRT: RGB = [0x7b, 0x65, 0x46];
const GRASS: RGB = [0x5d, 0x8e, 0x3e];
const MOSS: RGB = [0x35, 0x59, 0x32];
const DEEP: RGB = [0x1d, 0x33, 0x25];
const DARK: RGB = [0x10, 0x1d, 0x17];
const LITTER: RGB = [0x6b, 0x4a, 0x2a];

function mix(out: RGB, a: RGB, b: RGB, t: number) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** The ground the trees stand on, one texture over the yard and `FOREST_REACH` past it: dirt, grass, moss, dusk. */
function floorTexture(mapSize: number, style: ForestStyle): CanvasTexture {
  const pad = FOREST_REACH + 4;
  const size = Math.ceil(mapSize + 2 * pad);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const dirtW = style === "grass" ? 0 : 7;
  const col: RGB = [0, 0, 0];
  const tmp: RGB = [0, 0, 0];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px - pad;
      const z = py - pad;
      const d = clearingDist(x, z, mapSize);
      const n = vnoise(x / 14, z / 14, 8);
      // dirt next to the yard, grass beyond it, moss under the first trees, then deepening into the dark
      mix(col, GRASS, MOSS, smooth(d, dirtW + 8, 55));
      mix(col, col, DEEP, smooth(d, 55, 140));
      mix(col, col, DARK, smooth(d, 140, FOREST_REACH));
      if (dirtW > 0) {
        mix(tmp, DIRT, col, smooth(d + (n - 0.5) * 5, dirtW - 1, dirtW + 4));
        col[0] = tmp[0];
        col[1] = tmp[1];
        col[2] = tmp[2];
      }
      // soft patches and a grain of single pixels; needles and leaf litter, mostly under the trees
      const patch = 1 + (n - 0.5) * 0.24 + (vnoise(x / 40, z / 40, 2) - 0.5) * 0.14 + (hash(px, py) - 0.5) * 0.07;
      if (d > 12 && hash(px, py, 7) < 0.025) mix(col, col, LITTER, 0.5);
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

// ------------------------------------------------------------------ the trees

/** Gives a geometry one flat color per vertex (merged shapes keep their own colors this way), non-indexed so they merge. */
function painted(geo: BufferGeometry, hex: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const color = new Color(hex);
  const n = g.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = color.r;
    rgb[i * 3 + 1] = color.g;
    rgb[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return g;
}

function moved(geo: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  return geo.translate(x, y, z);
}

/** A conifer about 38 high: a trunk and three stacked skirts, darker at the bottom. Scaled per tree. */
function pineGeometry(): BufferGeometry {
  const skirt = (r: number, h: number, base: number, hex: string) =>
    painted(moved(new ConeGeometry(r, h, 8, 1, true), 0, base + h / 2, 0), hex);
  return mergeGeometries([
    painted(moved(new CylinderGeometry(1.5, 2.3, 10, 6), 0, 5, 0), "#5a3f28"),
    skirt(13, 18, 6, "#2c5a34"),
    skirt(10.5, 16, 15, "#35683a"),
    skirt(7.5, 14, 24, "#42793f"),
  ])!;
}

/** A broadleaf about 38 high: a trunk and a clump of four round blobs. */
function oakGeometry(): BufferGeometry {
  const blob = (r: number, x: number, y: number, z: number, hex: string) =>
    painted(moved(new IcosahedronGeometry(r, 1), x, y, z), hex);
  return mergeGeometries([
    painted(moved(new CylinderGeometry(2, 3, 14, 6), 0, 7, 0), "#5e4228"),
    blob(11, 0, 23, 0, "#4a8438"),
    blob(8.5, 7, 18, 2, "#42772f"),
    blob(8, -6.5, 19, -3, "#3f722e"),
    blob(7.5, 1, 31, -1, "#5a9644"),
  ])!;
}

function bushGeometry(): BufferGeometry {
  const blob = (r: number, x: number, y: number, z: number, hex: string) =>
    painted(moved(new IcosahedronGeometry(r, 1), x, y, z), hex);
  return mergeGeometries([blob(5.5, 0, 4, 0, "#3f7a34"), blob(4.2, 5, 3, 2, "#386e2f"), blob(4, -4, 3, -2, "#4a8a3a")])!;
}

function rockGeometry(): BufferGeometry {
  return painted(moved(new DodecahedronGeometry(4.5, 0), 0, 2.5, 0), "#8a8d86");
}

/** A fallen log lying along x. */
function logGeometry(): BufferGeometry {
  const g = new CylinderGeometry(2.3, 2.3, 18, 7);
  g.rotateZ(Math.PI / 2);
  return painted(moved(g, 0, 2.3, 0), "#6e4b2e");
}

function foliageMaterial(): MeshToonMaterial {
  const m = toon("#ffffff").clone();
  m.vertexColors = true;
  return m;
}

interface Placed {
  x: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  tint: Color;
}

const up = new Vector3(0, 1, 0);

function instances(geo: BufferGeometry, mat: MeshToonMaterial, list: Placed[]): InstancedMesh | null {
  if (!list.length) return null;
  const mesh = new InstancedMesh(geo, mat, list.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    m.compose(pos.set(p.x, 0, p.z), q, scale.set(p.sx, p.sy, p.sx));
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

/**
 * The forest: a floor, and trees in a ring round the yard. Small trees and shrubs stand at the clearing's edge (the camera
 * looks over the front of the map, so tall trunks there would hide the yard) and they grow taller the further out they stand,
 * pines and oaks in groves, a few oaks turned to autumn. Trees cast no shadow (the sun's shadow map is fitted to the map).
 */
export function buildForest(mapSize: number, style: ForestStyle, seed = 11): Group {
  const rand = rng(seed);
  const group = new Group();
  group.name = "forest";

  // the floor under it all, and a dark plane past its end for wide and tall screens
  const total = mapSize + 2 * (FOREST_REACH + 4);
  const floor = new Mesh(new PlaneGeometry(total, total), new MeshBasicMaterial({ map: floorTexture(mapSize, style) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(mapSize / 2, -0.4, mapSize / 2);
  floor.renderOrder = -3;
  const beyond = new Mesh(new PlaneGeometry(total * 8, total * 8), new MeshBasicMaterial({ color: new Color(DARK[0] / 255, DARK[1] / 255, DARK[2] / 255) }));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.set(mapSize / 2, -0.5, mapSize / 2);
  beyond.renderOrder = -4;
  group.add(beyond, floor);

  const pines: Placed[] = [];
  const oaks: Placed[] = [];
  const bushes: Placed[] = [];
  const rocks: Placed[] = [];
  const logs: Placed[] = [];

  // trees: a jittered grid, thinned toward the far edge and into the groves' gaps
  const CELL = 19;
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
      const x = gx + (jx - 0.5) * CELL * 0.9;
      const z = gz + (jz - 0.5) * CELL * 0.9;
      const d = clearingDist(x, z, mapSize);
      if (d < TREE_LINE || d > FOREST_REACH) continue;
      const far = smooth(d, 110, FOREST_REACH);
      const keep = lerp(0.6, 0.95, smooth(d, TREE_LINE, TREE_LINE + 45)) * (1 - 0.5 * far) * (0.75 + 0.5 * vnoise(x / 70, z / 70, 9));
      if (r1 > keep) continue;
      // short at the clearing's edge, tall out in the woods
      const grow = lerp(0.42, 1.55, smooth(d, 10, 95)) * (0.82 + r2 * 0.4);
      const l = 0.85 + r3 * 0.3;
      const pine = vnoise(x / 90, z / 90, 4) + (r4 - 0.5) * 0.5 > 0.45;
      const tint = new Color();
      if (pine) tint.setRGB(l * 0.92, l, l * 1.04);
      else if (r5 < 0.13) tint.setRGB(l * 1.9, l * 1.0, l * 0.45); // (turned to yellow and orange)
      else tint.setRGB(l * (0.9 + r3 * 0.2), l, l * 0.9);
      (pine ? pines : oaks).push({ x, z, yaw: r2 * TAU, sx: grow * (0.9 + r5 * 0.25), sy: grow, tint });
    }
  }

  // undergrowth, rocks and fallen logs at the clearing's edge
  const SMALL = 13;
  for (let gz = -90; gz < mapSize + 90; gz += SMALL) {
    for (let gx = -90; gx < mapSize + 90; gx += SMALL) {
      const jx = rand();
      const jz = rand();
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      const x = gx + (jx - 0.5) * SMALL;
      const z = gz + (jz - 0.5) * SMALL;
      const d = clearingDist(x, z, mapSize);
      if (d < TREE_LINE - 9 || d > TREE_LINE + 70) continue;
      const clump = vnoise(x / 30, z / 30, 6);
      const l = 0.85 + r3 * 0.3;
      if (r1 < 0.34 * clump * 2) {
        const s = 0.7 + r2 * 0.7;
        bushes.push({ x, z, yaw: r3 * TAU, sx: s, sy: s * 0.9, tint: new Color(l, l * 1.02, l * 0.92) });
      } else if (r1 > 0.985) {
        const s = 0.7 + r2 * 1.0;
        rocks.push({ x, z, yaw: r3 * TAU, sx: s, sy: s * 0.7, tint: new Color(l, l, l * 1.02) });
      } else if (r1 > 0.972 && d > TREE_LINE) {
        logs.push({ x, z, yaw: r3 * TAU, sx: 0.8 + r2 * 0.5, sy: 0.8 + r2 * 0.5, tint: new Color(l, l, l) });
      }
    }
  }

  const mat = foliageMaterial();
  for (const mesh of [
    instances(pineGeometry(), mat, pines),
    instances(oakGeometry(), mat, oaks),
    instances(bushGeometry(), mat, bushes),
    instances(rockGeometry(), mat, rocks),
    instances(logGeometry(), mat, logs),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group;
}
