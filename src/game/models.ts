import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  SphereGeometry,
} from "three";
import type { BufferGeometry, Material } from "three";
import { CMR_LOGO } from "./cmr-logo";
import { shade } from "./ground";
import type { Footprint } from "./scenes";
import type { Zone } from "./world";

// All models: 1 unit = 1 world px, origin at the footprint center on the ground, +X = forward/east.

const gradient = new DataTexture(new Uint8Array([85, 135, 185, 225, 255]), 5, 1, RedFormat);
gradient.minFilter = NearestFilter;
gradient.magFilter = NearestFilter;
gradient.needsUpdate = true;

const toonCache = new Map<string, MeshToonMaterial>();
function toon(color: string): MeshToonMaterial {
  let m = toonCache.get(color);
  if (!m) {
    m = new MeshToonMaterial({ color, gradientMap: gradient });
    toonCache.set(color, m);
  }
  return m;
}

function mesh(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Box sitting on `y` (its bottom face), centered on x/z. */
function box(w: number, h: number, d: number, color: string | Material, x: number, y: number, z: number): Mesh {
  const mat = typeof color === "string" ? toon(color) : color;
  return mesh(new BoxGeometry(w, h, d), mat, x, y + h / 2, z);
}

function cyl(rTop: number, rBottom: number, h: number, color: string, x: number, y: number, z: number, seg = 10): Mesh {
  return mesh(new CylinderGeometry(rTop, rBottom, h, seg), toon(color), x, y + h / 2, z);
}

/** Wheel with its axle along Z. */
function wheel(r: number, w: number, x: number, y: number, z: number): Mesh {
  const m = cyl(r, r, w, "#1a1a20", x, y - w / 2, z, 12);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}

function nearestTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
    ctx.fillRect(cx - half, cy + y, half * 2, 1);
  }
}

/** Material list for a box whose top face carries `top` (BoxGeometry order: +x -x +y -y +z -z). */
function withTop(side: Material, top: Material): Material[] {
  return [side, side, top, side, side, side];
}

// ---------------------------------------------------------------- roofs

function garageRoofTexture(w: number, d: number): CanvasTexture {
  const [c, ctx] = canvasOf(w, d);
  fillRect(ctx, 0, 0, w, d, "#b4b8c0");
  for (let x = 6; x < w - 2; x += 8) {
    fillRect(ctx, x, 0, 1, d, "#9a9ea8");
    fillRect(ctx, x + 1, 0, 1, d, "#c8ccd4");
  }
  for (let i = 0; i < 220; i++) {
    const px = (i * 53) % w;
    const py = (i * 29 + ((i * i) % 7)) % d;
    fillRect(ctx, px, py, 1, 1, i % 3 ? "#a2a6b0" : "#c0c4cc");
  }
  fillRect(ctx, 0, 0, w, 2, "#d6d9e0");
  fillRect(ctx, 0, d - 2, w, 2, "#8b909a");
  // CMR logo: only the black and red parts, straight onto the roof
  const lw = CMR_LOGO[0].length;
  const lh = CMR_LOGO.length;
  const lx = Math.floor((w - lw) / 2);
  const ly = Math.floor((d - lh) / 2);
  CMR_LOGO.forEach((row, y) => {
    for (let x = 0; x < lw; x++) {
      const key = row[x];
      if (key === "k") fillRect(ctx, lx + x, ly + y, 1, 1, "#16161d");
      else if (key === "r") fillRect(ctx, lx + x, ly + y, 1, 1, "#a51c30");
    }
  });
  return nearestTexture(c);
}

