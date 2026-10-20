// A prop that drives a lap now and then (the formula car): out of its parking spot, round the path, and home again.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import type { AnimCtx } from "./models";

const SPEED = 60; // average px/s over a lap (it eases out of and into the parking spot, so it peaks at 1.5x)
const FIRST = [8, 14]; // seconds after the scene starts to the first lap
const GAP = [20, 30]; // seconds from the end of one lap to the next
const SETTLE = 0.08; // the last part of the lap (as a fraction of it) over which the heading eases to the parked one

/** Where the car is while it is out on a lap, for anyone who watches it go by (the typist at the laptop). */
export const carWatch = { driving: false, x: 0, z: 0 };

const between =([a, b]: number[]) => a + Math.random() * (b - a);
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

  let start = -1; // when the lap in progress began (-1: parked)
  let next = -1; // when the next lap starts by itself
  let requested = false;

  model.userData.drive = () => {
    if (start >= 0 || requested) return false;
    requested = true;
    return true;
  };
  model.userData.lapState = () => ({ start, next, requested, duration });

  carWatch.driving = false;

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: the car stays put
    if (next < 0) next = t + between(FIRST);
    if (start < 0) {
      if (!requested && t < next) return;
      start = t;
      requested = false;
    }
    const elapsed = t - start;
    if (elapsed >= duration) {
      model.position.x = home.x;
      model.position.z = home.z;
      model.rotation.y = home.ry;
      start = -1;
      next = t + between(GAP);
      carWatch.driving = false;
      return;
    }
    carWatch.driving = true;
    const u = smooth(elapsed / duration);
    const p = curve.getPointAt(u);
    const d = curve.getTangentAt(u);
    let heading = Math.atan2(d.z, d.x);
    // coming home, ease the heading onto the parked one (the way round, never the long way)
    const w = smooth(Math.min(1, Math.max(0, (u - (1 - SETTLE)) / SETTLE)));
    const diff = Math.atan2(Math.sin(-home.ry - heading), Math.cos(-home.ry - heading));
    heading += diff * w;
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -heading;
    carWatch.x = p.x;
    carWatch.z = p.z;
  };
}
