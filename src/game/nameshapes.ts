import { ShapePath } from "three";
import type { Shape } from "three";
import { NAME_BOX, NAME_PATH } from "./namepath";

export interface NameShapes {
  /** The letters, with their counters as holes, y-up. The baseline is y = 0 and the middle of the name is x = 0. */
  shapes: Shape[];
  /** The top of the capitals and the bottom of the `g`'s tail (negative), in the same units as the shapes. */
  top: number;
  bottom: number;
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
  return { shapes: path.toShapes(), top: NAME_BOX.y1 * k, bottom: NAME_BOX.y0 * k };
}