function zoneRoofTexture(w: number, d: number, zone: Zone): CanvasTexture {
  const accent = zone.accent;
  const dark = shade(accent, -0.35);
  const light = shade(accent, 0.25);
  const [c, ctx] = canvasOf(w, d);
  fillRect(ctx, 0, 0, w, d, accent);
  for (let y = 4; y < d; y += 4) fillRect(ctx, 0, y, w, 1, dark);
  for (let x = 4; x < w; x += 8) fillRect(ctx, x, 0, 1, d, dark);
  fillRect(ctx, 0, 0, w, 2, light);
  fillRect(ctx, 0, d - 2, w, 2, dark);
  const ex = Math.floor(w / 2);
  const ey = Math.floor(d / 2);
  disc(ctx, ex, ey, 14, "#16161d");
  disc(ctx, ex, ey, 12, "#f4f4f4");
  if (zone.kind === "contact") {
    fillRect(ctx, ex - 9, ey - 6, 18, 12, "#16161d");
    fillRect(ctx, ex - 8, ey - 5, 16, 10, "#f4f4f4");
    for (let i = 0; i < 8; i++) {
      fillRect(ctx, ex - 8 + i, ey - 5 + i, 1, 1, accent);
      fillRect(ctx, ex + 7 - i, ey - 5 + i, 1, 1, accent);
    }
  } else if (zone.kind === "gallery") {
    disc(ctx, ex, ey, 8, "#2a2d38");
    disc(ctx, ex, ey, 5, "#2f74e0");
    fillRect(ctx, ex - 3, ey - 3, 2, 2, "#cfe6ff");
  } else {
    disc(ctx, ex, ey, 9, accent);
    disc(ctx, ex, ey, 4, "#f4f4f4");
    fillRect(ctx, ex - 1, ey - 11, 2, 22, accent);
    fillRect(ctx, ex - 11, ey - 1, 22, 2, accent);
    disc(ctx, ex, ey, 2, "#f4f4f4");
  }
  return nearestTexture(c);
}

// ---------------------------------------------------------------- buildings

const WALL = "#d8dbe2";
const DARK = new MeshBasicMaterial({ color: "#14161c" });

/** CMR garage: grey box with the logo roof and one wide opening in its east (+x) wall. */
export function garageModel(w: number, d: number): Group {
  const g = new Group();
  const H = 24;
  const t = 2;
  const roofW = 84; // roofed workshop on the west; the rest is an open-top pit bay facing east
  const x0 = -w / 2;
  const hz = d / 2;
  const cx = x0 + roofW / 2;
  const bayW = w - roofW;
  const bayX = x0 + roofW + bayW / 2;

  // roofed block: closed walls, dark inside
  g.add(box(roofW, H, t, WALL, cx, 0, -hz + t / 2)); // north
  g.add(box(roofW, H, t, WALL, cx, 0, hz - t / 2)); // south
  g.add(box(t, H, d - 2 * t, WALL, x0 + t / 2, 0, 0)); // west
  const doorW = 22;
  const doorH = 17;
  const side = (d - doorW) / 2 - t;
  const ex = x0 + roofW - t / 2; // east wall of the block, facing the bay
  g.add(box(t, H, side, WALL, ex, 0, -(doorW / 2 + side / 2)));
  g.add(box(t, H, side, WALL, ex, 0, doorW / 2 + side / 2));
  g.add(box(t, H - doorH, doorW, WALL, ex, doorH, 0));
  const interior = mesh(new BoxGeometry(roofW - 2 * t - 1, H - 1, d - 2 * t), DARK, cx, (H - 1) / 2, 0);
  interior.castShadow = false;
  g.add(interior);
  const roll = cyl(2, 2, doorW, "#b8bcc4", ex + 1, doorH - 0.5, 0, 10); // rolled-up door
  roll.rotation.x = Math.PI / 2;
  roll.position.y = doorH - 0.5;
  g.add(roll);

  // open bay: floor, back wall, low front curb, gear against the back wall
  g.add(box(bayW, 1, d, "#30333c", bayX, 0, 0));
  g.add(box(bayW, H, t, WALL, bayX, 1, -hz + t / 2));
  g.add(box(bayW, 4, t, "#d9b21f", bayX, 1, hz - t / 2));
  g.add(box(7, 8, 5, "#d8322c", bayX - 7, 1, -hz + t + 3)); // toolbox
  g.add(box(2, 14, 12, "#4a4d57", bayX + 6, 1, -hz + t + 7)); // shelf
  g.add(box(2.4, 2, 3, "#f6d02a", bayX + 6, 9, -hz + t + 6));
  g.add(box(6, 0.6, 6, "#f4f4f4", bayX - 6, 1, 4)); // painted pad mark
  g.add(box(1, 0.6, 14, "#f6d02a", bayX + bayW / 2 - 2, 1, 0)); // threshold stripe

  // roof slab over the block with a slight overhang; the logo is painted on its top face
  const rw = roofW + 4;
  const rd = d + 4;
  const top = new MeshToonMaterial({ map: garageRoofTexture(rw, rd), gradientMap: gradient });
  const roof = mesh(new BoxGeometry(rw, 3, rd), top, cx, H + 1.5, 0);
  roof.material = withTop(toon("#9a9ea8"), top);
  g.add(roof);
  return g;
}

