import { BoxGeometry, ConeGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import type { CanvasTexture } from "three";
import { SEASONS } from "./ftc";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";
import type { AnimCtx } from "./models";

// Models for the FTC area (see ftc.ts): the field's wall and the elements of each season, the duck in its chair, the
// driver station and the pit crew's things. Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint
// centre on the ground, +x = front. Anything that moves animates itself from `userData.animate`.

const STEEL = "#aeb4c0";
const DARK = "#3d4048";
const BLACK = "#1b1b22";
const GOLD = "#f2c230";
const RED = "#d8322c";
const BLUE = "#2f74e0";
const POLE = "#e8c24a";
const PIXEL = { y: "#f2c230", p: "#8a4fd0", w: "#f4f4f4", g: "#3fae5a" };

const X_AXIS = new Vector3(1, 0, 0);

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

function cone(r: number, h: number, color: string, x: number, y: number, z: number): Mesh {
  return mesh(new ConeGeometry(r, h, 10), toon(color), x, y + h / 2, z);
}

// ---------------------------------------------------------------- pixel text
// A 3 x 5 pixel font, enough for the signs, the banner and the match clock. Each glyph is its rows, left to right.

const GLYPHS: Record<string, string> = {
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "111101101101101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "110001010100111",
  "3": "110001010001110",
  "4": "101101111001001",
  "5": "111100110001110",
  "6": "011100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001110",
  ":": "000010000010000",
  "-": "000000111000000",
  " ": "000000000000000",
};

/** Width in texels of `text` at `scale` (glyphs are 3 wide with a 1 texel gap, none after the last). */
const textWidth = (text: string, scale: number) => text.length * 4 * scale - scale;

function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let i = 0; i < 15; i++) if (g[i] === "1") ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
    cx += 4 * scale;
  }
}

/** Text centred across a canvas that is `width` texels wide. */
function centred(ctx: CanvasRenderingContext2D, width: number, text: string, y: number, scale: number, color: string) {
  pixelText(ctx, text, Math.round((width - textWidth(text, scale)) / 2), y, scale, color);
}

/** A flat picture facing +z (towards the camera), unlit so its pixels stay as drawn. */
function picture(w: number, h: number, canvas: HTMLCanvasElement, twoSided = false): { plane: Mesh; tex: CanvasTexture } {
  const tex = nearestTexture(canvas);
  const plane = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, side: twoSided ? DoubleSide : undefined }));
  return { plane, tex };
}

// ---------------------------------------------------------------- the field

/** One run of the field's wall: a pale rail with a darker cap. */
function wallModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 5, d, "#cfd4de", 0, 0, 0));
  g.add(box(w + 0.4, 1, d + 0.4, "#8b909a", 0, 5, 0));
  return g;
}

// ---- Power Play: a cup or pole standing on a base plate, optionally with a cone put over its top

const PP_HEIGHT = { l: 8, m: 14, h: 20 };

function ppJunction(level: "g" | "l" | "m" | "h", topCone?: string): Group {
  const g = new Group();
  g.add(cyl(3, 3.4, 1, DARK, 0, 0, 0, 10));
  let top: number;
  if (level === "g") {
    g.add(cyl(2.3, 2.3, 3, POLE, 0, 1, 0, 10)); // a ground junction is just a short cup
    g.add(cyl(1.5, 1.5, 0.2, BLACK, 0, 4, 0, 10));
    top = 4;
  } else {
    const h = PP_HEIGHT[level];
    g.add(cyl(0.95, 0.95, h, POLE, 0, 1, 0, 8));
    g.add(cyl(1.7, 1.7, 0.9, DARK, 0, 1 + h, 0, 8));
    top = 1.9 + h;
  }
  if (topCone) g.add(cone(2.3, 5, topCone, 0, top, 0));
  return g;
}

function coneStack(color: string, n = 3): Group {
  const g = new Group();
  for (let i = 0; i < n; i++) g.add(cone(2.4, 5.2, color, 0, i * 1.9, 0));
  return g;
}

// ---- Center Stage: the backdrop, the truss, the drone and the pixels

