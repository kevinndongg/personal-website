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
} from "three";
import type { BufferGeometry, Material } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import cmrLogo from "../content/projects/CMR_Logo.png";
import { carWatch } from "./drive";
import { crewDoor } from "./errand";
import type { WalkerPose } from "./errand";
import { shade } from "./ground";
import { GARAGE_DOOR } from "./scenes";
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
export function toon(color: string): MeshToonMaterial {
  let m = toonCache.get(color);
  if (!m) {
    m = new MeshToonMaterial({ color, gradientMap: gradient });
    toonCache.set(color, m);
  }
  return m;
}

export function mesh(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Box sitting on `y` (its bottom face), centered on x/z. */
export function box(w: number, h: number, d: number, color: string | Material, x: number, y: number, z: number): Mesh {
  const mat = typeof color === "string" ? toon(color) : color;
  return mesh(new BoxGeometry(w, h, d), mat, x, y + h / 2, z);
}

/** Like `box()`, with softly rounded edges (radius `r`) so it catches the light the way the car and cones do. */
function rbox(w: number, h: number, d: number, color: string, x: number, y: number, z: number, r = 0.5): Mesh {
  const rr = Math.min(r, w / 2, h / 2, d / 2);
  return mesh(new RoundedBoxGeometry(w, h, d, 2, rr), toon(color), x, y + h / 2, z);
}

export function cyl(rTop: number, rBottom: number, h: number, color: string, x: number, y: number, z: number, seg = 10): Mesh {
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

const CURB_GAP = [18, 52]; // see garageModel

const TEAM_RED = "#a51c30"; // the red of the CMR logo
const LOGO_ASPECT = 1571 / 4215; // of CMR_Logo.png

let logoTexture: CanvasTexture | undefined;
/** The team logo, from the real artwork: drawn at 2048 px wide (the original is wider than some GPUs allow), smooth and mipmapped. */
function cmrLogoTexture(): CanvasTexture {
  if (logoTexture) return logoTexture;
  const w = 2048;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.round(w * LOGO_ASPECT);
  const tex = new CanvasTexture(c);
  tex.anisotropy = 8;
  const img = new Image();
  img.onload = () => {
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    tex.needsUpdate = true;
  };
  img.src = cmrLogo.src;
  return (logoTexture = tex);
}

/** CMR garage: a roofed workshop with the logo on its roof and a roll-up door, opening onto an open pit bay to the east (+x). */
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
  const PLINTH = "#3a3d47";

  // roofed block: closed walls, dark inside
  g.add(rbox(roofW, H, t, WALL, cx, 0, -hz + t / 2)); // north
  // south, the wall that faces the tent: a side door (at GARAGE_DOOR.x) with a lintel over it
  const dl = GARAGE_DOOR.x - GARAGE_DOOR.w / 2; // the door's west and east edges
  const dr = GARAGE_DOOR.x + GARAGE_DOOR.w / 2;
  g.add(rbox(dl - x0, H, t, WALL, (x0 + dl) / 2, 0, hz - t / 2));
  g.add(rbox(x0 + roofW - dr, H, t, WALL, (dr + x0 + roofW) / 2, 0, hz - t / 2));
  g.add(rbox(GARAGE_DOOR.w, H - GARAGE_DOOR.h, t, WALL, GARAGE_DOOR.x, GARAGE_DOOR.h, hz - t / 2));
  g.add(rbox(t, H, d - 2 * t, WALL, x0 + t / 2, 0, 0)); // west
  const doorW = 22;
  const doorH = 17;
  const side = (d - doorW) / 2 - t;
  const ex = x0 + roofW - t / 2; // east wall of the block, facing the bay
  g.add(rbox(t, H, side, WALL, ex, 0, -(doorW / 2 + side / 2)));
  g.add(rbox(t, H, side, WALL, ex, 0, doorW / 2 + side / 2));
  g.add(rbox(t, H - doorH, doorW, WALL, ex, doorH, 0));
  const interior = mesh(new BoxGeometry(roofW - 2 * t - 1, H - 1, d - 2 * t), DARK, cx, (H - 1) / 2, 0);
  interior.castShadow = false;
  g.add(interior);

  // a dark plinth round the foot of the block and a team-red band near the top (a hair proud of the walls)
  const dressing = (h: number, y: number, color: string, aroundDoor: boolean) => {
    g.add(rbox(roofW + 0.4, h, t + 0.5, color, cx, y, -hz + t / 2));
    if (aroundDoor) {
      g.add(rbox(dl - x0 + 0.2, h, t + 0.5, color, (x0 - 0.2 + dl) / 2, y, hz - t / 2));
      g.add(rbox(x0 + roofW - dr + 0.2, h, t + 0.5, color, (dr + x0 + roofW + 0.2) / 2, y, hz - t / 2));
    } else g.add(rbox(roofW + 0.4, h, t + 0.5, color, cx, y, hz - t / 2));
    g.add(rbox(t + 0.5, h, d - 2 * t + 0.4, color, x0 + t / 2, y, 0));
    g.add(rbox(t + 0.5, h, d - 2 * t + 0.4, color, ex, y, 0));
  };
  dressing(1.6, 0, PLINTH, true); // (the plinth stops at the door)
  dressing(2.2, H - 4.4, TEAM_RED, false); // (the band runs on across the lintel, above the door)

  // the side door: light jambs, and a leaf on a hinge at the east jamb that swings out when the crew come through
  for (const x of [dl + 0.5, dr - 0.5]) g.add(rbox(1, GARAGE_DOOR.h, t + 0.6, "#b8bcc4", x, 0, hz - t / 2, 0.3));
  const hinge = new Group();
  hinge.position.set(dr - 1, 0, hz - t / 2);
  const leafW = GARAGE_DOOR.w - 2;
  hinge.add(rbox(leafW, GARAGE_DOOR.h - 0.6, 0.8, "#aeb4bf", -leafW / 2, 0, 0, 0.3));
  hinge.add(rbox(0.8, 1.6, 1.4, PLINTH, -leafW + 1, 8, 0, 0.3)); // handle
  g.add(hinge);
  let doorOpen = 0;
  let lastT = -1;
  g.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return;
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    doorOpen += (crewDoor.open - doorOpen) * (1 - Math.exp(-dt * 8));
    hinge.rotation.y = 1.7 * doorOpen; // (about +z: the free edge swings outward)
  };

  // roll-up door: a light frame, a dark housing above it on the bay side, and a slatted shutter part way down
  const bayFace = ex + t / 2; // the wall's face toward the bay
  for (const z of [-1, 1]) g.add(rbox(t + 0.6, doorH, 1.2, "#b8bcc4", ex, 0, z * (doorW / 2 - 0.6)));
  g.add(rbox(t + 0.6, 1.4, doorW, "#b8bcc4", ex, doorH - 1.4, 0));
  g.add(rbox(2.4, 3.2, doorW + 3, PLINTH, bayFace + 1.2, doorH - 0.4, 0, 0.8));
  for (let i = 0; i < 4; i++) g.add(rbox(0.8, 1.5, doorW - 2.4, "#c8ccd4", ex + 0.2, doorH - 3.4 - i * 1.8, 0, 0.3));

  // open bay: smooth floor and a low front curb; no back wall, so the crew can reach the car from either side
  g.add(rbox(bayW, 1, d, "#2c2f37", bayX, 0, 0, 0.4));
  // the curb has a gap (x from CURB_GAP[0] to CURB_GAP[1], from the garage's centre) where the car drives in after a lap
  for (const [a, b] of [
    [x0 + roofW, CURB_GAP[0]],
    [CURB_GAP[1], x0 + roofW + bayW],
  ]) {
    g.add(rbox(b - a, 4, t, "#d9b21f", (a + b) / 2, 1, hz - t / 2, 0.6));
  }
  g.add(rbox(7, 8, 5, "#d8322c", bayX - 7, 1, -hz + t + 3, 0.6)); // toolbox
  // painted lines: a parking box round the car's place, and a stripe across the mouth of the bay
  const line = (lw: number, ld: number, x: number, z: number, color: string) => g.add(box(lw, 0.12, ld, color, x, 1, z));
  const BOX_L = 46;
  const BOX_W = 22;
  for (const z of [-1, 1]) line(BOX_L, 0.8, bayX, z * BOX_W / 2, "#f4f4f4");
  for (const x of [-1, 1]) line(0.8, BOX_W + 0.8, bayX + x * BOX_L / 2, 0, "#f4f4f4");
  line(1, d - 8, bayX + bayW / 2 - 2, 0, "#f6d02a");

  // roof: a clean light slab with a slight overhang, a red lip along the bay side, and the logo lying on top, lit like the rest
  const rw = roofW + 4;
  const rd = d + 4;
  g.add(rbox(rw, 3, rd, "#e6e8ee", cx, H, 0, 0.9));
  g.add(rbox(1.4, 3.1, rd, TEAM_RED, cx + rw / 2 - 0.7, H - 0.05, 0, 0.5));
  const lw = 74;
  const logo = mesh(
    new PlaneGeometry(lw, lw * LOGO_ASPECT),
    new MeshToonMaterial({ map: cmrLogoTexture(), gradientMap: gradient, transparent: true, depthWrite: false }),
    cx - 0.7,
    H + 3.06,
    0
  );
  logo.rotation.x = -Math.PI / 2;
  logo.castShadow = false;
  logo.renderOrder = 1;
  g.add(logo);
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
  car.add(box(3, 2.4, 2.8, BLACK, -7.8, 5.2, 0)); // airbox behind the cockpit
  car.add(box(4, 2.6, 3.4, BLACK, -15.5, 1.2, 0)); // crash structure under the rear wing

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

/**
 * The crew member at the laptop (red shirt), facing +x, where the laptop is: he types, nodding at the screen now and then.
 * While the car is out on a lap he stops, lowers his arms and turns to follow it round, then goes back to work.
 */
export function typistModel(): Group {
  const SHIRT = "#d8322c";
  const g = new Group();
  g.add(box(1.5, 4.5, 1.5, "#2a3a6a", 0, 0, -1.1));
  g.add(box(1.5, 4.5, 1.5, "#2a3a6a", 0, 0, 1.1));
  g.add(box(2.6, 5, 4.4, SHIRT, 0, 4.5, 0));

  // two arms (side -1 is his left, the far one from the camera), each with an elbow: the upper arm hangs from the shoulder
  // and rotation.z swings it forward (+x); the forearm hangs from the elbow and bends further forward the same way
  const arms = [-1, 1].map((side) => {
    const upper = new Group();
    upper.name = side < 0 ? "upper-left" : "upper-right";
    upper.position.set(0, 9, side * 2.7);
    upper.add(box(1.2, 2.4, 1, SHIRT, 0, -2.4, 0));
    const forearm = new Group();
    forearm.name = side < 0 ? "forearm-left" : "forearm-right";
    forearm.position.set(0, -2.4, 0);
    forearm.add(box(1.2, 1.8, 1, SHIRT, 0, -1.8, 0));
    forearm.add(box(1.2, 0.8, 1, "#e8b890", 0, -2.6, 0)); // hand
    upper.add(forearm);
    g.add(upper);
    return { side, upper, forearm };
  });

  const head = new Group(); // pivots at the neck; rotation.z nods it forward
  head.position.set(0, 9.5, 0);
  head.add(box(3.2, 3, 3.2, "#e8b890", 0, 0, 0));
  head.add(box(3.6, 1.2, 3.6, "#f4f4f4", 0, 2.5, 0)); // cap
  head.add(box(1.6, 0.4, 3.2, "#f4f4f4", 2.4, 2.5, 0)); // its brim, which shows which way he faces
  for (const z of [-0.8, 0.8]) head.add(box(0.3, 0.6, 0.6, "#16161d", 1.6, 1.3, z));
  g.add(head);

  const REST = 0.06; // arms down at his sides
  const UPPER = 0.5; // typing: upper arms a little forward and out to the sides (so the far one clears his body)...
  const SPLAY = 0.18;
  const FOREARM = 0.95; // ...and forearms bent forward to the keys
  const pose = (work: number, t: number) => {
    // typing comes in bursts: the hands tap in turns (never quite in a regular rhythm), and the head dips toward the keys
    const burst = Math.min(1, Math.max(0, 0.5 + 1.4 * Math.sin(t * 1.1)));
    for (const { side, upper, forearm } of arms) {
      const wob = 0.6 * Math.sin(t * 13 + (side < 0 ? 0 : Math.PI)) + 0.4 * Math.sin(t * 7.1 + side * 1.2);
      upper.rotation.z = REST + (UPPER - REST) * work + work * burst * 0.08 * wob;
      upper.rotation.x = -side * SPLAY * work; // (tilts the arm's lower end away from his body)
      forearm.rotation.z = REST + (FOREARM - REST) * work + work * (0.1 + 0.25 * burst) * wob;
    }
    head.rotation.z = -work * (0.22 + 0.05 * Math.sin(t * 2.1));
  };
  pose(1, 0); // (stays like this when motion is reduced)

  let heading = 0; // the way he faces: 0 is +x, toward the laptop
  let work = 1; // 1 typing, 0 watching the car
  let last = -1;
  g.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return;
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const watching = carWatch.driving;
    const goal = watching ? Math.atan2(carWatch.z - g.position.z, carWatch.x - g.position.x) : 0;
    const turn = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading)); // the short way round
    heading += turn * (1 - Math.exp(-dt * (watching ? 9 : 4)));
    heading = Math.atan2(Math.sin(heading), Math.cos(heading)); // (keeps it from winding up over many laps)
    g.rotation.y = -heading;
    work += ((watching ? 0 : 1) - work) * (1 - Math.exp(-dt * 6));
    pose(work, t);
  };
  return g;
}

