import { lapCurve } from "./drive";
import { GROUND } from "./palette";
import type { Prop } from "./scenes";
import { TILE, Terrain } from "./world";
import type { Decal, World } from "./world";

/** Extra asphalt painted past the map on every side; only visible in the "fade" edge mode. */
export const GROUND_MARGIN = 3 * TILE;

function hash(x: number, y: number, n = 0) {
  let h = (x * 374761393 + y * 668265263 + n * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)))
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function drawDecal(ctx: CanvasRenderingContext2D, d: Decal, accent: string) {
  if (d.kind === "checker") {
    // pixel-by-pixel inverse mapping keeps the rotated squares crisp
    const sq = 4;
    const cos = Math.cos(d.angle);
    const sin = Math.sin(d.angle);
    const r = Math.ceil(Math.hypot(d.w, d.h) / 2) + 1;
    for (let py = Math.floor(d.y) - r; py <= Math.floor(d.y) + r; py++)
      for (let px = Math.floor(d.x) - r; px <= Math.floor(d.x) + r; px++) {
        const dx = px + 0.5 - d.x;
        const dy = py + 0.5 - d.y;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        if (Math.abs(u) >= d.w / 2 || Math.abs(v) >= d.h / 2) continue;
        ctx.fillStyle = (Math.floor((u + d.w / 2) / sq) + Math.floor((v + d.h / 2) / sq)) % 2 === 0 ? "#f4f4f4" : "#16161d";
        ctx.fillRect(px, py, 1, 1);
      }
  } else if (d.kind === "frame") {
    // painted pit box: yellow outline (2 px, so it survives the pixel board) around a lighter asphalt fill, rotated per pixel
    const t = 2;
    const cos = Math.cos(d.angle);
    const sin = Math.sin(d.angle);
    const r = Math.ceil(Math.hypot(d.w, d.h) / 2) + 1;
    for (let py = Math.floor(d.y) - r; py <= Math.floor(d.y) + r; py++)
      for (let px = Math.floor(d.x) - r; px <= Math.floor(d.x) + r; px++) {
        const dx = px + 0.5 - d.x;
        const dy = py + 0.5 - d.y;
        const u = Math.abs(dx * cos + dy * sin);
        const v = Math.abs(-dx * sin + dy * cos);
        if (u >= d.w / 2 || v >= d.h / 2) continue;
        ctx.fillStyle = u >= d.w / 2 - t || v >= d.h / 2 - t ? d.color : d.fill;
        ctx.fillRect(px, py, 1, 1);
      }
  } else if (d.kind === "cable") {
    ctx.fillStyle = "#16161d";
    for (let i = 1; i < d.points.length; i++) {
      const a = d.points[i - 1];
      const b = d.points[i];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
      for (let k = 0; k <= steps; k++)
        ctx.fillRect(Math.round(a.x + ((b.x - a.x) * k) / steps), Math.round(a.y + ((b.y - a.y) * k) / steps), 2, 2);
    }
  } else if (d.kind === "pool") {
    ctx.beginPath();
    d.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = d.fill;
    ctx.fill();
    if (d.border) {
      ctx.strokeStyle = d.border;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    if (d.speckle) {
      const xs = d.points.map((q) => q.x);
      const ys = d.points.map((q) => q.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      for (let i = 0; i < (x1 - x0) * (y1 - y0) * 0.05; i++) {
        const px = x0 + hash(i, 3, 91) * (x1 - x0);
        const py = y0 + hash(i, 5, 17) * (y1 - y0);
        ctx.fillStyle = d.speckle[i % d.speckle.length];
        ctx.fillRect(Math.floor(px), Math.floor(py), 1, 1);
      }
    }
  } else {
    // parking pad: dark accent fill, accent-coloured edge dashes, arrow
    ctx.fillStyle = shade(d.color || accent, -0.5);
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.fillStyle = "#16161d";
    ctx.fillRect(d.x, d.y, d.w, 2);
    ctx.fillRect(d.x, d.y + d.h - 2, d.w, 2);
    ctx.fillRect(d.x, d.y, 2, d.h);
    ctx.fillRect(d.x + d.w - 2, d.y, 2, d.h);
    ctx.fillStyle = shade(d.color || accent, 0.35);
    for (let x = d.x + 4; x < d.x + d.w - 6; x += 8) {
      ctx.fillRect(x, d.y + 2, 4, 2);
      ctx.fillRect(x, d.y + d.h - 4, 4, 2);
    }
    ctx.fillStyle = "#f4f4f4";
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    ctx.fillRect(cx - 1, cy - 4, 2, 8);
    ctx.fillRect(cx - 3, cy - 2, 6, 2);
    ctx.fillRect(cx - 5, cy, 10, 2);
  }
}

/**
 * The flat floor of the whole map as one texture: asphalt tiles, lane lines, area outlines, decals. With `bare` there are no
 * tiles and no outlines, only the decals on a transparent sheet (the forest preview: the projects stand on the forest floor,
 * which is drawn under this one).
 */
export function buildGroundLayer(world: World, bare = false): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = world.w * TILE + 2 * GROUND_MARGIN;
  c.height = world.h * TILE + 2 * GROUND_MARGIN;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  // from here on, coordinates are map coordinates; the margin sits at negative values
  ctx.translate(GROUND_MARGIN, GROUND_MARGIN);

  const mt = bare ? 0 : GROUND_MARGIN / TILE;
  for (let ty = -mt; ty < (bare ? 0 : world.h + mt); ty++) {
    for (let tx = -mt; tx < world.w + mt; tx++) {
      const inside = tx >= 0 && ty >= 0 && tx < world.w && ty < world.h;
      const t = inside ? world.terrain[ty * world.w + tx] : Terrain.Asphalt;
      const x = tx * TILE;
      const y = ty * TILE;
      const alt = (tx + ty) & 1;
      const concrete = t === Terrain.Concrete;
      ctx.fillStyle = (concrete ? GROUND.concrete : GROUND.asphalt)[alt];
      ctx.fillRect(x, y, TILE, TILE);
      const speck = concrete ? GROUND.concreteSpeck : GROUND.asphaltSpeck;
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = speck[hash(tx, ty, i + 11) < 0.5 ? 0 : 1];
        ctx.fillRect(x + Math.floor(hash(tx, ty, i) * TILE), y + Math.floor(hash(tx, ty, i + 40) * TILE), 1, 1);
      }
      if (concrete) {
        ctx.fillStyle = GROUND.concreteJoint;
        ctx.fillRect(x, y + TILE - 1, TILE, 1);
        ctx.fillRect(x + TILE - 1, y, 1, TILE);
      } else if (hash(tx, ty, 99) < 0.06) {
        ctx.fillStyle = GROUND.oil;
        ctx.fillRect(x + 4, y + 6, 7, 4);
        ctx.fillRect(x + 6, y + 4, 4, 8);
      }
    }
  }

  // thin black border around each project area (a contact button is no area to look into: it stands on the plain yard)
  ctx.fillStyle = "#16161d";
  for (const z of world.zones) {
    if (bare || z.kind === "link" || z.kind === "about") continue; // (no black box round a slab or the name)
    const a = z.scene.area;
    ctx.fillRect(a.x, a.y, a.w, 2);
    ctx.fillRect(a.x, a.y + a.h - 2, a.w, 2);
    ctx.fillRect(a.x, a.y, 2, a.h);
    ctx.fillRect(a.x + a.w - 2, a.y, 2, a.h);
  }

  for (const z of world.zones)
    for (const d of z.scene.decals) {
      // (the forest: the field stands on the grass, so the dark carpet the yard laid under it is left out)
      if (bare && z.variant === "ftc" && d.kind === "pool") continue;
      drawDecal(ctx, d, z.accent);
    }
  return c;
}

