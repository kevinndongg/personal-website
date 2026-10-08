import { CAR, GROUND, SPRITE_PALETTE } from "./palette";
import { CMR_LOGO } from "./cmr-logo";
import { GARAGE_H, GARAGE_W } from "./scenes";
import type { Zone } from "./world";

// Placeholder pixel art, generated in code so it can be hand-refined later.
// Item sprites are 16x16 grids of palette keys ('.' = transparent); edit the strings to redraw.

type Recolor = Record<string, string>;

const GRIDS: Record<string, string[]> = {
  cone: [
    "................",
    "................",
    ".......KK.......",
    "......KooK......",
    "......KooK......",
    ".....KooooK.....",
    ".....KwwwwK.....",
    "....KwwwwwwK....",
    "....KoooooOK....",
    "...KoooooooOK...",
    "...KoooooooOK...",
    "..KoooooooooOK..",
    ".KKKKKKKKKKKKKK.",
    ".KddddddddddddK.",
    ".KKKKKKKKKKKKKK.",
    "................",
  ],
  tire: [
    "................",
    "................",
    "................",
    "...KKKKKKKKKK...",
    "..KtTtTtTtTtTK..",
    ".KttTTTTTTTTttK.",
    ".KtTKKKKKKKKTtK.",
    ".KtTKggggggKTtK.",
    ".KtTKgGGGGGKTtK.",
    ".KtTKGGGGGdKTtK.",
    ".KtTKKKKKKKKTtK.",
    ".KttTTTTTTTTttK.",
    "..KtTtTtTtTtTK..",
    "...KKKKKKKKKK...",
    "................",
    "................",
  ],
  laptop: [
    "................",
    "................",
    "................",
    "..KKKKKKKKKKKK..",
    "..KddddddddddK..",
    "..KdssssssssdK..",
    "..KdsSSSSSSsdK..",
    "..KdssssoossdK..",
    "..KddddddddddK..",
    "..KKKKKKKKKKKK..",
    ".KggggggggggggK.",
    ".KgGgGgGgGgGgGK.",
    ".KggggggGgggggK.",
    ".KKKKKKKKKKKKKK.",
    "................",
    "................",
  ],
  cube: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "...KKKKKKKKKK...",
    "...KwwooooooK...",
    "...KwoooooooK...",
    "...KoooooooOK...",
    "...KoooooooOK...",
    "...KOOOOOOOOK...",
    "...KKKKKKKKKK...",
    "................",
    "................",
    "................",
    "................",
  ],
  toolbox: [
    "................",
    "................",
    "......KKKK......",
    ".....KG..GK.....",
    "..KKKKKKKKKKKK..",
    "..KrwwwwwwwwrK..",
    "..KrrrrrrrrrrK..",
    "..KKKKKKKKKKKK..",
    "..KrrrrrrrrrrK..",
    "..KrrrrYYrrrrK..",
    "..KRRRRRRRRRRK..",
    "..KKKKKKKKKKKK..",
    "................",
    "................",
    "................",
    "................",
  ],
  barrier: [
    "................",
    "................",
    "................",
    "................",
    "..KKKKKKKKKKKK..",
    ".KggggggggggggK.",
    ".KgwwwwwwwwwwgK.",
    ".KgggggggggggGK.",
    ".KggooooooooGGK.",
    ".KggggggggggGGK.",
    ".KGGGGGGGGGGGGK.",
    ".KKKKKKKKKKKKKK.",
    "................",
    "................",
    "................",
    "................",
  ],
  gear: [
    "................",
    "................",
    "................",
    ".....KK..KK.....",
    "....KggKKggK....",
    ".....KggggK.....",
    "..KK.KggggK.KK..",
    ".KggKggKKggKggK.",
    ".KggKggKKggKggK.",
    "..KK.KggggK.KK..",
    ".....KggggK.....",
    "....KggKKggK....",
    ".....KK..KK.....",
    "................",
    "................",
    "................",
  ],
};

const BLUE: Recolor = { o: "b", O: "B" };
const RED: Recolor = { o: "r", O: "R" };
const YELLOW: Recolor = { o: "y", O: "Y" };