/** The mosaic on the face of the backdrop: a lattice of pixels, some in place, the rest empty. */
function backdropTexture(w: number, len: number): CanvasTexture {
  const W = Math.round(w * 2);
  const H = Math.round(len * 2);
  const [c, ctx] = canvasOf(W, H);
  fillRect(ctx, 0, 0, W, H, "#2b2e38");
  const palette = [PIXEL.y, PIXEL.p, PIXEL.w, PIXEL.g, "#3a3e4a", "#3a3e4a"];
  const cols = Math.floor((W - 7) / 6);
  const rows = Math.floor((H - 5) / 5);
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const x = 4 + q * 6 + (r % 2) * 3;
      const y = 3 + r * 5;
      ctx.fillStyle = palette[(q * 7 + r * 13 + ((q * r) % 5)) % palette.length];
      ctx.fillRect(x + 1, y, 2, 4); // a hexagon, as much as four texels allow
      ctx.fillRect(x, y + 1, 4, 2);
    }
  return nearestTexture(c);
}

function backdropModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 1.5, d, DARK, 0, 0, 0)); // the platform
  const len = 12.4;
  const tilt = 0.96; // 55 degrees: the top leans back to the wall
  const board = new Group();
  board.position.set(0, 1.5 + (len * Math.sin(tilt)) / 2, 0);
  board.rotation.x = tilt;
  board.add(box(w - 2, 0.8, len, "#1b1d26", 0, -0.4, 0));
  const face = new Mesh(new PlaneGeometry(w - 2.6, len - 0.8), new MeshBasicMaterial({ map: backdropTexture(w - 2.6, len - 0.8) }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.45;
  board.add(face);
  g.add(board);
  for (const sx of [-1, 1]) g.add(box(1, 7, 1, STEEL, sx * (w / 2 - 2.5), 1.5, -3)); // props behind
  return g;
}

function trussModel(): Group {
  const g = new Group();
  const R = 8.5;
  for (const s of [-1, 1]) {
    g.add(box(4, 0.8, 4, DARK, 0, 0, s * R));
    g.add(box(1.4, 22, 1.4, STEEL, 0, 0.8, s * R));
  }
  g.add(box(1.2, 1.2, 2 * R + 1.4, STEEL, 0, 21, 0)); // the top bar
  g.add(box(1, 1, 2 * R, STEEL, 0, 11, 0));
  for (const s of [-1, 1]) {
    g.add(strut([0, 1, s * R], [0, 11, 0], 0.5, STEEL));
    g.add(strut([0, 11, 0], [0, 21, s * R], 0.5, STEEL));
  }
  g.add(box(0.8, 0.8, 8, GOLD, 0, 15, 0)); // the bar the robots hang from, on two cables
  for (const z of [-3, 3]) g.add(box(0.3, 6, 0.3, DARK, 0, 15.8, z));
  return g;
}

/** A paper-plane drone, nose up on its launcher. */
function droneModel(): Group {
  const g = new Group();
  g.add(box(3, 0.6, 3, DARK, 0, 0, 0));
  g.add(cyl(0.5, 0.5, 3.4, STEEL, 0, 0.6, 0, 6));
  const plane = new Group();
  plane.position.set(0, 4.4, 0);
  plane.rotation.z = 0.18;
  plane.add(box(8, 0.5, 1.6, "#f4f4f4", 0, 0, 0)); // body
  for (const s of [-1, 1]) {
    const wing = box(3.8, 0.3, 3.4, "#f4f4f4", 0.6, 0.2, s * 2.2);
    wing.rotation.y = -s * 0.55;
    plane.add(wing);
  }
  plane.add(box(1.2, 2, 0.3, RED, -3.4, 0.5, 0)); // tail fin
  g.add(plane);
  return g;
}

/** A hexagonal pixel, two stacked and a little askew. */
function pixelModel(color: string): Group {
  const g = new Group();
  g.add(cyl(2.6, 2.6, 0.9, color, 0, 0, 0, 6));
  const top = cyl(2.6, 2.6, 0.9, color, 0.4, 0.9, 0.2, 6);
  top.rotation.y = 0.5;
  g.add(top);
  return g;
}

// ---- Into the Deep: the submersible, the baskets and the samples

function submersibleModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 1.2, d, DARK, 0, 0, 0)); // the floor plate, red and blue halves on it
  g.add(box(w / 2 - 1.5, 0.4, d - 2, RED, -w / 4, 1.2, 0));
  g.add(box(w / 2 - 1.5, 0.4, d - 2, BLUE, w / 4, 1.2, 0));
  const x = w / 2 - 3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1.4, 16, 1.4, STEEL, sx * x, 1.6, sz * 5)); // four posts
  g.add(box(2 * x, 1, 1, GOLD, 0, 15, -5)); // the high bar at the back, the low one in front
  g.add(box(2 * x, 1, 1, "#c8ccd6", 0, 8, 5));
  for (const sx of [-1, 1]) g.add(box(1, 1, 10, STEEL, sx * x, 15, 0)); // the end rails
  return g;
}

