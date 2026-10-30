// The Power Play robot's loop, forever: it parks for a moment, then drives to the red stack on the north wall, and from then on it
// does two jobs in turn. Each job: level claw open wider than the cone, the robot drives up so that the cone stands between the
// jaws, the jaws close on it near its wide end, the lift raises it off the floor (or the stack), and the wrist pivots up 135 degrees
// so the cone hangs with its narrow end down and back over the robot. Then it drives to a junction, lifting as it goes, stops in the
// lane beside it, swings the turret a quarter turn so the arm lies across the lane over the pole (the claw rolling a little about its
// own axis), and lets go: the cone slides down the pole. The first job takes the top cone of the stack to the high junction; the
// second takes the human player's cone, standing against the west wall, to the medium one.
//
// The game pieces are persistent. The stack's top cone and the human's cone vanish as the jaws close on them and a fresh one grows
// back once the robot has driven off; the cone it places shows on the pole until the robot has driven away, and then shrinks, so
// the next lap can do it again. That is `ftcField` (ftcfield.ts), worked out every frame from where the robot is in its loop.
//
// Like robotcycle.ts it only sets the prop's x, z and heading (the hover lift owns its height), and poses the model through
// `userData.pose` (see ftcpprobot.ts). It never turns while it is between two poles: it backs and drives along the lanes with the
// same heading and only spins on the spot at the middle of a tile, where there is room.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { PP, PP_WAIT, coneTip, ftcField, poleTop } from "./ftcfield";
import type { PPPose } from "./ftcpprobot";
import type { AnimCtx } from "./models";
import type { PowerPlayCycle, PowerPlayPick, PowerPlayPlace } from "./scenes";