export const SOLID_KINDS = new Set(["cone", "tire", "toolbox", "barrier"]);
export type ItemKind = "cone" | "tire" | "laptop" | "cube" | "toolbox" | "barrier" | "gear";
export type ItemColor = "o" | "b" | "r" | "y";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function fromGrid(rows: string[], recolor: Recolor = {}): HTMLCanvasElement {
  const width = Math.max(...rows.map((r) => r.length));
  const [c, ctx] = canvas(width, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const key = row[x];
      if (!key || key === ".") continue;
      const color = SPRITE_PALETTE[recolor[key] ?? key];
      if (color) rect(ctx, x, y, 1, 1, color);
    }
  });
  return c;
}

function drawCarSide(ctx: CanvasRenderingContext2D) {
  const k = CAR.outline;
  rect(ctx, 1, 5, 14, 7, k);
  rect(ctx, 2, 6, 12, 5, CAR.body);
  rect(ctx, 2, 10, 12, 1, CAR.bodyDark);
  rect(ctx, 2, 6, 7, 1, CAR.bodyLight);
  rect(ctx, 3, 8, 10, 1, CAR.stripe);
  rect(ctx, 9, 6, 3, 2, CAR.glass);
  rect(ctx, 4, 6, 2, 2, CAR.glass);
  rect(ctx, 14, 7, 1, 1, CAR.headlight);
  rect(ctx, 14, 10, 1, 1, CAR.headlight);
  rect(ctx, 1, 7, 1, 1, CAR.taillight);
  for (const wx of [3, 10]) {
    rect(ctx, wx, 4, 3, 1, k);
    rect(ctx, wx, 12, 3, 1, k);
    rect(ctx, wx, 12, 3, 2, CAR.wheel);
    rect(ctx, wx, 3, 3, 2, CAR.wheel);
    rect(ctx, wx + 1, 13, 1, 1, CAR.hub);
  }
}

function drawCarFront(ctx: CanvasRenderingContext2D, back: boolean) {
  const k = CAR.outline;
  rect(ctx, 4, 1, 8, 14, k);
  rect(ctx, 5, 2, 6, 12, CAR.body);
  rect(ctx, 5, 2, 6, 1, CAR.bodyLight);
  rect(ctx, 7, 2, 2, 12, CAR.stripe);
  if (back) {
    rect(ctx, 5, 4, 6, 3, CAR.glass);
    rect(ctx, 5, 13, 6, 1, CAR.bodyDark);
    rect(ctx, 5, 12, 2, 1, CAR.taillight);
    rect(ctx, 9, 12, 2, 1, CAR.taillight);
  } else {
    rect(ctx, 5, 7, 6, 3, CAR.glass);
    rect(ctx, 7, 7, 2, 3, CAR.stripe);
    rect(ctx, 5, 12, 2, 1, CAR.headlight);
    rect(ctx, 9, 12, 2, 1, CAR.headlight);
    rect(ctx, 5, 13, 6, 1, CAR.bodyDark);
  }
  for (const wy of [3, 10]) {
    rect(ctx, 3, wy, 2, 3, CAR.wheel);
    rect(ctx, 11, wy, 2, 3, CAR.wheel);
  }
}


// Small free-form props: authored at their own pixel size and drawn 1:1.
const CONE_GRID = [
  "...KK...",
  "..KooK..",
  "..KooK..",
  ".KwwwwK.",
  ".KooooK.",
  ".KwwwwK.",
  "KoooooOK",
  "KoooooOK",
  "KddddddK",
  "KKKKKKKK",
];

function drawTireStack(ctx: CanvasRenderingContext2D) {
  for (let k = 0; k < 3; k++) {
    const y = 6 - k * 3;
    rect(ctx, 0, y, 10, 5, "#16161d");
    rect(ctx, 1, y + 1, 8, 3, "#26262c");
    for (let x = 1; x < 9; x += 2) rect(ctx, x, y + 1, 1, 1, "#43434d");
  }
  rect(ctx, 1, 0, 8, 4, "#16161d");
  rect(ctx, 2, 1, 6, 2, "#43434d");
  rect(ctx, 4, 1, 2, 2, "#16161d");
}

function drawPerson(ctx: CanvasRenderingContext2D, shirt: string, cap: string) {
  const k = "#16161d";
  rect(ctx, 1, 0, 5, 5, k); // head
  rect(ctx, 2, 2, 3, 2, "#e8b890");
  rect(ctx, 2, 1, 3, 1, cap);
  rect(ctx, 0, 5, 7, 5, k); // torso + arms
  rect(ctx, 1, 6, 5, 3, shirt);
  rect(ctx, 1, 10, 2, 3, k); // legs
  rect(ctx, 4, 10, 2, 3, k);
  rect(ctx, 2, 10, 1, 2, "#2a3a6a");
  rect(ctx, 4, 10, 1, 2, "#2a3a6a");
}

