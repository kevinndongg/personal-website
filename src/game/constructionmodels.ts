import { BoxGeometry, Group, Vector3 } from "three";
import type { BufferGeometry, Material, Mesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isMirrored, siteRand } from "./construction";
import { box, cyl, mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import type { Prop } from "./scenes";
import type { Zone } from "./world";

// Models for the construction site (see construction.ts): tower cranes and a mobile crane.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground.
// Anything that moves animates itself from `userData.animate`; the lattices and bodies that do not are baked into a few
// merged meshes, because four sites with a mast apiece would otherwise be a lot of separate draws and shadow casters.

const YELLOW = "#f2c230";
const YELLOW_DK = "#c99a1c";
const CONCRETE = "#8d8f96";
const STEEL_DK = "#3d4048";
const GLASS = "#7fd6ff";
const TYRE = "#1a1a20";

const X_AXIS = new Vector3(1, 0, 0);

/**
 * Merges every mesh under `src` into one mesh per material, with their placement baked in. `src` must be a fresh group
 * at the origin (its own transform is not applied), and nothing inside it can move afterwards.
 */
function bake(src: Group): Group {
  src.updateMatrixWorld(true);
  const byMaterial = new Map<Material, BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    const list = byMaterial.get(m.material as Material);
    if (list) list.push(geo);
    else byMaterial.set(m.material as Material, [geo]);
  });
  const out = new Group();
  for (const [material, list] of byMaterial) {
    const merged = mergeGeometries(list);
    list.forEach((g) => g.dispose());
    if (merged) out.add(mesh(merged, material));
  }
  return out;
}

/** A thin square bar between two points. */
function strut(a: [number, number, number], b: [number, number, number], thick: number, color: string): Mesh {
  const from = new Vector3(...a);
  const dir = new Vector3(...b).sub(from);
  const len = dir.length();
  const m = mesh(new BoxGeometry(len, thick, thick), toon(color));
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(X_AXIS, dir.normalize());
  return m;
}

/** A wheel with its axle along z, standing on the ground. */
function wheel(r: number, w: number, x: number, z: number): Mesh {
  const m = cyl(r, r, w, TYRE, x, 0, z, 12);
  m.rotation.x = Math.PI / 2;
  m.position.y = r;
  return m;
}

/** 0..1, easing up and down once per `period` seconds, `phase` radians in. */
const swing = (t: number, period: number, phase: number) => 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / period + phase);

/**
 * A tower crane: a lattice mast, and on top a slewing jib with a counter-jib, a cab and a trolley that runs along the
 * jib with a hook hanging from it, carrying a load. `h` is the height of the very top; `facing` is which way (+1 east,
 * -1 west) the jib points when it is at rest.
 */
