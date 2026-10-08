import { CAR, GROUND, SPRITE_PALETTE } from "./palette";
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
  const [c, ctx] = canvas(16, 16);
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
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

export const BUILDING_W = 8;
export const BUILDING_H = 5;

function buildBuilding(zone: Zone): HTMLCanvasElement {
  const w = BUILDING_W * 16;
  const h = BUILDING_H * 16;
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
  if (zone.kind === "gallery") {
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
  car: Record<CarDir, HTMLCanvasElement>;
  buildings: Map<string, HTMLCanvasElement>;
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

  const [shadow, sctx] = canvas(16, 16);
  sctx.fillStyle = GROUND.shadow;
  sctx.fillRect(2, 12, 12, 3);
  sctx.fillRect(3, 11, 10, 1);

  const buildings = new Map<string, HTMLCanvasElement>();
  for (const zone of zones) buildings.set(zone.id, buildBuilding(zone));

  return { item, car: buildCar(), buildings, shadow };
}