/** Generic project building: grey walls, accent roof with an emblem, door and windows on the south face. */
export function buildingModel(w: number, d: number, zone: Zone): Group {
  const g = new Group();
  const H = 34;
  const hz = d / 2;
  g.add(box(w, H, d, WALL, 0, 0, 0));
  const rw = w + 4;
  const rd = d + 4;
  const top = new MeshToonMaterial({ map: zoneRoofTexture(rw, rd, zone), gradientMap: gradient });
  const roof = mesh(new BoxGeometry(rw, 4, rd), top, 0, H + 2, 0);
  roof.material = withTop(toon(shade(zone.accent, -0.3)), top);
  g.add(roof);
  // door + windows on the south (+z) face
  g.add(box(18, 22, 1.5, "#16161d", 0, 0, hz + 0.5));
  g.add(box(14, 20, 1.6, "#5a6a8a", 0, 0, hz + 0.9));
  g.add(box(1.4, 20, 1.7, "#16161d", 0, 0, hz + 1));
  for (const wx of [-w / 2 + 18, w / 2 - 18]) {
    g.add(box(16, 12, 1.5, "#16161d", wx, 14, hz + 0.5));
    g.add(box(14, 10, 1.6, "#8fdcff", wx, 15, hz + 0.9));
  }
  return g;
}

// ---------------------------------------------------------------- vehicles

export function roadCarModel(): Group {
  const g = new Group();
  g.add(box(16, 3.2, 8, "#d8322c", 0, 1.8, 0)); // body
  g.add(box(7, 3, 6.4, "#8fdcff", -1.5, 5, 0)); // cabin glass
  g.add(box(7.4, 0.8, 6.8, "#d8322c", -1.5, 8, 0)); // roof
  g.add(box(15.5, 0.4, 1.6, "#f4f4f4", 0, 5, 0)); // stripe
  g.add(box(0.6, 1.4, 1.6, "#f6d02a", 8, 3, -2.6));
  g.add(box(0.6, 1.4, 1.6, "#f6d02a", 8, 3, 2.6));
  g.add(box(0.6, 1.2, 1.6, "#ff5a4a", -8, 3, -2.6));
  g.add(box(0.6, 1.2, 1.6, "#ff5a4a", -8, 3, 2.6));
  for (const x of [-5, 5]) for (const z of [-4.4, 4.4]) g.add(wheel(2.2, 2, x, 2.2, z));
  return g;
}

/** Number roundel on the nose: white disc, black ring, "46". */
function roundelTexture(): CanvasTexture {
  const [c, ctx] = canvasOf(14, 14);
  disc(ctx, 7, 7, 7, "#16161d");
  disc(ctx, 7, 7, 6, "#f4f4f4");
  const digits: Record<string, string[]> = {
    "4": ["1.1", "1.1", "111", "..1", "..1"],
    "6": ["111", "1..", "111", "1.1", "111"],
  };
  let x0 = 3;
  for (const ch of "46") {
    digits[ch].forEach((row, y) => {
      for (let x = 0; x < 3; x++) if (row[x] === "1") fillRect(ctx, x0 + x, 4 + y, 1, 1, "#16161d");
    });
    x0 += 5;
  }
  return nearestTexture(c);
}

/** Parked CMR formula car (red/black, number 46), nose pointing +x.
 *  Proportions are exaggerated so it reads from afar: wheels pushed far outboard, huge wings, long thin nose,
 *  light hubs/wings against the dark asphalt. */