function towerCraneModel(seed: number, name: string, h: number, jib: number, facing: 1 | -1): Group {
  const rand = siteRand(seed, name);
  const f = facing;
  const HEAD = 13; // the A-frame above the slewing ring
  const mastTop = h - 2 - HEAD;
  const g = new Group();

  // base block and lattice mast: four posts, then a rung and a diagonal per bay on the faces the camera and the sun see
  const fixed = new Group();
  fixed.add(box(10, 2, 10, CONCRETE, 0, 0, 0));
  const R = 2.2; // the posts stand this far out from the axis
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fixed.add(box(1.2, mastTop - 2, 1.2, YELLOW, sx * R, 2, sz * R));
  const bays = Math.max(4, Math.round((mastTop - 2) / 8));
  const bay = (mastTop - 2) / bays;
  for (let i = 0; i < bays; i++) {
    const y0 = 2 + i * bay;
    const y1 = y0 + bay;
    const flip = i % 2 === 0 ? 1 : -1;
    fixed.add(strut([-R * flip, y0, R], [R * flip, y1, R], 0.7, YELLOW)); // south face
    fixed.add(strut([R, y0, -R * flip], [R, y1, R * flip], 0.7, YELLOW)); // east face
    fixed.add(box(2 * R, 0.8, 0.8, YELLOW, 0, y0, R)); // rung on the south face
  }
  g.add(bake(fixed));

  // everything that turns with the jib
  const top = new Group();
  top.position.y = mastTop;
  const spin = new Group();
  const cl = jib * 0.3; // counter-jib length
  spin.add(box(5.6, 2, 5.6, YELLOW_DK, 0, 0, 0)); // slewing ring
  spin.add(box(1.6, HEAD, 1.6, YELLOW, 0, 2, 0)); // A-frame
  spin.add(box(jib, 1.2, 2.8, YELLOW, f * (jib / 2 - 1), 2, 0)); // lower chord
  const rungs = Math.max(4, Math.round(jib / 7));
  const pitch = jib / rungs;
  spin.add(box(jib, 0.7, 0.7, YELLOW, f * (jib / 2 - 1), 6.2, 0)); // upper chord
  for (let i = 0; i < rungs; i++) {
    const a = f * (-1 + i * pitch);
    const b = f * (-1 + (i + 1) * pitch);
    spin.add(strut(i % 2 ? [a, 6.2, 0] : [a, 3.2, 0], i % 2 ? [b, 3.2, 0] : [b, 6.2, 0], 0.6, YELLOW));
  }
  spin.add(box(cl, 1.2, 2.8, YELLOW, f * (-cl / 2), 2, 0)); // counter-jib
  spin.add(box(5, 4, 3, CONCRETE, f * (-cl + 3.5), 3.2, 0)); // counterweights
  spin.add(box(5, 4, 3, CONCRETE, f * (-cl + 8.5), 3.2, 0));
  const apex: [number, number, number] = [0, 2 + HEAD, 0];
  spin.add(strut(apex, [f * jib * 0.94, 3.2, 0], 0.5, STEEL_DK)); // pendants: to the jib tip, mid-jib and the tail
  spin.add(strut(apex, [f * jib * 0.56, 3.2, 0], 0.5, STEEL_DK));
  spin.add(strut(apex, [f * (-cl + 1), 3.2, 0], 0.5, STEEL_DK));
  spin.add(box(4.4, 4.6, 3.8, "#f4f4f4", f * 3.4, 2, 3.6)); // operator's cab on the near side
  spin.add(box(0.5, 2.4, 2.8, GLASS, f * 3.4 + f * 2.25, 3.2, 3.6));
  top.add(bake(spin));

  // the trolley runs along the jib; the hook line pays out beneath it, and the load swings on the end
  const trolley = new Group();
  trolley.position.set(0, 2, 0);
  trolley.add(box(3.6, 1.6, 3.4, STEEL_DK, 0, -1.6, 0));
  const line = mesh(new BoxGeometry(0.45, 1, 0.45).translate(0, -0.5, 0), toon(STEEL_DK));
  line.position.y = -1.6;
  trolley.add(line);
  const hook = new Group();
  hook.add(box(1.6, 2.2, 1.6, "#26262c", 0, -2.2, 0));
  if (rand() < 0.5) {
    // a steel beam on two slings
    hook.add(box(12, 1.8, 2.2, "#a9abb3", 0, -6.2, 0));
    hook.add(strut([0, -1.6, 0], [-5, -5.4, 0], 0.35, STEEL_DK));
    hook.add(strut([0, -1.6, 0], [5, -5.4, 0], 0.35, STEEL_DK));
  } else {
    // a crate
    hook.add(box(0.5, 2, 0.5, STEEL_DK, 0, -4.2, 0));
    hook.add(box(6, 5.4, 6, "#b07d4a", 0, -9.6, 0));
  }
  trolley.add(hook);
  top.add(trolley);
  g.add(top);

  // each crane has its own pace and its own place in the cycle
  const ph1 = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const ph3 = rand() * Math.PI * 2;
  const near = jib * 0.3;
  const far = jib * 0.92;
  const shortest = 9;
  const longest = Math.max(shortest + 4, mastTop - 14); // the load stops short of the ground
  g.userData.animate = ({ t }: AnimCtx) => {
    top.rotation.y = f * 0.54 * Math.sin((t * 2 * Math.PI) / 24 + ph1); // about +-31 degrees
    trolley.position.x = f * (near + (far - near) * swing(t, 17, ph2));
    const len = shortest + (longest - shortest) * swing(t, 11.5, ph3);
    line.scale.y = len;
    hook.position.y = -1.6 - len;
  };
  return g;
}