function basketModel(color: string, dir: 1 | -1): Group {
  const g = new Group();
  g.add(cyl(5, 5.4, 1, DARK, 0, 0, 0, 12));
  g.add(cyl(0.9, 0.9, 13, STEEL, 0, 1, 0, 8));
  const bucket = (x: number, y: number) => {
    g.add(cyl(4.2, 3.2, 3.2, color, x, y, 0, 12));
    g.add(cyl(4.5, 4.5, 0.5, "#f4f4f4", x, y + 3.2, 0, 12)); // the rim
    g.add(cyl(3.6, 3.6, 0.1, BLACK, x, y + 3.7, 0, 12)); // its open top
  };
  bucket(0, 11.5); // the high basket on the post, the low one out on an arm towards the field
  g.add(box(7, 0.8, 0.8, STEEL, dir * 3.5, 4.4, 0));
  bucket(dir * 7.5, 5.2);
  return g;
}

/** Three samples side by side, each a little askew. */
function samplesModel(color: string): Group {
  const g = new Group();
  [-6.5, 0, 6.5].forEach((x, i) => {
    const s = box(3.8, 1.6, 1.6, color, x, 0, (i - 1) * 0.4);
    s.rotation.y = (i - 1) * 0.18;
    g.add(s);
  });
  return g;
}

// ---------------------------------------------------------------- signs

/** A plaque on two legs: the season's name over its years, with a stripe in its colour. */
function signModel(key: keyof typeof SEASONS): Group {
  const s = SEASONS[key];
  const [c, ctx] = canvasOf(80, 22);
  fillRect(ctx, 0, 0, 80, 22, "#1b1d26");
  fillRect(ctx, 0, 0, 80, 3, s.tint);
  fillRect(ctx, 0, 19, 80, 3, s.tint);
  centred(ctx, 80, s.name, 5, 1, "#f4f4f4");
  centred(ctx, 80, s.years, 10, 2, s.tint);
  const g = new Group();
  for (const sx of [-1, 1]) g.add(box(1, 6, 1, STEEL, sx * 16, 0, 0));
  g.add(box(40, 11, 1.2, "#1b1d26", 0, 5, 0));
  const { plane } = picture(40, 11, c);
  plane.position.set(0, 10.5, 0.62);
  g.add(plane);
  return g;
}

// ---------------------------------------------------------------- the mascot