export function formulaModel(): Group {
  const RED = "#d02a2c";
  const BLACK = "#1b1b22";
  const WING = "#dfe2e8";
  const HUB = "#aab0bc";
  const car = new Group();

  // front wing: wide white plane, black rear element, tall red endplates
  car.add(box(3.4, 0.7, 18.5, WING, 23.5, 0.8, 0));
  car.add(box(1.4, 0.7, 16.5, BLACK, 21, 1.5, 0));
  car.add(box(4.4, 3, 0.8, RED, 23.4, 0.8, -9.2));
  car.add(box(4.4, 3, 0.8, RED, 23.4, 0.8, 9.2));

  // long, thin nose cone and the monocoque
  car.add(box(4.5, 1.8, 1.8, RED, 19.5, 1.2, 0));
  car.add(box(7, 2.4, 3.2, RED, 13.5, 1.2, 0));
  car.add(box(14, 3.4, 5.6, RED, 3, 1.2, 0));
  car.add(box(5, 0.3, 0.9, BLACK, -2, 4.6, 0)); // black stripe behind the roundel
  const roundel = new Mesh(new PlaneGeometry(5.4, 5.4), new MeshBasicMaterial({ map: roundelTexture() }));
  roundel.rotation.x = -Math.PI / 2;
  const holder = new Group();
  holder.add(roundel);
  holder.rotation.y = Math.PI / 2; // digits read upright from the front
  holder.position.set(9, 4.12, 0);
  car.add(holder);

  // slim sidepods, clear of the wheels so daylight shows between them
  for (const z of [-4.8, 4.8]) {
    car.add(box(11, 3, 2.8, RED, -2.5, 1.2, z));
    car.add(box(11, 0.3, 0.8, BLACK, -2.5, 4.2, z));
    car.add(box(2.4, 3, 2.8, BLACK, 4.2, 1.2, z));
  }

  // engine cover and rear bodywork: closes the tail between the sidepods and the rear wing
  car.add(box(10, 3.8, 4.4, RED, -10.5, 1.4, 0));
  car.add(box(8, 0.3, 1.2, BLACK, -10.5, 5.2, 0)); // black stripe on the engine cover
  car.add(box(3, 2.4, 2.8, BLACK, -7.8, 5.2, 0)); // airbox behind the driver
  car.add(box(4, 2.6, 3.4, BLACK, -15.5, 1.2, 0)); // crash structure under the rear wing

  // driver: red suit, bright helmet with a dark visor
  car.add(box(3.8, 3.4, 4.2, RED, -1, 4.2, 0));
  car.add(mesh(new SphereGeometry(2.5, 8, 6), toon("#f0f2f5"), -1, 8.6, 0));
  car.add(box(1.4, 1.1, 3, BLACK, 0.9, 8.7, 0));
  car.add(box(0.8, 0.8, 3.4, BLACK, 5, 5.4, 0)); // steering wheel

  // roll hoop
  car.add(box(0.8, 6.4, 0.8, BLACK, -5, 4.4, -2.5));
  car.add(box(0.8, 6.4, 0.8, BLACK, -5, 4.4, 2.5));
  car.add(box(0.8, 0.8, 5.8, BLACK, -5, 10.6, 0));

  // rear wing: tall, wide white plane with red endplates on black posts
  car.add(box(5, 0.8, 15, WING, -17, 9.6, 0));
  car.add(box(5.4, 5.8, 0.8, RED, -17, 5.2, -7.6));
  car.add(box(5.4, 5.8, 0.8, RED, -17, 5.2, 7.6));
  car.add(box(0.8, 5.4, 0.8, BLACK, -15, 4.4, -2.2));
  car.add(box(0.8, 5.4, 0.8, BLACK, -15, 4.4, 2.2));

  // four slick tires pushed well outboard, light hubs on the outer faces, grey suspension arms
  for (const z of [-1, 1]) {
    car.add(wheel(3.3, 3.4, 13, 3.3, z * 8.3));
    car.add(wheel(3.9, 4.6, -10, 3.9, z * 8.6));
    for (const [x, y, zz, r, th] of [
      [13, 3.3, 8.3 + 1.8, 1.5, 0.4],
      [-10, 3.9, 8.6 + 2.4, 1.8, 0.4],
    ] as const) {
      const hub = cyl(r, r, th, HUB, x, y - th / 2, z * zz, 10);
      hub.rotation.x = Math.PI / 2;
      hub.position.y = y;
      car.add(hub);
    }
    car.add(box(1, 0.6, 4.4, "#8b909a", 13, 3.2, z * 5.6));
    car.add(box(1, 0.6, 4.6, "#8b909a", -10, 3.8, z * 5.8));
  }

  car.position.x = -3; // center the whole model on its footprint
  const g = new Group();
  g.add(car);
  return g;
}

// ---------------------------------------------------------------- props

const CONE: Record<string, string> = { o: "#f08a1c", b: "#2f74e0", y: "#f6d02a" };

