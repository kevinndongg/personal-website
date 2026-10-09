import { GROUND } from "./palette";
import { TILE, Terrain } from "./world";
import type { Decal, World } from "./world";

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
  } else {
    // parking pad: dark accent fill, hazard-striped edge, arrow
    ctx.fillStyle = shade(d.color || accent, -0.5);
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.fillStyle = "#16161d";
    ctx.fillRect(d.x, d.y, d.w, 2);
    ctx.fillRect(d.x, d.y + d.h - 2, d.w, 2);
    ctx.fillRect(d.x, d.y, 2, d.h);
    ctx.fillRect(d.x + d.w - 2, d.y, 2, d.h);
    ctx.fillStyle = GROUND.borderStripe;
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
  c.width = world.w * TILE;
  c.height = world.h * TILE;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      const t = world.terrain[ty * world.w + tx];
      const x = tx * TILE;
      const y = ty * TILE;
      const alt = (tx + ty) & 1;
      if (t === Terrain.Border) {
        ctx.fillStyle = GROUND.border[alt];
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = GROUND.borderStripe;
        for (let py = 0; py < TILE; py++)
          for (let px = 0; px < TILE; px++)
            if ((((x + px + y + py) >> 2) & 1) === 0 && py > 3 && py < TILE - 3) ctx.fillRect(x + px, y + py, 1, 1);
        continue;
      }
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

  // thin black border around each project area
  ctx.fillStyle = "#16161d";
  for (const z of world.zones) {
    const a = z.scene.area;
    ctx.fillRect(a.x, a.y, a.w, 2);
    ctx.fillRect(a.x, a.y + a.h - 2, a.w, 2);
    ctx.fillRect(a.x, a.y, 2, a.h);
    ctx.fillRect(a.x + a.w - 2, a.y, 2, a.h);
  }

  for (const z of world.zones) for (const d of z.scene.decals) drawDecal(ctx, d, z.accent);
  return c;
}