/** The team duck in a folding chair, facing +x: a big yellow head with a white tuft, orange bill and feet, a black cape. */
function duckModel(): Group {
  const g = new Group();
  const Y = "#ffd21a";
  const Y2 = "#ffe45c";
  const O = "#ff8a1c";
  const CAPE = "#16161d";
  // the chair
  g.add(box(13, 1.2, 11, "#4a4d57", -1, 6, 0));
  for (const x of [-6.5, 4.5]) for (const z of [-4.5, 4.5]) g.add(box(1, 6, 1, STEEL, x, 0, z));
  g.add(box(1, 8, 11, "#4a4d57", -7.2, 7.2, 0));
  g.add(box(1, 14, 12.4, CAPE, -6, 5, 0)); // the cape hangs down behind it
  // body
  g.add(box(8, 12, 11.5, Y, -1.5, 7.2, 0));
  g.add(box(0.5, 9, 8, Y2, 2.6, 8.2, 0)); // a paler belly
  g.add(box(8.4, 1.4, 11.8, CAPE, -1.5, 18.2, 0)); // the black collar and the bow's two tails
  g.add(box(1, 5, 1.6, CAPE, 2.9, 13.4, 1.8));
  g.add(box(1, 4, 1.6, CAPE, 2.9, 14.2, -1.8));
  g.add(box(0.5, 1.6, 1.6, "#9fd0ff", 2.9, 15.6, -3.2)); // a pin on the chest
  for (const s of [-1, 1]) {
    g.add(box(3.4, 8, 2.2, Y, -1, 9.8, s * 6.9)); // arms, hands resting on the knees
    g.add(box(5, 2.4, 2.2, Y, 1.2, 10.9, s * 6.6));
    g.add(box(7.5, 3.6, 3.6, Y, 5.7, 7.2, s * 2.9)); // thighs along the seat
    g.add(box(3.2, 7.2, 3.6, Y, 8.6, 0, s * 2.9)); // shins
    g.add(box(6.4, 2.2, 4.4, O, 11.6, 0, s * 2.9)); // big flat feet
  }
  // head, on a pivot so it can nod
  const head = new Group();
  head.position.y = 19.2;
  head.add(box(11, 9.5, 12.4, Y, 0.5, 0, 0));
  head.add(box(5.5, 2.4, 5.5, "#f4f4f4", -1.5, 9.5, 0)); // the tuft
  head.add(box(3.4, 1.6, 3.4, "#f4f4f4", -1.2, 11.9, 0.3));
  head.add(box(6, 2.4, 7.6, O, 8.9, 2.2, 0)); // the bill
  head.add(box(4.8, 1.2, 6.4, "#e87510", 8.4, 1, 0));
  const eyes: Mesh[] = [];
  for (const s of [-1, 1]) {
    const eye = box(0.7, 3.6, 3.4, "#2a1d14", 6.05, 4.4, s * 3.3);
    head.add(eye);
    eyes.push(eye);
    head.add(box(0.4, 1.2, 1.2, "#ffffff", 6.5, 6, s * 3.3 + 0.6)); // a glint
  }
  g.add(head);
  g.userData.animate = ({ t, pixel }: AnimCtx) => {
    // a one-pixel nod on every other beat, and a blink every few seconds
    const k = Math.floor(t / 0.8) % 4;
    head.position.y = 19.2 + (k === 1 || k === 2 ? pixel : 0);
    const blink = t % 4.3 < 0.16;
    for (const e of eyes) e.scale.y = blink ? 0.15 : 1;
  };
  return g;
}

// ---------------------------------------------------------------- tables and what is on them

const TABLE_H = 7;

/** A folding table: top, four legs and a skirt hanging along the front (+z). */
function tableModel(g: Group, w: number, d: number, skirt: string) {
  g.add(box(w, 1.2, d, "#4a4d57", 0, TABLE_H - 1.2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1, TABLE_H - 1.2, 1, STEEL, sx * (w / 2 - 1.5), 0, sz * (d / 2 - 1.5)));
  g.add(box(w - 0.4, TABLE_H - 1.4, 0.5, skirt, 0, 0.2, d / 2 - 0.3));
}

/** A gamepad lying on the table, its grips towards +z and its cable out of the back. */
function gamepad(x: number, z: number): Group {
  const p = new Group();
  p.position.set(x, TABLE_H, z);
  p.add(box(5.4, 1.2, 3.2, BLACK, 0, 0, 0));
  for (const s of [-1, 1]) p.add(box(1.8, 1.2, 2.4, BLACK, s * 2.2, 0, 1.8)); // the grips
  for (const s of [-1, 1]) p.add(box(1.8, 0.8, 0.6, "#2b2e38", s * 1.8, 0.5, -1.8)); // the bumpers
  p.add(cyl(0.55, 0.55, 0.5, "#4a4d57", -1.7, 1.2, -0.3, 8)); // the sticks
  p.add(cyl(0.55, 0.55, 0.5, "#4a4d57", 1, 1.2, 0.9, 8));
  p.add(box(1.4, 0.3, 0.45, "#4a4d57", -1, 1.2, 0.9)); // the d-pad
  p.add(box(0.45, 0.3, 1.4, "#4a4d57", -1, 1.2, 0.9));
  p.add(box(0.7, 0.3, 0.7, "#f4f4f4", 0, 1.2, -0.8)); // the guide button
  p.add(box(0.55, 0.35, 0.55, "#3fae5a", 1.9, 1.2, 0.3)); // A, B, X, Y
  p.add(box(0.55, 0.35, 0.55, RED, 2.5, 1.2, -0.3));
  p.add(box(0.55, 0.35, 0.55, BLUE, 1.3, 1.2, -0.3));
  p.add(box(0.55, 0.35, 0.55, GOLD, 1.9, 1.2, -0.9));
  return p;
}

