import { Path, Shape, ShapePath } from "three";
import type { Vector2 } from "three";
import { NAME_BOX, NAME_PATH } from "./namepath";

export interface NameShapes {
  /** The letters, with their counters as holes, y-up. The baseline is y = 0 and the middle of the name is x = 0. */
  shapes: Shape[];
  /** The top of the capitals and the bottom of the `g`'s tail (negative), in the same units as the shapes. */
  top: number;
  bottom: number;
}

/** How far a simplified outline may stray from the true curve, in world px: no more than the curves were flattened by before. */
const TOLERANCE = 0.03;
/** How finely the curves are cut before they are simplified (the error of that is a fraction of `TOLERANCE`). */
const DIVISIONS = 16;

/** How far `p` is from the segment `a`-`b` (from `a` alone when the two are the same point). */
function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/**
 * Douglas-Peucker: the fewest of `points` (the ends always kept) that keep the line within `tolerance` of them. Long straight
 * stretches and gentle curves, which the baked path cuts into dozens of points, become a few; corners stay.
 */
function simplifyLine(points: Vector2[], tolerance: number): Vector2[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const spans: [number, number][] = [[0, points.length - 1]];
  while (spans.length) {
    const [from, to] = spans.pop()!;
    let far = -1;
    let worst = tolerance;
    for (let k = from + 1; k < to; k++) {
      const d = distanceToSegment(points[k], points[from], points[to]);
      if (d > worst) {
        worst = d;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      spans.push([from, far], [far, to]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** A letter (or a letter's counter) as straight segments only: the extrusion makes a wall, and a bevel, of every one of them. */
function simplified(shape: Shape): Shape {
  const { shape: outline, holes } = shape.extractPoints(DIVISIONS);
  const out = new Shape(simplifyLine(outline, TOLERANCE));
  out.holes = holes.map((hole) => new Path(simplifyLine(hole, TOLERANCE)));
  return out;
}

/** The baked outline (see scripts/bake-name-path.mjs) as three.js shapes, scaled so that the name is `width` wide. */
export function nameShapes(width: number): NameShapes {
  const k = width / (NAME_BOX.x1 - NAME_BOX.x0);
  const dx = (NAME_BOX.x0 + NAME_BOX.x1) / 2;
  const px = (v: number) => (v - dx) * k;
  const py = (v: number) => v * k;

  const path = new ShapePath();
  for (const [, cmd, args] of NAME_PATH.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = args.trim() ? args.trim().split(/\s+/).map(Number) : [];
    if (cmd === "M") path.moveTo(px(n[0]), py(n[1]));
    else if (cmd === "L") path.lineTo(px(n[0]), py(n[1]));
    else if (cmd === "Q") path.quadraticCurveTo(px(n[0]), py(n[1]), px(n[2]), py(n[3]));
    else if (cmd === "C") path.bezierCurveTo(px(n[0]), py(n[1]), px(n[2]), py(n[3]), px(n[4]), py(n[5]));
    // "Z": a subpath closes by itself when it is made into a shape
  }
  return { shapes: path.toShapes().map(simplified), top: NAME_BOX.y1 * k, bottom: NAME_BOX.y0 * k };
}