/**
 * A mobile crane: a truck on outriggers with a turret that slews and a telescopic boom that luffs, a hook on a line from
 * the boom tip. Its cab and boom point along `facing` (+1 east, -1 west).
 */
function mobileCraneModel(seed: number, name: string, facing: 1 | -1): Group {
  const rand = siteRand(seed, name);
  const f = facing;
  const g = new Group();

  // the carrier: chassis, wheels, outriggers, body and cab
  const body = new Group();
  body.add(box(30, 2.4, 8.6, STEEL_DK, 0, 2, 0));
  for (const x of [-10, -2, 9]) for (const z of [-1, 1]) body.add(wheel(2.8, 2.4, x, z * 5.4));
  body.add(box(2.4, 1, 17, STEEL_DK, f * -8, 2, 0)); // outrigger beams, with a foot at each end
  for (const z of [-1, 1]) body.add(box(3.4, 0.8, 3.4, CONCRETE, f * -8, 0, z * 9));
  body.add(box(17, 3.4, 9.6, YELLOW, f * -5, 4.4, 0));
  body.add(box(8, 7, 9.2, YELLOW, f * 11, 4.4, 0)); // cab
  body.add(box(0.5, 3.2, 7.2, GLASS, f * 15.1, 8, 0));
  body.add(box(8.2, 0.5, 9.4, YELLOW_DK, f * 11, 11, 0));
  g.add(bake(body));

  // the turret on top of the body; its slew carries the boom and the hook line round with it
  const turret = new Group();
  turret.position.set(f * -5, 7.8, 0);
  const shell = new Group();
  shell.add(cyl(5, 5, 1.4, STEEL_DK, 0, 0, 0, 12));
  shell.add(box(10, 5, 8.4, YELLOW_DK, 0, 1.4, 0));
  shell.add(box(4.6, 5, 8.4, CONCRETE, f * -7, 1.4, 0)); // counterweight at the tail
  shell.add(box(4.2, 4.2, 3.4, "#f4f4f4", f * 2.6, 1.8, 5.6)); // operator's cab beside the boom
  shell.add(box(0.5, 2.4, 2.6, GLASS, f * (2.6 + 2.15), 2.8, 5.6));
  turret.add(bake(shell));

  const boom = new Group();
  boom.position.set(f * 4, 5.2, 0);
  boom.add(box(22, 3, 3.2, YELLOW, f * 11, -1.5, 0));
  const inner = new Group(); // the telescoping sections slide out of the first
  inner.add(box(16, 2.2, 2.4, YELLOW_DK, f * 24, -1.1, 0));
  inner.add(box(10, 1.6, 1.8, STEEL_DK, f * 32, -0.8, 0));
  boom.add(inner);
  const tip = new Group(); // rides at the end of the boom and stays upright whatever the boom is doing
  tip.position.set(f * 36, 0, 0);
  inner.add(tip);
  turret.add(boom);

  const line = mesh(new BoxGeometry(0.4, 1, 0.4).translate(0, -0.5, 0), toon(STEEL_DK));
  tip.add(line);
  const hook = new Group();
  hook.add(box(1.4, 1.8, 1.4, "#26262c", 0, -1.8, 0));
  hook.add(box(7, 3, 5, "#a64b32", 0, -6.4, 0)); // a pallet of bricks
  hook.add(box(0.4, 2.2, 0.4, STEEL_DK, 0, -4, 0));
  tip.add(hook);
  g.add(turret);

  const ph1 = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const ph3 = rand() * Math.PI * 2;
  const ph4 = rand() * Math.PI * 2;
  g.userData.animate = ({ t }: AnimCtx) => {
    turret.rotation.y = f * 0.5 * Math.sin((t * 2 * Math.PI) / 30 + ph1);
    boom.rotation.z = f * (0.83 + 0.13 * Math.sin((t * 2 * Math.PI) / 21 + ph2)); // 40 to 55 degrees
    inner.position.x = f * 6 * swing(t, 26, ph3);
    tip.rotation.z = -boom.rotation.z;
    const len = 6 + 16 * swing(t, 13, ph4);
    line.scale.y = len;
    hook.position.y = -len;
  };
  return g;
}