/** The Driver Hub in a stand between two gamepads, cabled to both. */
function stationModel(w: number, d: number): Group {
  const g = new Group();
  tableModel(g, w, d, "#16161d");
  g.add(box(w - 6, 0.5, 0.8, BLUE, 0, 2.2, d / 2 + 0.05)); // a stripe along the skirt
  const [c, ctx] = canvasOf(20, 12);
  fillRect(ctx, 0, 0, 20, 12, "#0b2a4a");
  fillRect(ctx, 0, 0, 20, 2, BLUE);
  fillRect(ctx, 2, 4, 10, 1, "#8fdcff");
  fillRect(ctx, 2, 6, 14, 1, "#5b6b80");
  fillRect(ctx, 2, 8, 8, 1, "#5b6b80");
  fillRect(ctx, 15, 8, 3, 2, "#3fae5a");
  const hub = new Group();
  hub.position.set(0, TABLE_H + 3.4, -0.5);
  hub.rotation.x = -0.3;
  hub.add(box(7, 4.6, 0.8, BLACK, 0, -2.3, 0));
  const { plane } = picture(6.2, 3.8, c);
  plane.position.set(0, 0.1, 0.45);
  hub.add(plane);
  g.add(box(5, 0.8, 3, DARK, 0, TABLE_H, 0.5));
  g.add(hub);
  for (const s of [-1, 1]) {
    g.add(gamepad(s * 12, 2.4));
    g.add(box(0.4, 0.3, 1.3, BLACK, s * 12, TABLE_H, 0.15)); // out of the back of the pad, then across to the hub
    g.add(box(8.5, 0.3, 0.4, BLACK, s * 7.75, TABLE_H, -0.5));
  }
  return g;
}

/** The pit table: a parts tray, a wire spool, and a battery on its charger. The laptop is a prop of its own. */
function pitModel(w: number, d: number): Group {
  const g = new Group();
  tableModel(g, w, d, BLUE);
  g.add(box(10, 1.4, 6, BLUE, 0, TABLE_H, 0.5)); // the parts tray, with a few gears in it
  for (const [x, z] of [[-2.5, 0], [0.5, 1.4], [2.8, -0.4]] as const) g.add(cyl(1.4, 1.4, 0.7, GOLD, x, TABLE_H + 1.4, z + 0.5, 10));
  g.add(cyl(2.2, 2.2, 2, RED, -11, TABLE_H, 0, 10)); // a spool of wire
  g.add(box(8, 2.6, 5, "#4a4d57", 16, TABLE_H, 0)); // the charger, a battery on top of it
  g.add(box(0.6, 0.4, 2, "#4cd964", 18.5, TABLE_H + 2.6, 1.2));
  g.add(box(5.6, 2.4, 2.4, BLACK, 14, TABLE_H + 2.6, -0.6));
  g.add(box(1.2, 1.4, 1.4, "#ff8a1c", 17.2, TABLE_H + 2.9, -0.6));
  return g;
}

