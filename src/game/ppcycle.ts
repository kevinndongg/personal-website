// The Power Play robot's loop, forever: it parks for a moment, then drives to the red stack on the north wall, and from then on it
// does two jobs in turn. Each job: level claw open wider than the cone, the robot drives up so that the cone stands between the
// jaws, the jaws close on it near its wide end, the lift raises it off the floor (or the stack), and the wrist pivots up 135 degrees
// so the cone hangs with its narrow end down and back over the robot. Then it drives to the middle of the tile beside a junction,
// lifting as it goes, swings the turret out so the arm reaches over the pole (the claw rolling a little about its own axis), pivots
// the wrist back to level so the cone stands wide end down over the pole as it was when it was picked up, lowers it and lets go: the
// cone slides down the pole. The first job takes the top cone of the stack to the high junction; the second takes the human
// player's cone, standing against the west wall, to the medium one.
//
// The game pieces are persistent. The stack's top cone and the human's cone vanish as the jaws close on them and a fresh one grows
// back once the robot has driven off; the cone it places shows on the pole until the robot has driven away, and then shrinks, so
// the next lap can do it again. That is `ftcField` (ftcfield.ts), worked out every frame from where the robot is in its loop.
//
// Like robotcycle.ts it only sets the prop's x, z and heading (the hover lift owns its height), and poses the model through
// `userData.pose` (see ftcpprobot.ts). It never turns while it is between two poles: it backs and drives along the lane with the
// same heading and only spins on the spot at the middle of a tile, where there is room.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { PP, PP_WAIT, clawDir, ftcField, heldBase, poleTop } from "./ftcfield";
import type { PPPose } from "./ftcpprobot";
import type { AnimCtx } from "./models";
import type { PowerPlayCycle, PowerPlayPick, PowerPlayPlace } from "./scenes";

const SPEED = 36; // px/s along the route (the robot eases out of and into each stop)
const CLEAR = 6.5; // how far a cone is lifted to get it off the stack, or the floor, before the wrist turns it over
const LIFT_OVER = 1.5; // how much higher than its final height the arm swings out over a pole, and then lowers

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const ramp = (t: number, t0: number, dur: number) => smooth((t - t0) / dur);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type Arm = Omit<PPPose, "carrying">;
type Channel = keyof Arm;

interface Pose {
  x: number;
  y: number;
  h: number; // heading, radians in the world plane (y = south)
}

/** Something that happens to the field at a moment in a phase (`offset` seconds in). */
interface Mark {
  what: "pick" | "spawn" | "drop" | "clear";
  index: number; // the cone (`ftcField.cone`) or the junction (`ftcField.placed`): stack / human, high / medium
  offset: number;
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop), turning to `turn` by the end of the phase if it is given. */
  at?: Pose;
  turn?: number;
  /** Or the route it drives, with the heading it sets off with and the one it stops with. */
  route?: { curve: CatmullRomCurve3; h0: number; h1: number };
  arm: [Arm, Arm];
  /** When, as a fraction of the phase, each joint moves (the rest move throughout), so that one joint can follow another. */
  when?: Partial<Record<Channel, [number, number]>>;
  carry: (u: number) => boolean;
  mark?: Mark;
}

/** How long each thing that happens to the field takes. */
const FADE = { pick: 0.06, spawn: 0.4, drop: 0.55, clear: 0.4 };

