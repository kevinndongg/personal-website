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
  LinearFilter,
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

const RAMP = 48;
const gradient = new DataTexture(
  new Uint8Array(Array.from({ length: RAMP }, (_, i) => Math.round(70 + (185 * i) / (RAMP - 1)))),
  RAMP,
  1,
  RedFormat
);
gradient.minFilter = LinearFilter;
gradient.magFilter = LinearFilter;
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

  // open bay: floor and a low front curb; no back wall, so the crew can reach the car from either side
  g.add(box(bayW, 1, d, "#30333c", bayX, 0, 0));
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

// ---------------------------------------------------------------- team props (Racing area dressing)
// Origin = center of the footprint on the ground, +x = front. Sizes follow the footprint passed to createModel.

const STEEL = "#8b909a";
const DKGREY = "#4a4d57";
const NEAR_BLACK = "#1b1b22";

/** Low counter along z with small timing screens facing +x. */
export function pitWallModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 5, d, "#d8dbe2", 0, 0, 0));
  g.add(box(w + 0.6, 0.8, d + 0.6, STEEL, 0, 5, 0));
  g.add(box(w + 0.2, 1.4, d + 0.2, "#d02a2c", 0, 1.2, 0)); // red stripe along the counter
  const screens = Math.max(2, Math.floor(d / 14));
  for (let i = 0; i < screens; i++) {
    const z = -d / 2 + (d * (i + 0.5)) / screens;
    g.add(box(0.8, 4.4, 6.4, NEAR_BLACK, 1, 5.8, z));
    g.add(box(0.4, 3.4, 5.4, "#7fd6ff", 1.5, 6.2, z)); // lit screen
    g.add(box(1.6, 0.8, 1.6, STEEL, 0.6, 5.8, z)); // stand
  }
  g.add(box(2, 1.2, 2.6, NEAR_BLACK, -1, 5.8, d / 2 - 4)); // headset
  return g;
}

/** Tripod with a spinning-LiDAR puck on top. */
export function lidarModel(): Group {
  const g = new Group();
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const leg = box(0.8, 9, 0.8, STEEL, Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4);
    leg.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28);
    g.add(leg);
  }
  g.add(cyl(0.7, 0.7, 4, DKGREY, 0, 8, 0, 8)); // mast
  g.add(cyl(3, 3, 3.6, NEAR_BLACK, 0, 11.6, 0, 12)); // sensor body
  g.add(cyl(3.2, 3.2, 0.8, "#7fd6ff", 0, 13, 0, 12)); // window band
  g.add(cyl(2.4, 2.4, 1, DKGREY, 0, 15.2, 0, 12));
  return g;
}

/** Yellow emergency-stop box with a red mushroom button. */
export function estopModel(): Group {
  const g = new Group();
  g.add(box(7, 5, 6, "#f6d02a", 0, 0, 0));
  g.add(box(7.4, 0.8, 6.4, NEAR_BLACK, 0, 0, 0));
  g.add(cyl(1.8, 1.8, 2, "#d02a2c", 0, 5, 0, 10));
  g.add(cyl(2.4, 2.4, 0.5, NEAR_BLACK, 0, 5, 0, 10));
  return g;
}

/** Small utility cart with a laptop on it. */
export function cartModel(): Group {
  const g = new Group();
  for (const [x, z] of [
    [-5, -3],
    [5, -3],
    [-5, 3],
    [5, 3],
  ])
    g.add(box(0.9, 5, 0.9, STEEL, x, 0.8, z));
  g.add(box(12, 1, 8, DKGREY, 0, 5.4, 0));
  g.add(box(10, 0.8, 6, "#b8bcc4", 0, 4, 0)); // lower shelf
  const lap = laptopModel();
  lap.position.set(0, 6.4, 0);
  g.add(lap);
  for (const [x, z] of [
    [-5, -3.6],
    [5, -3.6],
    [-5, 3.6],
    [5, 3.6],
  ])
    g.add(cyl(0.9, 0.9, 0.8, NEAR_BLACK, x, 0, z, 6));
  return g;
}

export function toolChestModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 12, d, "#d02a2c", 0, 2, 0));
  g.add(box(w + 0.4, 1, d + 0.4, NEAR_BLACK, 0, 14, 0));
  for (let i = 0; i < 3; i++) g.add(box(0.5, 0.6, d - 2, NEAR_BLACK, w / 2 + 0.1, 4.5 + i * 3.2, 0)); // drawer lines
  g.add(box(0.6, 0.6, 4, "#d8dbe2", w / 2 + 0.2, 11.6, 0));
  for (const x of [-w / 2 + 1.4, w / 2 - 1.4])
    for (const z of [-d / 2 + 1.2, d / 2 - 1.2]) g.add(cyl(1, 1, 2, NEAR_BLACK, x, 0, z, 6));
  return g;
}