const ORANGE = "#f08a1c";
const RUST = "#9a5230";
const SCAFFOLD = "#b8bcc4";

/**
 * The structure going up: a slab, a grid of columns at uneven heights with rebar sticking out of the unfinished ones, a
 * partial upper floor, a stub wall with a gap in it, a short stair, a slab leaning on a column and a bit of scaffolding.
 * Three layouts; which one, and its side and heights, come from the seed. Nothing in it is meant to be recognisable.
 */
function structureModel(seed: number, w: number, d: number): Group {
  const rand = siteRand(seed, "structure");
  const variant = Math.floor(rand() * 3);
  const side = rand() < 0.5 ? 1 : -1; // which way the tall end and the upper floor lie
  const SLAB = 1.6;
  const COL = 3.4;
  const FLOOR = 18; // height of the upper floor's underside above the slab
  const xs = [-0.367, -0.125, 0.125, 0.367].map((k) => k * w);
  const zs = [-0.326, 0, 0.326].map((k) => k * d);
  const g = new Group();
  g.add(box(w, SLAB, d, "#a7a9b0", 0, 0, 0));

  // the floor spans three columns by two rows; the six under it are exactly as tall as the floor
  const i0 = side === 1 ? 1 : 0;
  const j0 = variant === 2 ? 1 : 0;
  const holdsFloor = (i: number, j: number) => i >= i0 && i <= i0 + 2 && j >= j0 && j <= j0 + 1;

  const base = (i: number, j: number) => {
    const near = side === 1 ? i : 3 - i; // 0 at the tall end
    if (variant === 0) return [30, 22, 12][j]; // taller toward the back
    if (variant === 1) return [34, 24, 14, 8][near]; // a tall core at one end
    return [32, 24, 16, 8][near]; // stepped along the whole length
  };

  let leaner: { x: number; z: number; h: number } | null = null;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const supports = holdsFloor(i, j);
      if (!supports && rand() < 0.1) continue; // one has not been poured yet
      const h = supports ? FLOOR : Math.max(6, Math.round(base(i, j) + (rand() - 0.5) * 8));
      g.add(box(COL, h, COL, "#b9bbc2", xs[i], SLAB, zs[j]));
      if (!supports) {
        for (const [dx, dz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          g.add(box(0.4, 4 + rand() * 4, 0.4, RUST, xs[i] + dx * 1.2, SLAB + h, zs[j] + dz * 1.2));
        }
        if (!leaner || h > leaner.h) leaner = { x: xs[i], z: zs[j], h };
      }
    }
  }

  // the partial upper floor, with a little overhang
  const fw = xs[i0 + 2] - xs[i0] + COL + 1.6;
  const fd = zs[j0 + 1] - zs[j0] + COL + 1.6;
  g.add(box(fw, 1.8, fd, "#9a9ca4", (xs[i0] + xs[i0 + 2]) / 2, SLAB + FLOOR, (zs[j0] + zs[j0 + 1]) / 2));

  // a stub wall with a gap: along the back, or down the side where the floor is not
  const gap = 7;
  if (variant === 0) {
    const len = (w / 2 - 4) - gap / 2;
    for (const s of [-1, 1]) g.add(box(len, 9, 1.6, "#c4c6cc", s * (gap / 2 + len / 2), SLAB, -d / 2 + 2));
  } else {
    const len = (d / 2 - 4) - gap / 2;
    for (const s of [-1, 1]) g.add(box(1.6, 9, len, "#c4c6cc", -side * (w / 2 - 2), SLAB, s * (gap / 2 + len / 2)));
  }

  // a short stair against the front, climbing away from the floor
  for (let k = 0; k < 4; k++) g.add(box(3.4, 2.4 * (k + 1), 5.5, "#b9bbc2", -side * (4 + k * 3.4), SLAB, d / 2 - 3));

  // a precast slab leaning on the tallest unfinished column, its foot out toward the nearest edge
  if (leaner) {
    const dirx = leaner.x >= 0 ? 1 : -1;
    const foot = new Vector3(Math.max(-w / 2 + 2, Math.min(w / 2 - 2, leaner.x + dirx * 13)), SLAB, leaner.z);
    const head = new Vector3(leaner.x + dirx * (COL / 2 + 0.8), SLAB + leaner.h - 1, leaner.z);
    const dir = head.clone().sub(foot);
    const slab = mesh(new BoxGeometry(1.5, dir.length(), 8), toon("#a2a4ac"));
    slab.position.copy(foot).addScaledVector(dir, 0.5);
    slab.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    g.add(slab);
  }

  // a bay of scaffolding on the outside corner away from the floor
  const sx = -side * (w / 2 - 3.5);
  const sz = 7.5;
  for (const px of [-2.8, 2.8]) for (const pz of [-2.2, 2.2]) g.add(box(0.6, 24, 0.6, SCAFFOLD, sx + px, SLAB, sz + pz));
  for (const y of [8, 16, 24]) g.add(box(6.4, 0.6, 5.4, "#8b6a40", sx, SLAB + y, sz));
  for (let k = 0; k < 3; k++) {
    const y0 = SLAB + k * 8;
    const flip = k % 2 ? 1 : -1;
    g.add(strut([sx - 2.8 * flip, y0, sz + 2.2], [sx + 2.8 * flip, y0 + 8, sz + 2.2], 0.4, SCAFFOLD));
    g.add(strut([sx + 2.8, y0, sz - 2.2 * flip], [sx + 2.8, y0 + 8, sz + 2.2 * flip], 0.4, SCAFFOLD));
  }
  return bake(g);
}