/**
 * The paved lot of a project with an autonomous car (the forest preview, where there are no asphalt tiles). The car finds its way
 * by the cones, so the pavement draws no route: it is an open lot with a plain shape of its own, a rounded rectangle like the other
 * projects' pads, big enough for the whole course and for the car's way back. Lighter, weathered grey, with a worn kerb, a few oil
 * stains and cracks.
 *
 * It is drawn on a sheet of its own (not on the ground's), which the renderer lifts with the project: the cones and the garage
 * rise on hover, and so must what they stand on, or their shadows slide off them. Where it lies, and its outline, are returned
 * so the renderer can give the sheet a thin edge to show when it has risen.
 */
export interface Lot {
  canvas: HTMLCanvasElement;
  /** The sheet's top-left corner and size on the map, in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The rounded rectangle: its centre, half sizes and corner radius. */
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  r: number;
}

export function buildLot(props: Prop[]): Lot | null {
  const car = props.find((p) => p.drive);
  if (!car?.drive) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number, m: number) => {
    x0 = Math.min(x0, x - m);
    y0 = Math.min(y0, y - m);
    x1 = Math.max(x1, x + m);
    y1 = Math.max(y1, y + m);
  };
  // the cones with room round them, and the car's way (out of the bay, round, and back in beside the tent) with a little
  for (const k of props) if (k.sprite === "cone-b" || k.sprite === "cone-y") grow(k.x, k.y, 24);
  const curve = lapCurve(car.drive);
  for (let u = 0; u <= 1; u += 0.005) {
    const p = curve.getPointAt(u);
    grow(p.x, p.z, 7);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const R = 16;
  /** How far a point is outside the lot (negative inside it): a rounded rectangle. */
  const sdf = (x: number, y: number) => {
    const qx = Math.abs(x - cx) - (hw - R);
    const qy = Math.abs(y - cy) - (hh - R);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
  };

  const M = 3; // (little: the sheet's own shadow-catcher covers it all, and the ground's is under it)
  const ox = Math.floor(x0) - M;
  const oy = Math.floor(y0) - M;
  const W = Math.ceil(x1) + M - ox;
  const H = Math.ceil(y1) + M - oy;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(W, H);

  const body = rgb(shade(GROUND.asphalt[0], 0.2));
  const kerb = rgb(shade(GROUND.asphalt[0], 0.5));
  const edge = rgb(GROUND.roadEdge);
  const specks = GROUND.asphaltSpeck.map((s) => rgb(shade(s, 0.2)));
  // oil stains, scattered over the lot (the same every time)
  const stains = Array.from({ length: 7 }, (_, i) => ({
    x: x0 + 30 + hash(i, 1, 81) * (x1 - x0 - 60),
    y: y0 + 30 + hash(i, 2, 81) * (y1 - y0 - 60),
    r: 6 + hash(i, 3, 81) * 6,
  }));

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i + ox;
      const y = j + oy;
      // (the outline wanders a pixel or two: a built edge, not a ruled one)
      const d = sdf(x + 0.5, y + 0.5) + (valueNoise(x / 7, y / 7, 31) - 0.5) * 1.6;
      if (d > 1.6) continue;
      let c = body;
      if (d > -1.6) c = edge;
      else if (d > -3.8 && valueNoise(x / 6, y / 6, 43) > 0.3) c = kerb; // (a worn kerb, gone in places)
      let r = c.r;
      let g = c.g;
      let b = c.b;
      if (c === body) {
        let k = 1 + (valueNoise(x / 24, y / 24, 7) - 0.5) * 0.16 + (valueNoise(x / 5, y / 5, 8) - 0.5) * 0.05;
        for (const s of stains) {
          const t = 1 - Math.hypot(x - s.x, (y - s.y) * 1.3) / s.r;
          if (t > 0) k *= 1 - 0.3 * t * t * (3 - 2 * t);
        }
        // cracks: thin dark lines along where a slow noise crosses its middle, in some places only
        if (Math.abs(valueNoise(x / 11, y / 11, 41) - 0.5) < 0.014 && valueNoise(x / 40, y / 40, 42) > 0.5) k *= 0.7;
        r *= k;
        g *= k;
        b *= k;
        if (hash(x, y, 71) < 0.04) {
          const sp = specks[hash(x, y, 72) < 0.5 ? 0 : 1];
          r = sp.r;
          g = sp.g;
          b = sp.b;
        }
      }
      const o = (j * W + i) * 4;
      img.data[o] = Math.round(255 * Math.min(1, r));
      img.data[o + 1] = Math.round(255 * Math.min(1, g));
      img.data[o + 2] = Math.round(255 * Math.min(1, b));
      img.data[o + 3] = Math.round(255 * Math.min(1, 1.6 - d));
    }
  }
  octx.putImageData(img, 0, 0);
  return { canvas: out, x: ox, y: oy, w: W, h: H, cx, cy, hw, hh, r: R };
}

/** A hex colour as plain 0..1 channels (as the rest of this file paints it: no colour management). */
function rgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** A smooth value noise, 0..1, on a lattice of random values (the same everywhere, every time). */
function valueNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