const SPEED = 36; // px/s along the route (the robot eases out of and into each stop)
const CLEAR = 5.5; // how far a cone is lifted to get it off the stack, or the floor, before the wrist turns it over

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

  /** Where the robot stands to take a cone, claw level straight ahead of it, and the claw's height. */
  const pick = (c: PowerPlayPick) => {
    const o = world(c.heading, PP.turretX + PP.arm + PP.grip, 0);
    const at: Pose = { x: c.target.x - o.x, y: c.target.y - o.y, h: c.heading };
    return { at, arm: { lift: c.base + PP.hold, yaw: 0, tilt: 0, twist: 0, claw: 1 } as Arm };
  };

  /**
   * Where it stands to put a cone on a pole: the claw's wrist pivoted to 135 degrees and the arm swung a quarter turn to the
   * `side`, with the cone's narrow end just over the pole's cap. The cone leans a little to the side (the twist), so the robot
   * stands a little off square to the pole.
   */
  const place = (c: PowerPlayPlace) => {
    const twist = c.side * PP.twist;
    const yaw = (c.side * Math.PI) / 2;
    const tip = coneTip(PP.tilt, twist);
    const a = PP.arm + tip[0];
    const b = tip[2];
    const fx = PP.turretX + a * Math.cos(yaw) - b * Math.sin(yaw);
    const rz = a * Math.sin(yaw) + b * Math.cos(yaw);
    const o = world(c.heading, fx, rz);
    const at: Pose = { x: c.target.x - o.x, y: c.target.y - o.y, h: c.heading };
    const lift = poleTop(c.top) + PP.above - tip[1];
    return { at, arm: { lift, yaw, tilt: PP.tilt, twist, claw: 0 } as Arm };
  };

  const A = pick(cfg.stack);
  const C = pick(cfg.human);
  const B = place(cfg.high);
  const D = place(cfg.medium);
  // the lane the robot runs along between the poles, and where it crosses the row it takes to the human player's cone
  const X: Pose = { x: (B.at.x + D.at.x) / 2, y: C.at.y, h: A.at.h };

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
  const turnedOver = (p: Arm): Arm => ({ ...p, tilt: PP.tilt });
  const squared = (p: Arm): Arm => ({ ...p, yaw: 0, twist: 0 }); // the arm straight ahead, the claw not rolled
  const open = (p: Arm): Arm => ({ ...p, claw: 1 });

  /** Closing on a cone, raising it off, and pivoting the wrist over: the arm ends carrying it, with the wrist at 135 degrees. */
  const takePhases = (s: { at: Pose; arm: Arm }, index: number): Phase[] => {
    const got = held(s.arm);
    return [
      { dur: 0.4, at: s.at, arm: [s.arm, got], carry: (u) => u >= 0.75, mark: { what: "pick", index, offset: 0.3 } },
      { dur: 0.55, at: s.at, arm: [got, raised(got)], carry: always },
      { dur: 0.8, at: s.at, arm: [raised(got), turnedOver(raised(got))], carry: always },
    ];
  };

  /** Swinging the arm across, letting go and holding still while the cone slides down. */
  const placePhases = (s: { at: Pose; arm: Arm }, index: number, over: Arm): Phase[] => [
    { dur: 0.9, at: s.at, arm: [over, s.arm], carry: always },
    { dur: 0.45, at: s.at, arm: [s.arm, open(s.arm)], carry: (u) => u < 0.2, mark: { what: "drop", index, offset: 0.09 } },
    { dur: 0.3, at: s.at, arm: [open(s.arm), open(s.arm)], carry: never },
  ];

  const carriedA = turnedOver(raised(held(A.arm)));
  const overB: Arm = { ...squared(carriedA), lift: B.arm.lift }; // lifted to the pole's height before the arm swings
  const awayB: Arm = open(squared(B.arm));
  const carriedC = turnedOver(raised(held(C.arm)));
  const overD: Arm = { ...squared(carriedC), lift: D.arm.lift };
  const awayD: Arm = open(squared(D.arm));
  const readyC: Arm = C.arm;

  const loop: Phase[] = [];
  // the stack: take the top cone
  loop.push(...takePhases(A, 0));
  // back down the lane to the high junction, lifting as it goes; a new cone grows on the stack
  loop.push({
    ...run(A.at, B.at, A.at.h, 1.3),
    arm: [carriedA, overB],
    when: { lift: [0, 0.75] },
    carry: always,
    mark: { what: "spawn", index: 0, offset: 0.3 },
  });
  loop.push(...placePhases(B, 0, overB));
  // away from the high junction: the arm swings back as it drives to the crossing, and the cone it put there goes
  loop.push({
    ...run(B.at, X, B.at.h, 0.9),
    arm: [open(B.arm), awayB],
    when: { yaw: [0, 0.7], twist: [0, 0.7] },
    carry: never,
    mark: { what: "clear", index: 0, offset: 0.45 },
  });
  // at the middle of the tile it turns to face the human player's cone, the claw coming down to level; then the arm lowers as it drives
  loop.push({ dur: 0.55, at: X, turn: C.at.h, arm: [awayB, { ...awayB, tilt: 0 }], carry: never });
  loop.push({
    ...run(X, C.at, C.at.h, 1),
    arm: [{ ...awayB, tilt: 0 }, readyC],
    when: { lift: [0.1, 0.85] },
    carry: never,
  });
  loop.push(...takePhases(C, 1));
  // backing out along the row to the crossing, with the arm rising to the medium junction's height; a new cone appears
  loop.push({
    ...run(C.at, X, C.at.h, 1),
    arm: [carriedC, overD],
    when: { lift: [0.05, 0.9] },
    carry: always,
    mark: { what: "spawn", index: 1, offset: 0.3 },
  });
  loop.push({ dur: 0.55, at: { ...X, h: C.at.h }, turn: D.at.h, arm: [overD, overD], carry: always });
  loop.push({ ...run(X, D.at, D.at.h, 1), arm: [overD, overD], carry: always });
  loop.push(...placePhases(D, 1, overD));
  // and up the lane to the stack: the arm swings back, the wrist comes round to level and the claw lowers
  loop.push({
    ...run(D.at, A.at, A.at.h, 1),
    arm: [open(D.arm), A.arm],
    when: { yaw: [0, 0.35], twist: [0, 0.35], tilt: [0.2, 0.6], lift: [0.4, 1] },
    carry: never,
    mark: { what: "clear", index: 1, offset: 0.35 },
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
    { ...run(P, A.at, A.at.h, 1), arm: [waiting, A.arm], when: { tilt: [0, 0.5], lift: [0.3, 0.9] }, carry: never },
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