/** The site cabin: a white portable office on skids with a roof in the project's colour. The door faces the viewer. */
function cabinModel(w: number, d: number, accent: string, m: number): Group {
  const g = new Group();
  g.add(box(w, 1.6, d, STEEL_DK, 0, 0, 0)); // skids
  g.add(box(w - 1, 10, d - 1, "#e3e1da", 0, 1.6, 0));
  g.add(box(w + 1.6, 1.4, d + 1.6, accent, 0, 11.6, 0));
  g.add(box(5, 2.6, 4, CONCRETE, -m * 7, 13, -2.5)); // air conditioner
  const front = (d - 1) / 2;
  g.add(box(5, 8.4, 0.6, "#5a4630", m * 6, 1.6, front + 0.2));
  for (const x of [-m * 4, -m * 10]) g.add(box(4.6, 3.6, 0.6, GLASS, x, 5.6, front + 0.2));
  g.add(box(6, 1, 3, "#8b909a", m * 6, 0, front + 1.5)); // step
  return bake(g);
}

/** A pallet of bricks or of concrete blocks, standing on a wooden pallet. */
function palletModel(w: number, d: number, kind: "bricks" | "blocks"): Group {
  const g = new Group();
  g.add(box(w, 1.4, d, "#b08a5a", 0, 0, 0));
  const layers = kind === "bricks" ? ["#b3563b", "#a64b32", "#b3563b"] : ["#b9bbc2", "#a7a9b0"];
  const lh = kind === "bricks" ? 2.4 : 3.4;
  layers.forEach((c, k) => g.add(box(w - 2, lh, d - 2, c, 0, 1.4 + k * lh, 0)));
  g.add(box(w - 5, 0.5, d - 5, kind === "bricks" ? "#f4f4f4" : STEEL_DK, 0, 1.4 + layers.length * lh, 0)); // strap or sheet on top
  return bake(g);
}

