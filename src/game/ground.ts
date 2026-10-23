import { GROUND } from "./palette";
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

/** The flat floor of the whole map as one texture: asphalt tiles, lane lines, area outlines, decals. */
export function buildGroundLayer(world: World): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = world.w * TILE + 2 * GROUND_MARGIN;
  c.height = world.h * TILE + 2 * GROUND_MARGIN;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  // from here on, coordinates are map coordinates; the margin sits at negative values
  ctx.translate(GROUND_MARGIN, GROUND_MARGIN);

  const mt = GROUND_MARGIN / TILE;
  for (let ty = -mt; ty < world.h + mt; ty++) {
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
    if (z.kind === "link" || z.kind === "about") continue; // (no black box round the mailbox or the name)
    const a = z.scene.area;
    ctx.fillRect(a.x, a.y, a.w, 2);
    ctx.fillRect(a.x, a.y + a.h - 2, a.w, 2);
    ctx.fillRect(a.x, a.y, 2, a.h);
    ctx.fillRect(a.x + a.w - 2, a.y, 2, a.h);
  }

  for (const z of world.zones) for (const d of z.scene.decals) drawDecal(ctx, d, z.accent);
  return c;
}