/** Team transport: a white box truck with a red band and a checkered cab, towing an open trailer with a car chassis.
 *  +x = front (cab), length w, width d. */
/** Pop-up canopy: tall legs, striped valance and a peaked striped roof so it reads as a tent. */
export function tentModel(w: number, d: number): Group {
  const g = new Group();
  const [c, ctx] = canvasOf(16, 4);
  for (let i = 0; i < 8; i++) fillRect(ctx, i * 2, 0, 2, 4, i % 2 ? "#f4f4f4" : "#d02a2c");
  const tex = nearestTexture(c);
  const stripe = new MeshToonMaterial({ map: tex, gradientMap: gradient });

  const legH = 17;
  for (const x of [-w / 2 + 1, w / 2 - 1])
    for (const z of [-d / 2 + 1, d / 2 - 1]) g.add(box(1.2, legH, 1.2, STEEL, x, 0, z));
  g.add(mesh(new BoxGeometry(w + 1, 4, d + 1), stripe, 0, legH + 2, 0)); // striped valance
  const roof = new ConeGeometry((Math.max(w, d) / 2 + 0.5) * Math.SQRT2, 15, 4, 1, false);
  roof.rotateY(Math.PI / 4);
  g.add(mesh(roof, stripe, 0, legH + 4 + 7.5, 0));
  g.add(cyl(0.6, 0.6, 2.4, STEEL, 0, legH + 4 + 15, 0, 6)); // finial
  g.add(box(w - 6, 0.6, d - 6, "#2c2f38", 0, 0, 0)); // shade under the tent
  return g;
}

/** Spare slicks stacked on a yellow pallet. */
export function tireRackModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 1.6, d, "#f6d02a", 0, 0, 0));
  g.add(box(w + 0.4, 0.5, 1.2, NEAR_BLACK, 0, 0.6, d / 2 - 1.4));
  g.add(box(w + 0.4, 0.5, 1.2, NEAR_BLACK, 0, 0.6, -d / 2 + 1.4));
  const stacks = Math.max(2, Math.floor(w / 9));
  for (let i = 0; i < stacks; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / stacks;
    for (let k = 0; k < 3; k++) g.add(cyl(4.4, 4.5, 2.6, "#26262c", x, 1.6 + k * 2.7, 0, 12));
    g.add(cyl(2, 2, 0.4, "#8b909a", x, 1.6 + 3 * 2.7, 0, 10)); // hub on the top tire
  }
  return g;
}

/** Someone sitting on the ground, facing +x. */
export function sittingPersonModel(key: string): Group {
  const looks: Record<string, [string, string]> = {
    r: ["#d8322c", "#f4f4f4"],
    w: ["#f4f4f4", "#d8322c"],
    b: ["#2f74e0", "#16161d"],
  };
  const [shirt, cap] = looks[key] ?? looks.r;
  const g = new Group();
  g.add(box(4.4, 4.6, 2.8, shirt, -1, 0.8, 0)); // torso
  g.add(box(3.2, 3, 3.2, "#e8b890", -1, 5.4, 0)); // head
  g.add(box(3.6, 1.2, 3.6, cap, -1, 7.9, 0)); // cap
  for (const z of [-1.2, 1.2]) g.add(box(5.6, 1.6, 1.6, "#2a3a6a", 3, 0, z)); // legs out front
  for (const z of [-2.6, 2.6]) g.add(box(2.6, 1.2, 1, shirt, 1, 2.4, z)); // arms
  return g;
}

/** Wall-mounted extinguisher (bracket on the -z side, which sits against the wall). */
export function extinguisherModel(): Group {
  const g = new Group();
  g.add(cyl(1.3, 1.3, 6, "#d02a2c", 0, 0, 0, 8));
  g.add(cyl(0.5, 0.5, 1.2, NEAR_BLACK, 0, 6, 0, 6));
  g.add(box(2, 0.5, 0.6, NEAR_BLACK, 0.9, 7, 0));
  g.add(box(2.4, 1, 0.6, STEEL, 0, 3.2, -1.5));
  g.add(box(1.8, 1.4, 0.2, "#f4f4f4", 0, 4.8, 1.35)); // label
  return g;
}