// parked formula car, nose to the right (flipped for the left-facing sprite)
function drawFormula(ctx: CanvasRenderingContext2D) {
  const k = CAR.outline;
  rect(ctx, 0, 1, 3, 10, k); // rear wing
  rect(ctx, 1, 2, 1, 8, "#f4f4f4");
  rect(ctx, 3, 3, 20, 6, k); // body
  rect(ctx, 4, 4, 18, 4, CAR.body);
  rect(ctx, 22, 4, 6, 4, k); // nose
  rect(ctx, 22, 5, 5, 2, CAR.body);
  rect(ctx, 5, 5, 16, 2, CAR.stripe);
  rect(ctx, 11, 4, 4, 4, "#2f74e0"); // helmet
  rect(ctx, 12, 5, 2, 2, "#cfe6ff");
  rect(ctx, 27, 0, 3, 12, k); // front wing
  rect(ctx, 28, 1, 1, 10, "#f4f4f4");
  for (const x of [5, 19]) {
    rect(ctx, x, 0, 5, 3, k);
    rect(ctx, x + 1, 1, 3, 1, CAR.wheel);
    rect(ctx, x, 9, 5, 3, k);
    rect(ctx, x + 1, 10, 3, 1, CAR.wheel);
  }
}

function drawBattery(ctx: CanvasRenderingContext2D) {
  rect(ctx, 0, 1, 9, 7, CAR.outline);
  rect(ctx, 1, 2, 7, 5, "#4a4d57");
  rect(ctx, 1, 2, 7, 1, "#8b909a");
  rect(ctx, 2, 4, 3, 2, "#f6d02a");
  rect(ctx, 6, 0, 1, 1, "#d8322c");
  rect(ctx, 2, 0, 1, 1, "#2f74e0");
}

function drawSmallLaptop(ctx: CanvasRenderingContext2D) {
  rect(ctx, 1, 0, 6, 4, CAR.outline);
  rect(ctx, 2, 1, 4, 2, "#8fdcff");
  rect(ctx, 0, 4, 8, 3, CAR.outline);
  rect(ctx, 1, 4, 6, 2, "#b8bcc4");
}

const PROP_SIZES: Record<string, [number, number]> = {
  tirestack: [10, 11],
  person: [7, 13],
  formula: [30, 12],
  battery: [9, 8],
  laptop: [8, 7],
};

export type CarDir = "r" | "l" | "u" | "d";

function buildCar(): Record<CarDir, HTMLCanvasElement> {
  const [r, rctx] = canvas(16, 16);
  drawCarSide(rctx);
  const [l, lctx] = canvas(16, 16);
  lctx.translate(16, 0);
  lctx.scale(-1, 1);
  lctx.drawImage(r, 0, 0);
  const [d, dctx] = canvas(16, 16);
  drawCarFront(dctx, false);
  const [u, uctx] = canvas(16, 16);
  drawCarFront(uctx, true);
  return { r, l, u, d };
}