/** An open tote with a heap in it: robot parts, or the game pieces of all three seasons. */
function binModel(w: number, d: number, kind: "parts" | "pieces", variant: number): Group {
  const g = new Group();
  const color = kind === "parts" ? BLUE : "#9aa0ae";
  g.add(box(w, 1, d, color, 0, 0, 0));
  for (const s of [-1, 1]) {
    g.add(box(w, 8, 1, color, 0, 1, s * (d / 2 - 0.5)));
    g.add(box(1, 8, d - 2, color, s * (w / 2 - 0.5), 1, 0));
    g.add(box(6, 1.2, 1.2, "#dbe6f5", 0, 8, s * (d / 2 - 0.5))); // the handles
  }
  g.add(box(w - 3, 4.6, d - 3, "#2b2e38", 0, 1, 0)); // the heap, as far as the rim
  const top = 5.6;
  if (kind === "parts") {
    const m = variant ? -1 : 1;
    for (const [x, z] of [[-6 * m, -2], [-1 * m, 2.5], [5 * m, -1.5]] as const) g.add(cyl(2.4, 2.4, 0.8, GOLD, x, top, z, 10)); // sprockets
    g.add(box(11, 1.2, 2.2, STEEL, 1.5 * m, top, 0.2)); // a length of channel
    const wheel = cyl(3, 3, 1.6, BLACK, 5.5 * m, top, 2.4, 12);
    wheel.rotation.z = 0.35;
    g.add(wheel);
    g.add(box(3.6, 0.5, 2.6, "#3fae5a", -6.5 * m, top + 0.8, 2.6)); // a circuit board
  } else {
    g.add(cone(1.7, 5, RED, -7, top, -2));
    g.add(cone(1.7, 5, BLUE, -3.5, top, 2.4));
    g.add(cyl(2.2, 2.2, 0.9, PIXEL.y, 1.5, top, -2.4, 6));
    g.add(cyl(2.2, 2.2, 0.9, PIXEL.p, 4.5, top, 2.6, 6));
    g.add(cyl(2.2, 2.2, 0.9, PIXEL.w, 7, top, -1, 6));
    g.add(cyl(2.2, 2.2, 0.9, PIXEL.g, 0.5, top + 0.9, -2.2, 6));
    g.add(box(3.8, 1.6, 1.6, RED, 3, top + 0.9, 0.6));
    g.add(box(3.8, 1.6, 1.6, GOLD, -1, top + 0.9, 2.2));
  }
  return g;
}

// ---------------------------------------------------------------- beside the field

/** The match clock: red and blue scores either side of a countdown, ticking through a match. */
function scoreboardModel(w: number, d: number): Group {
  const g = new Group();
  for (const sx of [-1, 1]) g.add(box(1.2, 8, 1.2, STEEL, sx * (w / 2 - 3), 0, 0));
  g.add(box(w, 14, d / 3, BLACK, 0, 8, 0));
  const [c, ctx] = canvasOf(64, 28);
  const { plane, tex } = picture(w - 2, 12, c);
  plane.position.set(0, 15, d / 6 + 0.1);
  g.add(plane);
  let shown = -1;
  const draw = (sec: number) => {
    const s = sec % 150;
    const left = 150 - s;
    fillRect(ctx, 0, 0, 64, 28, "#0b0d14");
    pixelText(ctx, "RED", 3, 3, 1, RED);
    pixelText(ctx, "BLU", 49, 3, 1, "#5b9bff");
    const two = (n: number) => String(Math.min(99, n)).padStart(2, "0");
    pixelText(ctx, two(3 * Math.floor(s / 9)), 3, 11, 2, RED);
    pixelText(ctx, two(2 * Math.floor(s / 6)), 47, 11, 2, "#5b9bff");
    centred(ctx, 64, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, 11, 2, GOLD);
    fillRect(ctx, 0, 24, 64, 1, "#2b2e38");
    tex.needsUpdate = true;
  };
  draw(0);
  g.userData.animate = ({ t }: AnimCtx) => {
    const sec = Math.floor(t);
    if (sec === shown) return;
    shown = sec;
    draw(sec);
  };
  return g;
}

