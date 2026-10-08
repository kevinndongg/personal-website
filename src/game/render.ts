import type { Car } from "./car";
import type { Vec } from "./astar";
import { GROUND } from "./palette";
import type { Sprites } from "./sprites";
import { shade } from "./sprites";
import { TILE, Terrain } from "./world";
import type { Decal, World } from "./world";

function hash(x: number, y: number, n = 0) {
  let h = (x * 374761393 + y * 668265263 + n * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawDecal(ctx: CanvasRenderingContext2D, d: Decal, accent: string) {
  if (d.kind === "checker") {
    const sq = 4;
    for (let y = 0; y < d.h; y += sq)
      for (let x = 0; x < d.w; x += sq) {
        ctx.fillStyle = ((x + y) / sq) % 2 === 0 ? "#f4f4f4" : "#16161d";
        ctx.fillRect(d.x + x, d.y + y, sq, sq);
      }
  } else if (d.kind === "cable") {
    ctx.fillStyle = "#16161d";
    for (let i = 1; i < d.points.length; i++) {
      const a = d.points[i - 1];
      const b = d.points[i];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
      for (let k = 0; k <= steps; k++)
        ctx.fillRect(Math.round(a.x + ((b.x - a.x) * k) / steps), Math.round(a.y + ((b.y - a.y) * k) / steps), 1, 1);
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

function buildGroundLayer(world: World, sprites: Sprites): HTMLCanvasElement {
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
        // diagonal hazard stripes
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

  // painted lane lines through the middle of the yard
  ctx.fillStyle = GROUND.laneLine;
  const midY = Math.round(world.start.y);
  for (let x = TILE * 2; x < world.w * TILE - TILE * 2; x += 24) ctx.fillRect(x, midY - 1, 12, 2);
  const midX = Math.round((world.w * TILE) / 2);
  for (let y = TILE * 2; y < world.h * TILE - TILE * 2; y += 24) {
    const inZone = world.zones.some((z) => {
      const a = z.scene.area;
      return y > a.y - TILE && y < a.y + a.h + TILE && midX > a.x - TILE && midX < a.x + a.w + TILE;
    });
    if (!inZone) ctx.fillRect(midX - 1, y, 2, 12);
  }

  // thin black border around each project area
  ctx.fillStyle = "#16161d";
  for (const z of world.zones) {
    const a = z.scene.area;
    ctx.fillRect(a.x, a.y, a.w, 1);
    ctx.fillRect(a.x, a.y + a.h - 1, a.w, 1);
    ctx.fillRect(a.x, a.y, 1, a.h);
    ctx.fillRect(a.x + a.w - 1, a.y, 1, a.h);
  }

  for (const z of world.zones) {
    for (const d of z.scene.decals) drawDecal(ctx, d, z.accent);
    // flat props (laptops on the floor, etc.)
    for (const p of z.scene.props) {
      if (!p.ground) continue;
      const img = sprites.get(p.sprite);
      ctx.drawImage(img, Math.round(p.x - img.width / 2), Math.round(p.y - img.height));
    }
  }

  // ground-level clutter (drive-over items)
  for (const item of world.items) {
    if (item.solid) continue;
    ctx.drawImage(sprites.shadow, item.tx * TILE, item.ty * TILE);
    ctx.drawImage(sprites.item(item.kind, item.color), item.tx * TILE, item.ty * TILE);
  }
  return c;
}

export interface Marker {
  x: number;
  y: number;
}

export class Renderer {
  private ground: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private sprites: Sprites
  ) {
    this.ground = buildGroundLayer(world, sprites);
    this.ctx = canvas.getContext("2d")!;
  }

  draw(car: Car, marker: Marker | null, time: number) {
    const { ctx, world, sprites } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.ground, 0, 0);

    this.drawPath(car, time);
    if (marker) this.drawMarker(marker, time);

    // y-sorted: solid clutter, buildings, car
    type Drawable = { y: number; draw: () => void };
    const drawables: Drawable[] = [];
    for (const item of world.items) {
      if (!item.solid) continue;
      const x = item.tx * TILE;
      const y = item.ty * TILE;
      drawables.push({
        y: y + TILE,
        draw: () => {
          ctx.drawImage(sprites.shadow, x, y);
          ctx.drawImage(sprites.item(item.kind, item.color), x, y);
        },
      });
    }
    for (const zone of world.zones) {
      for (const p of zone.scene.props) {
        if (p.ground) continue;
        const img = sprites.get(p.sprite);
        const x = Math.round(p.x - img.width / 2);
        const y = Math.round(p.y - img.height);
        const small = img.width < 40;
        drawables.push({
          y: p.y,
          draw: () => {
            if (small) {
              ctx.fillStyle = GROUND.shadow;
              ctx.fillRect(x + 1, Math.round(p.y) - 1, img.width - 2, 2);
            }
            ctx.drawImage(img, x, y);
          },
        });
      }
    }
    drawables.push({
      y: car.y + 6,
      draw: () => {
        ctx.drawImage(sprites.shadow, Math.round(car.x - 8), Math.round(car.y - 8) + 1);
        ctx.drawImage(sprites.car[car.dir], Math.round(car.x - 8), Math.round(car.y - 8));
      },
    });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
  }

  private drawPath(car: Car, time: number) {
    if (!car.path.length) return;
    const { ctx } = this;
    ctx.fillStyle = GROUND.pathDot;
    const pts: Vec[] = [{ x: car.x, y: car.y }, ...car.path];
    const phase = (time * 24) % 10; // dots march toward the goal
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const first = (10 - ((acc - phase + 10) % 10)) % 10;
      for (let d = first; d < len; d += 10) {
        const t = d / len;
        ctx.fillRect(Math.round(a.x + (b.x - a.x) * t) - 1, Math.round(a.y + (b.y - a.y) * t) - 1, 2, 2);
      }
      acc += len;
    }
  }

  private drawMarker(m: Marker, time: number) {
    if (Math.floor(time * 4) % 2) return;
    const { ctx } = this;
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    ctx.fillStyle = "#16161d";
    ctx.fillRect(x - 4, y - 1, 9, 3);
    ctx.fillRect(x - 1, y - 4, 3, 9);
    ctx.fillStyle = GROUND.marker;
    ctx.fillRect(x - 3, y, 7, 1);
    ctx.fillRect(x, y - 3, 1, 7);
  }
}