function buildBuilding(zone: Zone): HTMLCanvasElement {
  const w = zone.scene.building.w;
  const h = zone.scene.building.h;
  const [c, ctx] = canvas(w, h);
  const k = "#16161d";
  const accent = zone.accent;
  const dark = shade(accent, -0.35);
  const light = shade(accent, 0.25);
  const roofH = 46;

  // roof
  rect(ctx, 0, 0, w, roofH, k);
  rect(ctx, 2, 2, w - 4, roofH - 4, accent);
  for (let y = 6; y < roofH - 4; y += 4) rect(ctx, 2, y, w - 4, 1, dark);
  for (let x = 6; x < w - 4; x += 8) rect(ctx, x, 2, 1, roofH - 4, dark);
  rect(ctx, 2, 2, w - 4, 2, light);
  rect(ctx, 2, roofH - 4, w - 4, 2, dark);

  // wall
  rect(ctx, 2, roofH, w - 4, h - roofH, k);
  rect(ctx, 3, roofH, w - 6, h - roofH - 1, "#d8dbe2");
  rect(ctx, 3, roofH, w - 6, 2, "#9aa0ac");
  for (const wx of [12, w - 28]) {
    rect(ctx, wx, roofH + 6, 16, 14, k);
    rect(ctx, wx + 1, roofH + 7, 14, 12, "#8fdcff");
    rect(ctx, wx + 1, roofH + 7, 14, 3, "#c7efff");
    rect(ctx, wx + 7, roofH + 7, 1, 12, k);
  }

  // door
  const dx = w / 2 - 10;
  rect(ctx, dx, roofH + 4, 20, h - roofH - 4, k);
  rect(ctx, dx + 2, roofH + 6, 16, h - roofH - 6, "#5a6a8a");
  rect(ctx, dx + 9, roofH + 6, 2, h - roofH - 6, k);

  // emblem on the roof
  const ex = w / 2;
  const ey = roofH / 2 + 1;
  disc(ctx, ex, ey, 11, k);
  disc(ctx, ex, ey, 9, "#f4f4f4");
  if (zone.kind === "contact") {
    // envelope
    rect(ctx, ex - 7, ey - 5, 14, 10, k);
    rect(ctx, ex - 6, ey - 4, 12, 8, "#f4f4f4");
    for (let i = 0; i < 6; i++) {
      rect(ctx, ex - 6 + i, ey - 4 + i, 1, 1, accent);
      rect(ctx, ex + 5 - i, ey - 4 + i, 1, 1, accent);
    }
  } else if (zone.kind === "gallery") {
    disc(ctx, ex, ey, 6, "#2a2d38");
    disc(ctx, ex, ey, 4, "#2f74e0");
    rect(ctx, ex - 2, ey - 2, 2, 2, "#cfe6ff");
  } else {
    disc(ctx, ex, ey, 7, accent);
    disc(ctx, ex, ey, 3, "#f4f4f4");
    rect(ctx, ex - 1, ey - 9, 2, 18, accent);
    rect(ctx, ex - 9, ey - 1, 18, 2, accent);
    disc(ctx, ex, ey, 2, "#f4f4f4");
  }
  return c;
}


// Oblique 3/4 view, like the other buildings: roof on top, plus the south and east faces
// peeking out below/right of it (the camera sits south-east of the garage).
function buildGarage(): HTMLCanvasElement {
  const w = GARAGE_W;
  const h = GARAGE_H;
  const d = 16; // how far the faces peek out
  const roofW = w - d;
  const roofH = h - d;
  const [c, ctx] = canvas(w, h);
  const k = "#16161d";

  // south face (parallelogram under the roof)
  for (let y = roofH; y < h; y++) {
    const off = y - roofH;
    rect(ctx, off, y, roofW, 1, k);
  }
  for (let y = roofH + 1; y < h - 1; y++) {
    const off = y - roofH;
    rect(ctx, off + 1, y, roofW - 2, 1, "#d8dbe2");
  }
  // panel seams + two small windows on the south wall
  for (let x = 12; x < roofW; x += 16) {
    for (let y = roofH + 1; y < h - 1; y++) rect(ctx, x + (y - roofH), y, 1, 1, "#b4b9c4");
  }
  for (const wx of [14, 54]) {
    for (let y = roofH + 4; y < roofH + 10; y++) rect(ctx, wx + (y - roofH), y, 14, 1, y === roofH + 4 ? "#c7efff" : "#8fdcff");
    for (let y = roofH + 3; y < roofH + 11; y += 7) rect(ctx, wx + (y - roofH) - 1, y, 16, 1, k);
  }

  // east face (parallelogram right of the roof) with the garage opening
  for (let x = roofW; x < w; x++) {
    const top = x - roofW;
    rect(ctx, x, top, 1, roofH, k);
  }
  for (let x = roofW + 1; x < w - 1; x++) {
    const top = x - roofW;
    rect(ctx, x, top + 1, 1, roofH - 2, "#aeb3bf");
  }
  for (let x = roofW + 3; x < w - 3; x++) {
    const top = x - roofW;
    rect(ctx, x, top + 6, 1, roofH - 12, k); // frame
    rect(ctx, x, top + 7, 1, roofH - 14, "#1d1f26"); // dark interior
    rect(ctx, x, top + roofH - 12, 1, 4, "#2c2f38"); // lit floor
    rect(ctx, x, top + 7, 1, 7, x % 2 ? "#b8bcc4" : "#9a9fa9"); // rolled-up door panel
    rect(ctx, x, top + 24, 1, 5, "#d8322c"); // toolbox glimpsed inside
  }

  // roof (drawn last so it overlaps both faces)
  rect(ctx, 0, 0, roofW, roofH, k);
  rect(ctx, 1, 1, roofW - 2, roofH - 2, "#b4b8c0");
  for (let x = 6; x < roofW - 2; x += 8) {
    rect(ctx, x, 1, 1, roofH - 2, "#9a9ea8");
    rect(ctx, x + 1, 1, 1, roofH - 2, "#c8ccd4");
  }
  for (let i = 0; i < 200; i++) {
    const px = 1 + ((i * 53) % (roofW - 2));
    const py = 1 + ((i * 29 + ((i * i) % 7)) % (roofH - 2));
    rect(ctx, px, py, 1, 1, i % 3 ? "#a2a6b0" : "#c0c4cc");
  }
  rect(ctx, 1, 1, roofW - 2, 2, "#d6d9e0");
  rect(ctx, 1, roofH - 3, roofW - 2, 2, "#8b909a");

  // CMR logo: just its black and red parts, directly on the roof
  const lw = CMR_LOGO[0].length;
  const lh = CMR_LOGO.length;
  const lx = Math.floor((roofW - lw) / 2);
  const ly = Math.floor((roofH - lh) / 2);
  CMR_LOGO.forEach((row, y) => {
    for (let x = 0; x < lw; x++) {
      const key = row[x];
      if (key === "k") rect(ctx, lx + x, ly + y, 1, 1, k);
      else if (key === "r") rect(ctx, lx + x, ly + y, 1, 1, "#a51c30");
    }
  });
  return c;
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
    ctx.fillRect(cx - half, cy + y, half * 2, 1);
  }
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)))
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface Sprites {
  item(kind: ItemKind, color?: ItemColor): HTMLCanvasElement;
  /** Free-form prop sprite by key (see scenes.ts). */
  get(id: string): HTMLCanvasElement;
  car: Record<CarDir, HTMLCanvasElement>;
  shadow: HTMLCanvasElement;
}