/** Animation context handed to `userData.animate` callbacks each frame. */
export interface AnimCtx {
  t: number; // seconds (0 when reduced motion is on)
  hover: number; // 0..1, how hovered this model's project box is
  pixel: number; // world height of one rendered pixel, for stepping motion in whole pixels
}

/** Team box truck (no trailer): white box, red band, checkered cab. +x = front (cab), length w, width d. */
export function trailerModel(w: number, d: number): Group {
  const g = new Group();
  const RED = "#d02a2c";
  const x0 = -w / 2;
  const cargoLen = w - 22;
  const cargoX = x0 + 1;
  const cc = cargoX + cargoLen / 2;

  g.add(box(cargoLen, 2, 16, "#2c2f38", cc, 2, 0)); // underframe
  g.add(box(cargoLen, 22, d - 4, "#f4f4f4", cc, 4, 0)); // cargo box
  g.add(box(cargoLen + 0.4, 6, d - 3.6, RED, cc, 11, 0)); // red band
  g.add(box(cargoLen + 0.6, 1.2, d - 3.4, "#9a9ea8", cc, 26, 0)); // roof lip
  g.add(box(0.5, 16, 0.5, "#8b909a", cargoX + 0.4, 6, 0)); // rear door seam

  const cabX = cargoX + cargoLen;
  g.add(box(14, 15, d - 6, "#f4f4f4", cabX + 7, 4, 0)); // cab
  g.add(box(0.6, 6, d - 10, "#7fd6ff", cabX + 14.1, 10, 0)); // windshield
  g.add(box(6, 8, d - 8, "#f4f4f4", cabX + 17, 3, 0)); // hood
  g.add(box(6.2, 0.5, 4, RED, cabX + 17, 11, 4)); // hood stripes
  g.add(box(6.2, 0.5, 4, RED, cabX + 17, 11, -4));
  g.add(box(2, 3, d - 6, "#b8bcc4", cabX + 20.4, 2, 0)); // bumper
  g.add(box(0.5, 1.4, 2, "#f6d02a", cabX + 20.3, 7, 6));
  g.add(box(0.5, 1.4, 2, "#f6d02a", cabX + 20.3, 7, -6));
  // checkered graphic on the cab doors (both sides)
  const [c, ctx] = canvasOf(12, 8);
  for (let y = 0; y < 8; y += 2)
    for (let x = 0; x < 12; x += 2) fillRect(ctx, x, y, 2, 2, (x + y) % 4 === 0 ? RED : "#f4f4f4");
  const check = nearestTexture(c);
  for (const side of [1, -1]) {
    const m = new Mesh(new PlaneGeometry(10, 7), new MeshBasicMaterial({ map: check }));
    m.position.set(cabX + 7, 9, (side * (d - 6)) / 2 + side * 0.05);
    m.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(m);
  }
  for (const z of [-1, 1]) {
    g.add(wheel(4.4, 4, cc - 8, 4.4, z * (d / 2 - 1.4)));
    g.add(wheel(4.4, 4, cc + 2, 4.4, z * (d / 2 - 1.4)));
    g.add(wheel(4.2, 3.4, cabX + 12, 4.2, z * (d / 2 - 2.6)));
  }
  return g;
}