/** A run of orange site fence: a post every 10 units, two rails and a white band. Its length is the footprint width. */
function fenceModel(w: number): Group {
  const g = new Group();
  const n = Math.max(2, Math.ceil(w / 10) + 1);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * i) / (n - 1);
    g.add(box(1.2, 7, 1.2, ORANGE, x, 0, 0));
    g.add(box(4, 1, 2.4, STEEL_DK, x, 0, 0));
  }
  g.add(box(w, 1.1, 0.7, ORANGE, 0, 5.6, 0));
  g.add(box(w, 0.8, 0.6, ORANGE, 0, 1.8, 0));
  g.add(box(w, 1.6, 0.5, "#f4f4f4", 0, 3.4, 0));
  return bake(g);
}

/** A warning board at the gate: a yellow sign with a black triangle and "!", framed in the project's colour. */
function hazardSignModel(accent: string): Group {
  const g = new Group();
  g.add(box(1.2, 14, 1.2, STEEL_DK, 0, 0, 0));
  g.add(box(13.6, 12, 0.5, accent, 0, 7, -0.1)); // frame, a touch bigger than the board
  g.add(box(12, 10.4, 0.7, "#f6d02a", 0, 7.8, 0.1));
  // a three-sided prism turned to face the viewer, one point up
  const tri = (r: number, color: string, z: number) => {
    const t = cyl(r, r, 0.4, color, 0, 0, z, 3);
    t.rotation.x = -Math.PI / 2;
    t.position.set(0, 12.4, z);
    return t;
  };
  g.add(tri(4.4, "#16161d", 0.55));
  g.add(tri(3.3, "#f6d02a", 0.62));
  g.add(box(0.8, 2.1, 0.3, "#16161d", 0, 11.9, 0.8)); // the "!"
  g.add(box(0.8, 0.8, 0.3, "#16161d", 0, 10.9, 0.8));
  return bake(g);
}

/**
 * The model for a construction-site prop id, or null when the id is not one of ours. `prop.seed` carries the project's
 * seed: it decides which way the site is mirrored, and the heights and pace of each crane.
 */
export function constructionModel(id: string, w: number, d: number, prop: Prop, zones: Zone[]): Group | null {
  const seed = prop.seed ?? 0;
  const m = isMirrored(seed) ? -1 : 1;
  // the project this prop stands in: its colour goes on the cabin roof and the sign
  const owner = zones.find((z) => {
    const a = z.scene.area;
    return prop.x >= a.x && prop.x <= a.x + a.w && prop.y >= a.y && prop.y <= a.y + a.h;
  });
  const accent = owner?.accent ?? YELLOW;
  const r = (name: string, spread: number) => (siteRand(seed, `${name}-size`)() - 0.5) * 2 * spread;
  switch (id) {
    case "tcrane-a": // the tall one, pointing in over the structure
      return towerCraneModel(seed, id, 72 + r(id, 5), 64 + r(id, 4), m === 1 ? 1 : -1);
    case "tcrane-b": // the shorter one, pointing back the other way
      return towerCraneModel(seed, id, 56 + r(id, 4), 46 + r(id, 3), m === 1 ? -1 : 1);
    case "mcrane":
      return mobileCraneModel(seed, id, m === 1 ? -1 : 1);
    case "structure":
      return structureModel(seed, w, d);
    case "cabin":
      return cabinModel(w, d, accent, m);
    case "pallet-a":
      return palletModel(w, d, "bricks");
    case "pallet-b":
      return palletModel(w, d, "blocks");
    case "fence":
      return fenceModel(w);
    case "hazardsign":
      return hazardSignModel(accent);
  }
  return null;
}
