import { Vector3 } from "three";
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

  if (bare) for (const z of world.zones) paintRoad(ctx, z.scene.props);

  for (const z of world.zones) for (const d of z.scene.decals) drawDecal(ctx, d, z.accent);
  return c;
}

/**
 * The paved paddock of a project with a car (the forest preview, where there are no asphalt tiles): wide where the cones stand,
 * narrower on the way back so it keeps clear of the tent, filling the lawn the lap encloses, and with a rough, worn edge.
 */
function paintRoad(ctx: CanvasRenderingContext2D, props: Prop[]) {
  const car = props.find((p) => p.drive);
  if (!car?.drive) return;
  const cones = props.filter((p) => p.sprite === "cone-b" || p.sprite === "cone-y");
  const curve = lapCurve(car.drive);
  const len = curve.getLength();
  // (the first point is inside the garage: start at the mouth of the bay, the second)
  const from = new Vector3(car.drive[1].x, 0, car.drive[1].y);
  let u0 = 0;
  for (let u = 0, best = Infinity; u <= 0.2; u += 0.002) {
    const d = curve.getPointAt(u).distanceTo(from);
    if (d < best) {
      best = d;
      u0 = u;
    }
  }
  const samples: { x: number; y: number; hw: number }[] = [];
  for (let s = u0 * len; s <= len; s += 1) {
    const p = curve.getPointAt(s / len);
    let near = Infinity;
    for (const k of cones) near = Math.min(near, Math.hypot(k.x - p.x, k.y - p.z));
    const t = 1 - Math.min(1, Math.max(0, (near - 24) / 30));
    samples.push({ x: p.x, y: p.z, hw: 11 + 9 * t * t * (3 - 2 * t) });
  }
  // The shape: the strip itself, plus everything the lap encloses (the loop and the way back leave a hole of lawn between them, which
  // is part of the paddock). It is drawn as a coverage field, blurred, and then cut at a noisy level, so that the edge is round,
  // ragged and uneven instead of following the car's line.
  const M = 40;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of samples) {
    x0 = Math.min(x0, s.x - s.hw);
    y0 = Math.min(y0, s.y - s.hw);
    x1 = Math.max(x1, s.x + s.hw);
    y1 = Math.max(y1, s.y + s.hw);
  }
  const ox = Math.floor(x0) - M;
  const oy = Math.floor(y0) - M;
  const W = Math.ceil(x1) + M - ox;
  const H = Math.ceil(y1) + M - oy;
  const fill = document.createElement("canvas");
  fill.width = W;
  fill.height = H;
  const fctx = fill.getContext("2d")!;
  fctx.fillStyle = "#fff";
  fctx.beginPath();
  samples.forEach((s, i) => (i % 3 === 0 ? (i ? fctx.lineTo(s.x - ox, s.y - oy) : fctx.moveTo(s.x - ox, s.y - oy)) : 0));
  fctx.closePath();
  fctx.fill();
  const alpha = fctx.getImageData(0, 0, W, H).data;
  let cover = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) cover[i] = alpha[i * 4 + 3] / 255;
  for (const s of samples) {
    const r = s.hw + 3; // (the strip a little wider than the cones' line, so they stand well inside the edge)
    for (let py = Math.floor(s.y - r); py <= Math.ceil(s.y + r); py++)
      for (let px = Math.floor(s.x - r); px <= Math.ceil(s.x + r); px++)
        if (Math.hypot(px + 0.5 - s.x, py + 0.5 - s.y) <= r) cover[(py - oy) * W + (px - ox)] = 1;
  }
  cover = boxBlur(boxBlur(cover, W, H, 5), W, H, 5);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(W, H);
  const edgeCol = rgb(GROUND.roadEdge);
  const body = rgb(GROUND.asphalt[0]);
  const specks = GROUND.asphaltSpeck.map(rgb);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i + ox;
      const y = j + oy;
      // a large wobble and a fine one: the cut level wanders, so the edge is lumpy and a little frayed
      const v = cover[j * W + i] + (valueNoise(x / 10, y / 10, 5) - 0.5) * 0.4 + (valueNoise(x / 3.2, y / 3.2, 6) - 0.5) * 0.16;
      const o = (j * W + i) * 4;
      if (v > 0.44) {
        const a = Math.min(1, (v - 0.44) / 0.1); // (the last pixel or two of the edge dither out into the lawn)
        const wear = 1 - Math.min(1, Math.max(0, (v - 0.5) / 0.2)); // darker, crumbling rim, clean in the middle
        const patch = 1 + (valueNoise(x / 22, y / 22, 7) - 0.5) * 0.14;
        let r = body.r * patch;
        let g = body.g * patch;
        let b = body.b * patch;
        r += (edgeCol.r - r) * 0.6 * wear;
        g += (edgeCol.g - g) * 0.6 * wear;
        b += (edgeCol.b - b) * 0.6 * wear;
        if (hash(x, y, 71) < 0.045) {
          const sp = specks[hash(x, y, 72) < 0.5 ? 0 : 1];
          r = sp.r;
          g = sp.g;
          b = sp.b;
        }
        img.data[o] = Math.round(255 * Math.min(1, r));
        img.data[o + 1] = Math.round(255 * Math.min(1, g));
        img.data[o + 2] = Math.round(255 * Math.min(1, b));
        img.data[o + 3] = Math.round(255 * a);
      } else if (v > 0.3 && hash(x, y, 73) < 0.4 * ((v - 0.3) / 0.14)) {
        // grit that has crept out onto the grass
        const sp = specks[hash(x, y, 74) < 0.5 ? 0 : 1];
        img.data[o] = Math.round(255 * sp.r);
        img.data[o + 1] = Math.round(255 * sp.g);
        img.data[o + 2] = Math.round(255 * sp.b);
        img.data[o + 3] = 200;
      }
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(out, ox, oy);
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

/** A box blur of a `w` x `h` field, `r` px each way (zero outside). */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += x >= 0 && x < w ? src[y * w + x] : 0;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / n;
      const add = x + r + 1;
      const drop = x - r;
      sum += (add < w ? src[y * w + add] : 0) - (drop >= 0 ? src[y * w + drop] : 0);
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += y >= 0 && y < h ? tmp[y * w + x] : 0;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      const add = y + r + 1;
      const drop = y - r;
      sum += (add < h ? tmp[add * w + x] : 0) - (drop >= 0 ? tmp[drop * w + x] : 0);
    }
  }
  return out;
}