export function attachPowerPlay(model: Group, cfg: PowerPlayCycle) {
  const home: Pose = { x: model.position.x, y: model.position.z, h: -model.rotation.y };

  /** A robot-frame offset (x forward, z to its right) as a world one, for a robot facing `h`. */
  const world = (h: number, fx: number, rz: number) => ({
    x: Math.cos(h) * fx - Math.sin(h) * rz,
    y: Math.sin(h) * fx + Math.cos(h) * rz,
  });

  /**
   * Where the robot stands to take a cone: the claw level and the arm straight ahead, the cone's base straight ahead of the
   * robot, and the pivot's height.
   */
  const pick = (c: PowerPlayPick) => {
    const [a, up] = heldBase(0, 0);
    const o = world(c.heading, PP.turretX + a, 0);
    const at: Pose = { x: c.target.x - o.x, y: c.target.y - o.y, h: c.heading };
    return { at, arm: { lift: c.base - up, yaw: 0, tilt: 0, twist: 0, claw: 1 } as Arm };
  };

  /**
   * Where the robot stands to put a cone on a pole, and how the arm is turned and raised: the turret exactly a quarter turn to the
   * `side` of the pole, so the robot parks where that puts the cone's base (wrist level, claw rolled a little) over the pole's top.
   * Also, for the pole that the cone is let go over, which way it leans.
   */
  const place = (c: PowerPlayPlace, index: number) => {
    const twist = c.side * PP.twist;
    const yaw = (c.side * Math.PI) / 2;
    const [a, up, b] = heldBase(0, twist);
    const fx = PP.turretX + a * Math.cos(yaw) - b * Math.sin(yaw);
    const rz = a * Math.sin(yaw) + b * Math.cos(yaw);
    const o = world(c.heading, fx, rz);
    const at: Pose = { x: c.target.x - o.x, y: c.target.y - o.y, h: c.heading };
    const lift = poleTop(c.top) + PP.above - up;
    // the cone's axis, base to tip, as the claw holds it: up, rolled by `twist` towards the arm's side
    const axis = clawDir([0, 1, 0], 0, twist);
    const w = world(c.heading, axis[0] * Math.cos(yaw) - axis[2] * Math.sin(yaw), axis[0] * Math.sin(yaw) + axis[2] * Math.cos(yaw));
    ftcField.lean[index] = [w.x, axis[1], w.y];
    return { at, arm: { lift, yaw, tilt: 0, twist, claw: 0 } as Arm };
  };

  const A = pick(cfg.stack);
  const C = pick(cfg.human);
  const B = place(cfg.high, 0);
  const D = place(cfg.medium, 1);

  const curve = (pts: { x: number; y: number }[]) => {
    const c = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, 0, p.y)),
      false,
      "centripetal"
    );
    c.arcLengthDivisions = 600;
    return c;
  };
  /** A straight run between two stops with the heading held (the robot backs or drives, never turning between poles). */
  const run = (from: Pose, to: { x: number; y: number }, h: number, min: number) => {
    const c = curve([from, to]);
    return { dur: Math.max(min, c.getLength() / SPEED), route: { curve: c, h0: h, h1: h } };
  };
  const never = () => false;
  const always = () => true;

  // ---- the arm poses along the way
  const held = (p: Arm): Arm => ({ ...p, claw: 0 });
  const raised = (p: Arm): Arm => ({ ...p, lift: p.lift + CLEAR });
  const carried = (p: Arm): Arm => ({ ...p, tilt: PP.tilt });
  const open = (p: Arm): Arm => ({ ...p, claw: 1 });
  const higher = (p: Arm, d: number): Arm => ({ ...p, lift: p.lift + d });

  /** Closing on a cone, raising it off, and pivoting the wrist over: the arm ends carrying it, with the wrist at 135 degrees. */
  const takePhases = (s: { at: Pose; arm: Arm }, index: number): Phase[] => {
    const got = held(s.arm);
    return [
      { dur: 0.4, at: s.at, arm: [s.arm, got], carry: (u) => u >= 0.75, mark: { what: "pick", index, offset: 0.3 } },
      { dur: 0.55, at: s.at, arm: [got, raised(got)], carry: always },
      { dur: 0.8, at: s.at, arm: [raised(got), carried(raised(got))], carry: always },
    ];
  };

  /**
   * At a pole: the arm swings out with the cone still hanging, the wrist pivots back to level (the cone stands wide end down over the
   * pole), it lowers and lets go; then the arm lifts clear and swings back to `back` (the pick-up yaw), the claw level and ready.
   */
  const placePhases = (s: { at: Pose; arm: Arm }, index: number, from: Arm, back: Arm): Phase[] => {
    const swung: Arm = { ...carried(s.arm), lift: s.arm.lift + LIFT_OVER };
    const over: Arm = { ...s.arm, lift: swung.lift };
    const clear: Arm = open(over);
    return [
      { dur: 0.8, at: s.at, arm: [from, swung], carry: always },
      { dur: 0.65, at: s.at, arm: [swung, over], carry: always },
      { dur: 0.25, at: s.at, arm: [over, s.arm], carry: always },
      { dur: 0.4, at: s.at, arm: [s.arm, open(s.arm)], carry: (u) => u < 0.2, mark: { what: "drop", index, offset: 0.08 } },
      { dur: 0.3, at: s.at, arm: [open(s.arm), clear], carry: never },
      { dur: 0.7, at: s.at, arm: [clear, { ...clear, yaw: back.yaw, twist: 0 }], carry: never },
    ];
  };

  const overB = higher(B.arm, LIFT_OVER).lift; // the high pole's height, which the arm has to be above whenever it swings or the robot spins near it
  const overD = higher(D.arm, LIFT_OVER).lift;
  const carriedA = carried(raised(held(A.arm)));
  const carriedC = carried(raised(held(C.arm)));
  const toB: Arm = { ...carriedA, lift: overB };
  const toD: Arm = { ...carriedC, lift: overD };
  // the point in the lane, between the two junctions, where it spins on the spot; it faces north along the lane and west along the row
  const X: Pose = { x: B.at.x, y: C.at.y, h: A.at.h };
  const westOfX: Pose = { ...X, h: C.at.h };

  const loop: Phase[] = [];
  // the stack: take the top cone
  loop.push(...takePhases(A, 0));
  // back down the lane to the high junction, lifting as it goes; a new cone grows on the stack
  loop.push({
    ...run(A.at, B.at, A.at.h, 1.3),
    arm: [carriedA, toB],
    when: { lift: [0, 0.75] },
    carry: always,
    mark: { what: "spawn", index: 0, offset: 0.3 },
  });
  loop.push(...placePhases(B, 0, toB, A.arm));
  // up the lane to the spin point (the cone it put there goes), where it turns to face the human player's cone, the arm lowering as it drives
  const afterB: Arm = { ...A.arm, lift: overB, claw: 1 };
  loop.push({ ...run(B.at, X, B.at.h, 0.8), arm: [afterB, afterB], carry: never, mark: { what: "clear", index: 0, offset: 0.1 } });
  loop.push({ dur: 0.55, at: X, turn: C.at.h, arm: [afterB, afterB], carry: never });
  loop.push({ ...run(westOfX, C.at, C.at.h, 1), arm: [afterB, C.arm], when: { lift: [0.1, 0.85] }, carry: never });
  loop.push(...takePhases(C, 1));
  // backing out along the row to the spin point, the arm rising to the medium junction's height; a new cone appears
  loop.push({
    ...run(C.at, westOfX, C.at.h, 1),
    arm: [carriedC, toD],
    when: { lift: [0.05, 0.9] },
    carry: always,
    mark: { what: "spawn", index: 1, offset: 0.3 },
  });
  loop.push({ dur: 0.55, at: westOfX, turn: D.at.h, arm: [toD, toD], carry: always });
  loop.push({ ...run(X, D.at, D.at.h, 0.8), arm: [toD, toD], carry: always });
  loop.push(...placePhases(D, 1, toD, A.arm));
  // and up the lane to the stack: the claw lowers
  const afterD: Arm = { ...A.arm, lift: overD, claw: 1 };
  loop.push({
    ...run(D.at, A.at, A.at.h, 1),
    arm: [afterD, A.arm],
    when: { lift: [0.3, 1] },
    carry: never,
    mark: { what: "clear", index: 1, offset: 0.2 },
  });
  const loopTotal = loop.reduce((s, p) => s + p.dur, 0);

  // the way in, once: parked for a moment, then along the row to the middle of the tile beside the stack, a quarter turn, and up
  // to the stack with the claw coming down to level and open
  const P: Pose = { x: A.at.x, y: home.y, h: home.h };
  const waiting: Arm = { ...PP_WAIT };
  const intro: Phase[] = [
    { dur: 0.4, at: home, arm: [waiting, waiting], carry: never },
    { ...run(home, P, home.h, 1), arm: [waiting, waiting], carry: never },
    { dur: 0.55, at: P, turn: A.at.h, arm: [waiting, waiting], carry: never },
    { ...run(P, A.at, A.at.h, 1), arm: [waiting, A.arm], when: { tilt: [0, 0.5], yaw: [0, 0.5], lift: [0.3, 0.9] }, carry: never },
  ];
  const introTotal = intro.reduce((s, p) => s + p.dur, 0);

  // when, in the loop, each thing happens to the field
  const events: { what: Mark["what"]; index: number; at: number }[] = [];
  let clock = 0;
  for (const p of loop) {
    if (p.mark) events.push({ what: p.mark.what, index: p.mark.index, at: clock + p.mark.offset });
    clock += p.dur;
  }

  /** The field at `tl` seconds into the loop: a cone taken is gone until its replacement grows in; a placed one falls, stays, and shrinks away. */
  const field = (tl: number) => {
    const cone = [1, 1];
    const placed = [0, 0];
    for (const ev of events) {
      if (ev.what === "pick") cone[ev.index] -= ramp(tl, ev.at, FADE.pick);
      else if (ev.what === "spawn") cone[ev.index] += ramp(tl, ev.at, FADE.spawn);
      else if (ev.what === "drop") placed[ev.index] += ramp(tl, ev.at, FADE.drop);
      else placed[ev.index] += ramp(tl, ev.at, FADE.clear);
    }
    for (let i = 0; i < 2; i++) {
      ftcField.cone[i] = Math.min(1, Math.max(0, cone[i]));
      ftcField.placed[i] = Math.min(2, Math.max(0, placed[i]));
    }
  };

  const channels: Channel[] = ["lift", "yaw", "tilt", "twist", "claw"];

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: parked, the arm up, every cone where it was

    // which phase, and how far through it
    let list = intro;
    let e = t;
    if (t >= introTotal) {
      list = loop;
      e = (t - introTotal) % loopTotal;
      field(e);
    } else field(0);
    let i = 0;
    while (i < list.length - 1 && e >= list[i].dur) e -= list[i++].dur;
    const ph = list[i];
    const u = e / ph.dur;
    const k = smooth(u);

    let at: Pose;
    if (ph.route) {
      const p = ph.route.curve.getPointAt(k);
      at = { x: p.x, y: p.z, h: ph.route.h0 + wrap(ph.route.h1 - ph.route.h0) * k };
    } else if (ph.turn !== undefined) {
      at = { ...ph.at!, h: ph.at!.h + wrap(ph.turn - ph.at!.h) * k };
    } else {
      at = ph.at!;
    }
    model.position.x = at.x;
    model.position.z = at.y;
    model.rotation.y = -at.h;

    const arm = {} as Arm;
    for (const c of channels) {
      const w = ph.when?.[c];
      arm[c] = lerp(ph.arm[0][c], ph.arm[1][c], w ? smooth((u - w[0]) / (w[1] - w[0])) : k);
    }
    const pose = model.userData.pose as ((p: PPPose) => void) | undefined;
    pose?.({ ...arm, carrying: ph.carry(u) });
  };
}