export function coneModel(key: string): Group {
  const g = new Group();
  const color = CONE[key] ?? CONE.o;
  g.add(box(7.5, 0.9, 7.5, shade(color, -0.45), 0, 0, 0));
  g.add(mesh(new ConeGeometry(3.3, 8.5, 8), toon(color), 0, 0.9 + 4.25, 0));
  g.add(cyl(2.0, 2.5, 1.8, "#f4f4f4", 0, 3.4, 0, 8)); // reflective band
  return g;
}

export function personModel(key: string): Group {
  const looks: Record<string, [string, string]> = {
    r: ["#d8322c", "#f4f4f4"],
    w: ["#f4f4f4", "#d8322c"],
    b: ["#2f74e0", "#16161d"],
  };
  const [shirt, cap] = looks[key] ?? looks.r;
  const g = new Group();
  g.add(box(1.5, 4.5, 1.5, "#2a3a6a", -1.1, 0, 0));
  g.add(box(1.5, 4.5, 1.5, "#2a3a6a", 1.1, 0, 0));
  g.add(box(4.4, 5, 2.6, shirt, 0, 4.5, 0));
  g.add(box(1, 4, 1.2, shirt, -2.7, 5, 0));
  g.add(box(1, 4, 1.2, shirt, 2.7, 5, 0));
  g.add(box(3.2, 3, 3.2, "#e8b890", 0, 9.5, 0));
  g.add(box(3.6, 1.2, 3.6, cap, 0, 12, 0));
  return g;
}

export function batteryModel(): Group {
  const g = new Group();
  g.add(box(8, 5, 5, "#4a4d57", 0, 0, 0));
  g.add(box(5, 0.6, 3, "#f6d02a", 0, 5, 0));
  g.add(box(1, 1, 1, "#d8322c", 2.5, 5, 1.6));
  g.add(box(1, 1, 1, "#2f74e0", -2.5, 5, 1.6));
  return g;
}

export function tireStackModel(): Group {
  const g = new Group();
  for (let k = 0; k < 3; k++) g.add(cyl(4.4, 4.6, 2.4, "#26262c", 0, k * 2.5, 0, 12));
  g.add(cyl(2, 2, 0.3, "#8b909a", 0, 7.5, 0, 10));
  return g;
}

/** One yard tire lying flat. */
export function tireModel(): Group {
  const g = new Group();
  g.add(cyl(6.4, 6.6, 4.4, "#26262c", 0, 0, 0, 14));
  g.add(cyl(3, 3, 0.4, "#8b909a", 0, 4.4, 0, 10));
  return g;
}

export function laptopModel(): Group {
  const g = new Group();
  g.add(box(7, 0.8, 5, "#b8bcc4", 0, 0, 0));
  const screen = box(7, 4.5, 0.6, "#4a4d57", 0, 0, 0);
  screen.position.set(0, 2.9, -2.4);
  screen.rotation.x = -0.35;
  g.add(screen);
  const glass = box(6, 3.6, 0.3, "#8fdcff", 0, 0, 0);
  glass.position.set(0, 2.9, -2.05);
  glass.rotation.x = -0.35;
  g.add(glass);
  return g;
}

export function hazardWallTexture(): CanvasTexture {
  const [c, ctx] = canvasOf(16, 16);
  fillRect(ctx, 0, 0, 16, 16, "#24252b");
  ctx.fillStyle = "#d9b21f";
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (((x + y) >> 2) % 2 === 0) ctx.fillRect(x, y, 1, 1);
  return nearestTexture(c);
}

/** Build the model for a scene prop id, sized to its collision footprint. */
export function createModel(id: string, footprint: Footprint | undefined, zones: Zone[]): Group {
  const w = footprint?.kind === "rect" ? footprint.w : 0;
  const d = footprint?.kind === "rect" ? footprint.h : 0;
  if (id === "garage") return garageModel(w, d);
  if (id.startsWith("bld:")) return buildingModel(w, d, zones.find((z) => z.id === id.slice(4))!);
  if (id.startsWith("cone-")) return coneModel(id.slice(5));
  if (id.startsWith("person-")) return personModel(id.slice(7));
  switch (id) {
    case "formula":
      return formulaModel();
    case "battery":
      return batteryModel();
    case "tirestack":
      return tireStackModel();
    case "laptop":
      return laptopModel();
  }
  throw new Error(`Unknown model: ${id}`);
}