/** Barrel grill with one patty cooking over glowing embers, smoke above it and a side table with buns. */
export function grillModel(): Group {
  const g = new Group();
  for (const a of [0.6, 2.7, 4.8]) g.add(box(0.9, 5, 0.9, STEEL, Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4)); // legs
  g.add(cyl(5.2, 4, 4, NEAR_BLACK, 0, 5, 0, 12)); // bowl
  g.add(cyl(4.2, 4.2, 0.4, "#f08a1c", 0, 8.4, 0, 12)); // embers
  g.add(cyl(5, 5, 0.5, "#8b909a", 0, 8.9, 0, 12)); // grate
  const lid = box(10, 0.8, 6, NEAR_BLACK, 0, 0, 0);
  lid.position.set(0, 12, -6);
  lid.rotation.x = -0.9;
  g.add(lid); // lid propped open behind the grate
  // side table with buns
  g.add(box(9, 0.8, 7, "#b08a5a", 11, 5, 0));
  for (const [x, z] of [
    [7.5, -2.8],
    [14.5, -2.8],
    [7.5, 2.8],
    [14.5, 2.8],
  ])
    g.add(box(0.8, 5, 0.8, STEEL, x, 0, z));
  for (const z of [-1.8, 1.8]) g.add(box(3.4, 1.6, 3, "#e0b060", 11, 5.8, z));

  // the patty under the spatula: hops and flips in time with the cook, once every 3 seconds
  const flip = new Group();
  flip.position.set(-1, 9.7, 0);
  flip.add(box(3.8, 1.1, 3.8, "#8a5530", 0, -0.55, 0)); // browned side
  flip.add(box(3.8, 0.5, 3.8, "#3e2412", 0, -0.85, 0)); // other side, darker
  g.add(flip);

  // smoke rising from the patty: slow, small and well above the grate so it reads as smoke, not food
  const puffs: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const puff = mesh(new BoxGeometry(2.2, 2.2, 2.2), toon("#d6dae2"), 0, 14, 0);
    puff.castShadow = false;
    g.add(puff);
    puffs.push(puff);
  }
  const hop = [1, 2, 3, 3, 2, 1]; // whole-pixel heights through the flip
  g.userData.animate = ({ t, pixel }: AnimCtx) => {
    const steps = 5;
    puffs.forEach((puff, i) => {
      const k = (t * 2 + i * 2) % steps; // drifts up continuously, restarts every 2.5 s
      // starts above and slightly behind the patty so it never covers it from the camera's side
      puff.position.set(-1 + Math.sin(i * 1.9 + k * 0.5) * 1.2, 15 + k * 3, -2.6 + Math.cos(i * 1.9) * 1.2);
      puff.scale.setScalar(Math.max(0.2, 1 - k / (steps + 1)));
    });
    // once every 3 seconds the patty hops (an arc) and turns over, then lands on its other side
    const p = t % 3;
    const cycle = Math.floor(t / 3);
    const u = Math.min(1, Math.max(0, (p - 2.2) / 0.6));
    flip.position.y = 9.6 + Math.sin(Math.PI * u) * 6;
    flip.rotation.x = (cycle % 2) * Math.PI + Math.PI * u;
  };
  return g;
}

/** Cook in a white apron and chef hat; faces +x (toward the grill) and flips the patty in front of them. */
export function cookModel(): Group {
  const g = new Group();
  g.add(box(1.5, 4.5, 1.5, "#2a3a6a", -1.1, 0, 0));
  g.add(box(1.5, 4.5, 1.5, "#2a3a6a", 1.1, 0, 0)); // legs
  g.add(box(4.4, 5, 2.8, "#d8322c", 0, 4.5, 0)); // shirt
  g.add(box(0.5, 4.6, 2.4, "#f4f4f4", 2.3, 4.2, 0)); // apron
  g.add(box(3.2, 3, 3.2, "#e8b890", 0, 9.5, 0)); // head
  g.add(box(3.8, 1.2, 3.8, "#f4f4f4", 0, 12.4, 0)); // hat band
  g.add(box(3.4, 2.8, 3.4, "#f4f4f4", 0, 13.6, 0)); // hat top
  g.add(box(1, 4, 1.2, "#d8322c", 0, 4.8, -2.7)); // idle arm
  const arm = new Group();
  arm.position.set(2.2, 8.4, 0); // shoulder, reaching straight ahead
  arm.add(box(4.6, 1.1, 1.3, "#d8322c", 2.3, -0.55, 0)); // forearm
  arm.add(box(3, 0.4, 2.2, "#b8bcc4", 6.1, -0.2, 0)); // spatula
  g.add(arm);
  g.userData.animate = ({ t }: AnimCtx) => {
    const p = t % 3;
    const u = Math.min(1, Math.max(0, (p - 2.1) / 0.7));
    arm.rotation.z = -0.12 + Math.sin(Math.PI * u) * 0.62; // spatula goes under the patty, lifts, drops
  };
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
  if (id.startsWith("sit-")) return sittingPersonModel(id.slice(4));
  switch (id) {
    case "pitwall":
      return pitWallModel(w, d);
    case "lidar":
      return lidarModel();
    case "estop":
      return estopModel();
    case "cart":
      return cartModel();
    case "trailer":
      return trailerModel(w, d);
    case "tent":
      return tentModel(w, d);
    case "tirerack":
      return tireRackModel(w, d);
    case "toolchest":
      return toolChestModel(w, d);
    case "extinguisher":
      return extinguisherModel();
    case "grill":
      return grillModel();
    case "cook":
      return cookModel();
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