/**
 * The crew member who walks to the grill for a burger (yellow shirt, dark cap), facing +x. `errand.ts` moves and turns him
 * and calls `userData.pose` with the stride, a reach toward the table and whether he holds the burger.
 */
export function walkerModel(): Group {
  const SHIRT = "#f6d02a";
  const DARK_CAP = "#2a2d38";
  const g = new Group();
  const figure = new Group(); // everything but the placement, so that the stride's bob can lift it
  g.add(figure);
  const limb = (z: number, y: number, len: number, color: string, w: number) => {
    const pivot = new Group(); // rotation.z swings it forward (+x)
    pivot.position.set(0, y, z);
    pivot.add(box(w, len, w, color, 0, -len, 0));
    figure.add(pivot);
    return pivot;
  };
  const legL = limb(-1.1, 4.5, 4.5, "#2a3a6a", 1.5);
  const legR = limb(1.1, 4.5, 4.5, "#2a3a6a", 1.5);
  const armL = limb(-2.7, 9.2, 4, SHIRT, 1.1);
  const armR = limb(2.7, 9.2, 4, SHIRT, 1.1);
  figure.add(box(2.6, 5, 4.4, SHIRT, 0, 4.5, 0));
  figure.add(box(3.2, 3, 3.2, "#e8b890", 0, 9.5, 0));
  figure.add(box(3.6, 1.2, 3.6, DARK_CAP, 0, 12, 0));
  figure.add(box(1.6, 0.4, 3.2, DARK_CAP, 2.4, 12, 0)); // brim: shows which way he faces
  for (const z of [-0.8, 0.8]) figure.add(box(0.3, 0.6, 0.6, "#16161d", 1.6, 10.8, z));

  const burger = new Group(); // in his right hand
  burger.position.set(3.9, 7.2, 2.7);
  burger.add(box(3, 0.8, 3, "#e0b060", 0, 0, 0));
  burger.add(box(3.2, 0.7, 3.2, "#5a3418", 0, 0.8, 0));
  burger.add(box(3.4, 0.3, 3.4, "#5fae4a", 0, 1.5, 0));
  burger.add(box(3, 1, 3, "#e0b060", 0, 1.8, 0));
  burger.visible = false;
  figure.add(burger);

  g.userData.pose = ({ phase, swing, reach, burger: holding }: WalkerPose) => {
    const step = Math.sin(phase) * 0.6 * swing;
    legL.rotation.z = step;
    legR.rotation.z = -step;
    figure.position.y = 0.05 + Math.abs(Math.sin(phase)) * 0.25 * swing; // (a stepping foot just clears the ground)
    armL.rotation.z = -step * 0.8;
    armR.rotation.z = holding ? 1.2 : step * 0.8 + reach * 1.35;
    burger.visible = holding;
  };
  g.userData.pose({ phase: 0, swing: 0, reach: 0, burger: false });
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
/** Pop-up canopy: tall legs, a striped valance and a peaked solid-red roof so it reads as a tent. */
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
  g.add(mesh(roof, toon("#d02a2c"), 0, legH + 4 + 7.5, 0)); // solid red roof over the striped valance
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
  focus: number; // 0..1, eased: how far the camera has zoomed into this model's project (0 on the map)
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

/** Warm wood grain for the side of the slab the map sits on (tiles horizontally). */
export function woodTexture(): CanvasTexture {
  const w = 512;
  const h = 64;
  const [c, ctx] = canvasOf(w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#b07a49");
  grad.addColorStop(1, "#7d522f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  let seed = 11;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // long grain streaks, lighter and darker
  for (let i = 0; i < 90; i++) {
    const y = rand() * h;
    const x = rand() * w;
    const len = 40 + rand() * 220;
    ctx.fillStyle = rand() < 0.55 ? "rgba(60,32,14,0.20)" : "rgba(235,190,130,0.16)";
    ctx.fillRect(x, y, len, 1 + (rand() < 0.2 ? 1 : 0));
    if (x + len > w) ctx.fillRect(x - w, y, len, 1);
  }
  // a lit top edge and a shaded bottom edge, so it reads as a rounded board rather than a flat band
  ctx.fillStyle = "rgba(255,226,170,0.35)";
  ctx.fillRect(0, 0, w, 3);
  ctx.fillStyle = "rgba(30,14,4,0.35)";
  ctx.fillRect(0, h - 4, w, 4);
  return new CanvasTexture(c);
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
    case "typist":
      return typistModel();
    case "walker":
      return walkerModel();
  }
  throw new Error(`Unknown model: ${id}`);
}