export function buildSprites(zones: Zone[]): Sprites {
  const cache = new Map<string, HTMLCanvasElement>();
  const recolors: Record<string, Recolor> = { o: {}, b: BLUE, r: RED, y: YELLOW };

  const item = (kind: ItemKind, color: ItemColor = "o") => {
    const key = `${kind}-${color}`;
    let sprite = cache.get(key);
    if (!sprite) {
      sprite = fromGrid(GRIDS[kind], recolors[color]);
      cache.set(key, sprite);
    }
    return sprite;
  };

  const draw = (w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void) => {
    const [c, ctx] = canvas(w, h);
    fn(ctx);
    return c;
  };

  const create = (id: string): HTMLCanvasElement => {
    if (id.startsWith("cone-")) return fromGrid(CONE_GRID, recolors[id.slice(5)]);
    if (id.startsWith("person-")) {
      const looks: Record<string, [string, string]> = {
        r: ["#d8322c", "#f4f4f4"],
        w: ["#f4f4f4", "#d8322c"],
        b: ["#2f74e0", "#16161d"],
      };
      const [shirt, cap] = looks[id.slice(7)] ?? looks.r;
      return draw(...PROP_SIZES.person, (ctx) => drawPerson(ctx, shirt, cap));
    }
    if (id.startsWith("bld:")) {
      const zone = zones.find((z) => z.id === id.slice(4))!;
      return buildBuilding(zone);
    }
    switch (id) {
      case "garage":
        return buildGarage();
      case "tirestack":
        return draw(...PROP_SIZES.tirestack, drawTireStack);
      case "battery":
        return draw(...PROP_SIZES.battery, drawBattery);
      case "laptop":
        return draw(...PROP_SIZES.laptop, drawSmallLaptop);
      case "formula":
        // nose to the right, parked in front of the garage opening
        return draw(...PROP_SIZES.formula, drawFormula);
    }
    throw new Error(`Unknown sprite: ${id}`);
  };

  const get = (id: string) => {
    let sprite = cache.get(id);
    if (!sprite) {
      sprite = create(id);
      cache.set(id, sprite);
    }
    return sprite;
  };

  const [shadow, sctx] = canvas(16, 16);
  sctx.fillStyle = GROUND.shadow;
  sctx.fillRect(2, 12, 12, 3);
  sctx.fillRect(3, 11, 10, 1);

  return { item, get, car: buildCar(), shadow };
}