/** The team banner on a weighted stand: the duck, 6417 and the team's name. */
function bannerModel(): Group {
  const g = new Group();
  g.add(box(10, 1, 6, DARK, 0, 0, 0));
  g.add(cyl(0.55, 0.55, 40, STEEL, 0, 1, -1.5, 8));
  g.add(box(1.2, 1.2, 1.2, GOLD, 0, 41, -1.5));
  g.add(box(18, 0.8, 0.8, STEEL, 0, 38.4, 0));
  const [c, ctx] = canvasOf(32, 56);
  fillRect(ctx, 0, 0, 32, 56, "#2a63c9");
  fillRect(ctx, 0, 0, 32, 1, GOLD);
  fillRect(ctx, 0, 55, 32, 1, GOLD);
  const duck = ["...WWW...", "..YYYYY..", ".YYKYYYY.", ".YYYYYOOO", ".YYYYYOOO", "..YYYYY..", "...YYY..."];
  const ink: Record<string, string> = { W: "#f4f4f4", Y: "#ffd21a", K: BLACK, O: "#ff8a1c" };
  duck.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch !== ".") fillRect(ctx, 7 + i * 2, 2 + j * 2, 2, 2, ink[ch]);
    })
  );
  centred(ctx, 32, "6417", 19, 2, "#f4f4f4");
  centred(ctx, 32, "BLU", 31, 2, GOLD);
  centred(ctx, 32, "CRU", 43, 2, GOLD);
  const cloth = new Group();
  cloth.position.set(0, 24.2, 0);
  const { plane } = picture(16, 28, c, true);
  cloth.add(plane);
  g.add(cloth);
  g.userData.animate = ({ t }: AnimCtx) => {
    // a slight sway, in steps
    cloth.rotation.y = [0, 0.06, 0, -0.06][Math.floor(t * 1.4) % 4];
  };
  return g;
}

/** A low shelf with three trophies on it, gold, silver and bronze. */
function trophiesModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 1.2, d, "#b08a5a", 0, 4.8, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1, 4.8, 1, "#7d522f", sx * (w / 2 - 1.5), 0, sz * (d / 2 - 1.5)));
  const trophy = (x: number, h: number, color: string) => {
    g.add(box(3.6, 1, 3.6, DARK, x, 6, 0));
    g.add(cyl(0.5, 0.5, h * 0.4, color, x, 7, 0, 8));
    g.add(cyl(2.4, 1.2, h * 0.5, color, x, 7 + h * 0.4, 0, 10));
    for (const s of [-1, 1]) g.add(box(0.5, h * 0.3, 0.5, color, x + s * 2.6, 7 + h * 0.5, 0));
  };
  trophy(-8, 10, GOLD);
  trophy(0, 8, "#c8ccd6");
  trophy(8, 6, "#c47a3a");
  return g;
}

// ---------------------------------------------------------------- dispatch

/** The model for an FTC-area prop id, or null when the id is not one of ours. */
export function ftcModel(id: string, w: number, d: number): Group | null {
  if (!id.startsWith("ftc-")) return null;
  const key = id.slice(4);
  switch (key) {
    case "wall":
      return wallModel(w, d);
    case "pp-g":
      return ppJunction("g");
    case "pp-l":
      return ppJunction("l");
    case "pp-m-red":
      return ppJunction("m", RED);
    case "pp-h-blue":
      return ppJunction("h", BLUE);
    case "cones-red":
      return coneStack(RED);
    case "cones-blue":
      return coneStack(BLUE);
    case "backdrop":
      return backdropModel(w, d);
    case "truss":
      return trussModel();
    case "drone":
      return droneModel();
    case "pixel-y":
      return pixelModel(PIXEL.y);
    case "pixel-p":
      return pixelModel(PIXEL.p);
    case "pixel-w":
      return pixelModel(PIXEL.w);
    case "pixel-g":
      return pixelModel(PIXEL.g);
    case "submersible":
      return submersibleModel(w, d);
    case "basket-red":
      return basketModel(RED, 1);
    case "basket-blue":
      return basketModel(BLUE, -1);
    case "samples-red":
      return samplesModel(RED);
    case "samples-yellow":
      return samplesModel(GOLD);
    case "samples-blue":
      return samplesModel(BLUE);
    case "sign-pp":
      return signModel("pp");
    case "sign-cs":
      return signModel("cs");
    case "sign-itd":
      return signModel("itd");
    case "duck":
      return duckModel();
    case "station":
      return stationModel(w, d);
    case "pit":
      return pitModel(w, d);
    case "bin-parts":
      return binModel(w, d, "parts", 0);
    case "bin-parts-b":
      return binModel(w, d, "parts", 1);
    case "bin-pieces":
      return binModel(w, d, "pieces", 0);
    case "scoreboard":
      return scoreboardModel(w, d);
    case "banner":
      return bannerModel();
    case "trophies":
      return trophiesModel(w, d);
  }
  return null;
}
