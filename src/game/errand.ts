// A crew member who now and then comes out of the garage's side door, walks to the grill for a burger, and walks back in.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import type { AnimCtx } from "./models";

/** How far the garage's side door stands open (0 shut, 1 open): the walker asks for it, the garage swings the leaf. */
export const crewDoor = { open: 0 };

/** What the walker model is told each frame (`userData.pose`): how far along the stride, how hard he swings, and so on. */
export interface WalkerPose {
  phase: number; // radians through the step cycle
  swing: number; // 0 standing .. 1 walking
  reach: number; // 0..1, the right arm out toward the grill's table
  burger: boolean; // a burger in his hand
}

const SPEED = 22; // px/s
const STRIDE = 7; // px per full step cycle (both legs)
const FIRST = [12, 20]; // seconds after the scene starts to the first trip
const GAP = [30, 60]; // seconds from the end of one trip to the next
const OPENING = 0.6; // the door gets this long to open before he goes out
const PAUSE = 2.6; // at the grill
const PICK = 1.2; // seconds into the pause when the burger is in his hand
const TURN = 0.5; // turning round at the grill
const DOOR_NEAR = 18; // px along the route within which the door stands open
const DOOR_IN = 4; // px from the start, on the way back, at which he is through it

const between = ([a, b]: number[]) => a + Math.random() * (b - a);
const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Makes `model` (a walker with `userData.pose`) take the trip along `route` (world px, from just inside the door to where
 * he stands at the grill, facing `face`) every so often. He only sets x, z and heading; the hover lift owns the height.
 */
export function attachErrand(model: Group, route: { x: number; y: number }[], face: number) {
  const curve = new CatmullRomCurve3(
    route.map((p) => new Vector3(p.x, 0, p.y)),
    false,
    "centripetal"
  );
  curve.arcLengthDivisions = 600;
  const L = curve.getLength();
  const walk = L / SPEED;
  const at = (s: number) => curve.getPointAt(Math.min(1, Math.max(0, s / L)));
  const heading = (s: number, back: boolean) => {
    const d = curve.getTangentAt(Math.min(1, Math.max(0, s / L)));
    return Math.atan2(back ? -d.z : d.z, back ? -d.x : d.x);
  };
  const endOut = heading(L, false);
  const endBack = heading(L, true);

  let start = -1;
  let next = -1;
  model.visible = false;

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: nobody leaves the garage
    if (next < 0) next = t + between(FIRST);
    if (start < 0) {
      if (t < next) return;
      start = t;
      model.visible = true;
    }
    const e = t - start;
    const total = OPENING + walk + PAUSE + TURN + walk;
    if (e >= total) {
      start = -1;
      next = t + between(GAP);
      model.visible = false;
      crewDoor.open = 0;
      return;
    }

    let s: number; // distance along the route
    let head: number;
    let swing = 0;
    let travelled: number;
    let reach = 0;
    let burger = false;
    const eo = e - OPENING; // time since he set off
    const ep = eo - walk; // time since he reached the grill
    const eb = ep - PAUSE - TURN; // time since he set off back
    if (eo < 0) {
      s = 0;
      head = heading(0, false);
      travelled = 0;
    } else if (ep < 0) {
      s = eo * SPEED;
      head = heading(s, false);
      swing = Math.min(1, eo / 0.4, (walk - eo) / 0.4);
      travelled = s;
    } else if (ep < PAUSE) {
      s = L;
      head = endOut + wrap(face - endOut) * smooth(ep / TURN);
      travelled = L;
      reach = smooth((ep - 0.3) / 0.5) * (1 - smooth((ep - PICK) / 0.4) * 0.15);
      burger = ep >= PICK;
    } else if (ep < PAUSE + TURN) {
      s = L;
      head = face + wrap(endBack - face) * smooth((ep - PAUSE) / TURN);
      travelled = L;
      burger = true;
    } else {
      s = L - eb * SPEED;
      head = heading(s, true);
      swing = Math.min(1, eb / 0.4, (walk - eb) / 0.4);
      travelled = L + eb * SPEED;
      burger = s > DOOR_IN + 2;
    }

    // the door stands open while he is close to it, going out and coming back, and shuts once he is clear / through
    const back = ep >= PAUSE + TURN;
    crewDoor.open = (!back && s < DOOR_NEAR) || (back && s < DOOR_NEAR && s > DOOR_IN) ? 1 : 0;
    if (!back && eo < 0) crewDoor.open = 1;

    const p = at(s);
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -head;
    (model.userData.pose as ((p: WalkerPose) => void) | undefined)?.({
      phase: (travelled / STRIDE) * 2 * Math.PI,
      swing,
      reach,
      burger,
    });
  };
}
