// A prop that drives a lap now and then (the formula car): out of its parking spot, round the path, and home again.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import type { AnimCtx } from "./models";

const SPEED = 60; // average px/s over a lap (it eases out of and into the parking spot, so it peaks at 1.5x)
const SPIN = 0.9; // seconds to turn round in the bay once it is back: it drives in nose first and parks facing out again
const FIRST = [8, 14]; // seconds after the scene starts to the first lap
const GAP = [20, 30]; // seconds from the end of one lap to the next

const between = ([a, b]: number[]) => a + Math.random() * (b - a);
const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * Makes `model` follow `path` (world px; its first and last points are where it is parked) on its own every so often.
 * `model.userData.drive()` starts a lap on demand, and returns whether it did (false while one is already under way).
 * Only x, z and the heading are touched: the hover lift owns the model's height.
 */
export function attachLap(model: Group, path: { x: number; y: number }[]) {
  const curve = new CatmullRomCurve3(
    path.map((p) => new Vector3(p.x, 0, p.y)),
    false,
    "centripetal"
  );
  curve.arcLengthDivisions = 1500;
  const duration = curve.getLength() / SPEED;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };
  const endHeading = (() => {
    const t = curve.getTangentAt(1);
    return Math.atan2(t.z, t.x);
  })();

  let start = -1; // when the lap in progress began (-1: parked)
  let next = -1; // when the next lap starts by itself
  let requested = false;

  model.userData.drive = () => {
    if (start >= 0 || requested) return false;
    requested = true;
    return true;
  };

  model.userData.animate = ({ t, focus }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: the car stays put
    if (next < 0) next = t + between(FIRST);
    if (start < 0) {
      if (!requested && !(t >= next && focus < 0.01)) return;
      start = t;
      requested = false;
    }
    const elapsed = t - start;
    if (elapsed >= duration + SPIN) {
      model.position.x = home.x;
      model.position.z = home.z;
      model.rotation.y = home.ry;
      start = -1;
      next = t + between(GAP);
      return;
    }
    if (elapsed < duration) {
      const u = smooth(elapsed / duration);
      const p = curve.getPointAt(u);
      const d = curve.getTangentAt(u);
      model.position.x = p.x;
      model.position.z = p.z;
      model.rotation.y = -Math.atan2(d.z, d.x);
    } else {
      const p = curve.getPointAt(1);
      model.position.x = p.x;
      model.position.z = p.z;
      model.rotation.y = -(endHeading + Math.PI * smooth((elapsed - duration) / SPIN));
    }
  };
}
