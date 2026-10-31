// The Power Play robot's loop, forever, starting at the red stack on the north wall: two jobs in turn, each one a single flowing drive
// rather than a string of separate moves.
//
// The job at the stack: the jaws close on the cone, and the robot backs away at once, lifting the cone off and pivoting the wrist up
// 135 degrees as it goes; a little later the slides start up to the junction's height. As it passes the middle of the second tile
// the turret begins to swing out (the wrist still up), the wrist comes back down to level while it turns and then the claw rolls
// the cone a little, and the robot creeps the last few pixels until the cone is over the pole. It lowers the slides slightly and
// lets go: the cone slides down. Then it retracts at once: wrist up, a short delay, turret centred, slides all the way down, while
// it turns and drives off, and the slides rise again on the approach to the next cone. The job at the ground cone is the same.
// The stack's cone goes to the MEDIUM junction, the human player's cone (standing against the west wall) to the HIGH one, which
// the robot reaches facing west along the row, with the pole on its left.
//
// The game pieces are persistent. The stack's top cone and the human's cone vanish as the jaws close on them and a fresh one grows
// back once the robot has driven off; the cone it places shows on the pole until the robot has driven away, and then shrinks, so
// the next lap can do it again. That is `ftcField` (ftcfield.ts), worked out every frame from where the robot is in its loop.
//
// Like robotcycle.ts it only sets the prop's x, z and heading (the hover lift owns its height), and poses the model through
// `userData.pose` (see ftcpprobot.ts). It never turns while it is between two poles: it backs and drives along the lane with the
// same heading and only spins or curves where there is room.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { PP, clawDir, ftcField, heldBase, poleTop } from "./ftcfield";
import type { PPPose } from "./ftcpprobot";
import type { AnimCtx } from "./models";
import type { PowerPlayCycle, PowerPlayPick, PowerPlayPlace } from "./scenes";

const CRUISE = 14; // px/s as the robot passes the middle of the tile on its way to a pole, and from there it creeps
const LIFT_OVER = 1.5; // how much higher than its final height the arm swings out over a pole, and then lowers
const STOW = 3.4; // the slides all the way down (the carriage's foot on the chassis)
const HALF_TILE = 10;
const GONE = 14; // how far (px) the robot has driven from a stop before the cone it leaves there changes (a placed one shrinks, a taken one is replaced)

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const ramp = (t: number, t0: number, dur: number) => smooth((t - t0) / dur);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A speed profile along a route: how far along it the robot is after `u` of the phase, leaving at slope `v0` and arriving at slope `v1` (1 = the average speed). */
const hermite = (v0: number, v1: number) => (u: number) => {
  const u2 = u * u;
  const u3 = u2 * u;
  return (u3 - 2 * u2 + u) * v0 + (-2 * u3 + 3 * u2) + (u3 - u2) * v1;
};

type Arm = Omit<PPPose, "carrying">;
type Channel = keyof Arm;
/** A joint's value at moments of a phase, `[u, value]`, eased from one to the next. */
type Keys = [number, number][];

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
  /** For a drop: which way the cone leans as it is let go (world x east, y up, z south). */
  lean?: [number, number, number];
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop), turning to `turn` by the end of the phase if it is given. */
  at?: Pose;
  turn?: number;
  /** Or the route it drives, with the heading it sets off with and the one it stops with, and its speed profile (the default eases in and out). */
  route?: { curve: CatmullRomCurve3; h0: number; h1: number; ease?: (u: number) => number };
  arm: [Arm, Arm];
  /** When, as a fraction of the phase, each joint moves (the rest move throughout), so that one joint can follow another. */
  when?: Partial<Record<Channel, [number, number]>>;
  /** Or a joint's own track of values through the phase, which overrides the two above. */
  keys?: Partial<Record<Channel, Keys>>;
  carry: (u: number) => boolean;
  mark?: Mark;
}

/** How long each thing that happens to the field takes. */
const FADE = { pick: 0.06, spawn: 0.4, drop: 0.55, clear: 0.4 };

export function attachPowerPlay(model: Group, cfg: PowerPlayCycle) {
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
   * Also which way the cone leans as it is let go.
   */
  const place = (c: PowerPlayPlace) => {
    const twist = -c.side * PP.twist; // the cone's bottom leans ahead, towards where the robot is driving, and its top trails
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
    return { at, arm: { lift, yaw, tilt: 0, twist, claw: 0 } as Arm, lean: [w.x, axis[1], w.y] as [number, number, number] };
  };

  const A = pick(cfg.stack); // the stack, facing north
  const C = pick(cfg.human); // the ground cone, facing west
  const B = place(cfg.high); // the high junction, from the row, facing west
  const D = place(cfg.medium); // the medium junction, from the lane, facing north
  const M = place(cfg.mediumRow); // the medium junction, from the row, facing west

  const curve = (pts: { x: number; y: number }[]) => {
    const c = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, 0, p.y)),
      false,
      "centripetal"
    );
    c.arcLengthDivisions = 600;
    return c;
  };
  /** A run along `pts` taking `dur`, leaving at `v0` px/s and arriving at `v1`; the heading goes from `h0` to `h1`. */
  const leg = (pts: { x: number; y: number }[], h0: number, h1: number, dur: number, v0: number, v1: number) => {
    const c = curve(pts);
    const d = c.getLength();
    return { dur, route: { curve: c, h0, h1, ease: hermite((v0 * dur) / d, (v1 * dur) / d) } };
  };
  /** How many seconds into a driving phase the robot is first `dist` px from `from` (the phase's end if it never is). */
  const farOffset = (ph: { dur: number; route: { curve: CatmullRomCurve3; ease?: (u: number) => number } }, from: { x: number; y: number }, dist: number) => {
    for (let n = 0; n <= 200; n++) {
      const u = n / 200;
      const q = ph.route.curve.getPointAt(Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : smooth(u))));
      if (Math.hypot(q.x - from.x, q.z - from.y) >= dist) return u * ph.dur;
    }
    return ph.dur;
  };
  const never = () => false;
  const always = () => true;

  // ---- the arm poses along the way
  const held = (p: Arm): Arm => ({ ...p, claw: 0 });
  const open = (p: Arm): Arm => ({ ...p, claw: 1 });
  const overB = B.arm.lift + LIFT_OVER; // each junction's height, over which the arm swings out before it lowers
  const overD = D.arm.lift + LIFT_OVER;
  const overM = M.arm.lift + LIFT_OVER;
  const stowed = (p: Arm): Arm => ({ ...p, lift: STOW, yaw: 0, tilt: PP.tilt, twist: 0, claw: 1 });
  const key = (...k: [number, number][]): Keys => k;

  /** Closing the jaws on a cone, and nothing more: the next phase drives off in the same breath. */
  const grab = (s: { at: Pose; arm: Arm }, index: number): Phase => ({
    dur: 0.4,
    at: s.at,
    arm: [s.arm, held(s.arm)],
    carry: (u) => u >= 0.75,
    mark: { what: "pick", index, offset: 0.3 },
  });

  /**
   * From a cone to a pole, backing: a cruise to the middle of the second tile with the cone lifted clear, the wrist pivoting up and the
   * slides rising to the junction's height; then a slow creep to the stand, during which the turret swings out (the wrist still up), the
   * wrist comes down and the claw rolls; then it lowers the slides a little and lets go. `mid` is where the cruise ends.
   */
  const toPole = (from: { at: Pose; arm: Arm }, to: { at: Pose; arm: Arm; lean: [number, number, number] }, mid: { x: number; y: number }, over: number, spawn: number, drop: number, wristFirst: boolean): Phase[] => {
    const h = from.at.h;
    const base = held(from.arm);
    const toMid = leg([from.at, mid], h, h, wristFirst ? 1.9 : 1.55, 0, CRUISE);
    const creep = leg([mid, to.at], h, h, 1.7, CRUISE, 0);
    const lined: Arm = { ...to.arm, lift: over };
    // The cone is ready by the end of the cruise: the turret starts swinging while the slides are still rising (the wrist still up), and the wrist
    // comes down and the claw rolls the cone in the same window, so the creep is only a crawl. From the floor the wrist pivots up first with
    // the slides still all the way down, then they go the whole way up in one move; from the stack the slides start up at once (the cone has
    // to come up out of the stack before the wrist turns it over).
    const [turret0, down0, ready] = wristFirst ? [0.5, 0.6, 0.95] : [0.5, 0.62, 0.95];
    const keys: Partial<Record<Channel, Keys>> = {
      yaw: key([turret0, 0], [0.85, to.arm.yaw]),
      tilt: wristFirst
        ? key([0, 0], [0.3, PP.tilt], [down0, PP.tilt], [ready, 0])
        : key([0.3, 0], [0.6, PP.tilt], [down0, PP.tilt], [ready, 0]),
      twist: key([down0, 0], [ready, to.arm.twist]),
      lift: wristFirst ? key([0.3, base.lift], [0.75, over]) : key([0, base.lift], [0.55, over]),
    };
    return [
      { ...toMid, arm: [base, lined], keys, carry: always, mark: { what: "spawn", index: spawn, offset: farOffset(toMid, from.at, GONE) } }, // the new cone appears once the robot has driven well away
      { ...creep, arm: [lined, lined], carry: always },
      { dur: 0.3, at: to.at, arm: [lined, held(to.arm)], carry: always },
      { dur: 0.4, at: to.at, arm: [held(to.arm), open(to.arm)], carry: (u) => u < 0.2, mark: { what: "drop", index: drop, offset: 0.06, lean: to.lean } },
    ];
  };

  /** Off a pole: wrist up first, then after a short delay the turret centres and the slides go all the way down. */
  const retractKeys = (from: Arm): Partial<Record<Channel, Keys>> => ({
    tilt: key([0, 0], [0.3, PP.tilt]),
    yaw: key([0.25, from.yaw], [0.6, 0]),
    twist: key([0.25, from.twist], [0.6, 0]),
    lift: key([0.3, from.lift], [0.9, STOW]),
  });
  /** And on the way to the next cone: the wrist comes down to level and the slides rise to its height. */
  const approachKeys = (to: Arm): Partial<Record<Channel, Keys>> => ({
    tilt: key([0.3, PP.tilt], [0.85, 0]),
    lift: key([0.25, STOW], [1, to.lift]),
  });

  // the middle of the second tile along each drive to a pole: x = -30 along the row to the high junction, y = -30 down the lane to the medium
  const midB = (() => {
    const x = cfg.high.target.x - HALF_TILE;
    const t = (x - C.at.x) / (B.at.x - C.at.x);
    return { x, y: lerp(C.at.y, B.at.y, t) };
  })();
  const midM = (() => {
    const x = cfg.mediumRow.target.x - HALF_TILE;
    const t = (x - C.at.x) / (M.at.x - C.at.x);
    return { x, y: lerp(C.at.y, M.at.y, t) };
  })();
  const midD = (() => {
    const y = cfg.medium.target.y - HALF_TILE;
    const t = (y - A.at.y) / (D.at.y - A.at.y);
    return { x: lerp(A.at.x, D.at.x, t), y };
  })();
  // where it spins on the spot, at the middle of a tile, to face the ground cone (the lane's x, the row's y)
  const X: Pose = { x: D.at.x, y: C.at.y, h: D.at.h };
  const westOfX: Pose = { ...X, h: C.at.h };

  const loop: Phase[] = [];
  // the stack: grab, and straight away back down the lane to the medium junction
  loop.push(grab(A, 0));
  loop.push(...toPole(A, D, midD, overD, 0, 1, false));
  // retract as it backs off to the middle of the tile on the row, spin to face west, and drive to the ground cone, the slides rising on the way
  const afterD: Arm = open(D.arm);
  loop.push({
    ...leg([D.at, X], D.at.h, D.at.h, 1.1, 0, 0),
    arm: [afterD, stowed(A.arm)],
    keys: retractKeys(afterD),
    carry: never,
  });
  loop.push({ dur: 0.5, at: X, turn: C.at.h, arm: [stowed(A.arm), stowed(A.arm)], carry: never });
  const westRun = leg([westOfX, C.at], C.at.h, C.at.h, 1.1, 0, 0);
  loop.push({
    ...westRun,
    arm: [stowed(A.arm), C.arm],
    keys: approachKeys(C.arm),
    carry: never,
    mark: { what: "clear", index: 1, offset: farOffset(westRun, D.at, GONE) }, // the cone it placed stays until it has driven well away
  });
  // the ground cone: grab, and straight away back east along the row to the medium junction (the pole on its right), then forward (west)
  // along the row to the ground cone again, retracting on the way
  loop.push(grab(C, 1));
  loop.push(...toPole(C, M, midM, overM, 1, 1, true));
  const afterM: Arm = open(M.arm);
  const backWest = leg([M.at, C.at], C.at.h, C.at.h, 1.6, 0, 0);
  loop.push({
    ...backWest,
    arm: [afterM, C.arm],
    keys: {
      tilt: key([0, 0], [0.3, PP.tilt], [0.62, PP.tilt], [0.92, 0]),
      yaw: key([0.25, afterM.yaw], [0.6, 0]),
      twist: key([0.25, afterM.twist], [0.6, 0]),
      lift: key([0.3, afterM.lift], [0.9, C.arm.lift]),
    },
    carry: never,
    mark: { what: "clear", index: 1, offset: farOffset(backWest, M.at, GONE) },
  });
  // and the ground cone again: grab, and straight away back east along the row to the high junction
  loop.push(grab(C, 1));
  loop.push(...toPole(C, B, midB, overB, 1, 0, true));
  // retract as it turns off the row to the north, then up the lane to the stack, the slides rising on the way
  const afterB: Arm = open(B.arm);
  const turnOut = { x: A.at.x, y: B.at.y - 6 }; // in the stack's lane (world px, like everything else here)
  loop.push({
    ...leg([B.at, { x: B.at.x - 5, y: B.at.y - 0.4 }, turnOut], B.at.h, A.at.h, 1.2, 0, 18),
    arm: [afterB, stowed(A.arm)],
    keys: retractKeys(afterB),
    carry: never,
  });
  const northRun = leg([turnOut, A.at], A.at.h, A.at.h, 1.5, 18, 0);
  loop.push({
    ...northRun,
    arm: [stowed(A.arm), A.arm],
    keys: approachKeys(A.arm),
    carry: never,
    mark: { what: "clear", index: 0, offset: farOffset(northRun, B.at, GONE) },
  });
  const loopTotal = loop.reduce((s, p) => s + p.dur, 0);

  // it starts where the loop does: standing at the stack with the jaws open, the wrist level and the slides at the stack's height; reduced
  // motion, which never animates it, leaves it there
  model.position.set(A.at.x, model.position.y, A.at.y);
  model.rotation.y = -A.at.h;
  (model.userData.pose as ((p: PPPose) => void) | undefined)?.({ ...A.arm, carrying: false });

  // when, in the loop, each thing happens to the field
  const events: { what: Mark["what"]; index: number; at: number; lean?: [number, number, number] }[] = [];
  let clock = 0;
  for (const p of loop) {
    if (p.mark) events.push({ what: p.mark.what, index: p.mark.index, at: clock + p.mark.offset, lean: p.mark.lean });
    clock += p.dur;
  }

  // a pole is dropped on and cleared in turn (more than once a lap for the medium one): each drop is paired with the next clear
  const pairs = [0, 1].map((i) => {
    const drops = events.filter((e) => e.what === "drop" && e.index === i).sort((a, b) => a.at - b.at);
    const clears = events.filter((e) => e.what === "clear" && e.index === i).sort((a, b) => a.at - b.at);
    return drops.map((d) => ({ at: d.at, lean: d.lean!, clear: clears.find((c) => c.at > d.at)?.at }));
  });

  /** The field at `tl` seconds into the loop: a cone taken is gone until its replacement grows in; a placed one falls, stays, and shrinks away. */
  const field = (tl: number) => {
    const cone = [1, 1];
    for (const ev of events) {
      if (ev.what === "pick") cone[ev.index] -= ramp(tl, ev.at, FADE.pick);
      else if (ev.what === "spawn") cone[ev.index] += ramp(tl, ev.at, FADE.spawn);
    }
    for (let i = 0; i < 2; i++) {
      ftcField.cone[i] = Math.min(1, Math.max(0, cone[i]));
      // the placed cone shown is the one of the latest drop so far
      let placed = 0;
      for (const d of pairs[i]) {
        if (tl < d.at) break;
        placed = ramp(tl, d.at, FADE.drop) + (d.clear === undefined ? 0 : ramp(tl, d.clear, FADE.clear));
        ftcField.lean[i] = d.lean;
      }
      ftcField.placed[i] = Math.min(2, Math.max(0, placed));
    }
  };

  const channels: Channel[] = ["lift", "yaw", "tilt", "twist", "claw"];

  /** A joint's value at `u` along its own track. */
  const track = (keys: Keys, u: number) => {
    if (u <= keys[0][0]) return keys[0][1];
    for (let n = 1; n < keys.length; n++) {
      if (u <= keys[n][0]) return lerp(keys[n - 1][1], keys[n][1], smooth((u - keys[n - 1][0]) / (keys[n][0] - keys[n - 1][0])));
    }
    return keys[keys.length - 1][1];
  };

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: standing at the stack, every cone where it was

    // which phase, and how far through it
    const list = loop;
    let e = t % loopTotal;
    field(e);
    let i = 0;
    while (i < list.length - 1 && e >= list[i].dur) e -= list[i++].dur;
    const ph = list[i];
    const u = e / ph.dur;
    const k = smooth(u);

    let at: Pose;
    if (ph.route) {
      const s = Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : k));
      const p = ph.route.curve.getPointAt(s);
      at = { x: p.x, y: p.z, h: ph.route.h0 + wrap(ph.route.h1 - ph.route.h0) * s };
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
      const keys = ph.keys?.[c];
      if (keys) arm[c] = track(keys, u);
      else {
        const w = ph.when?.[c];
        arm[c] = lerp(ph.arm[0][c], ph.arm[1][c], w ? smooth((u - w[0]) / (w[1] - w[0])) : k);
      }
    }
    const pose = model.userData.pose as ((p: PPPose) => void) | undefined;
    pose?.({ ...arm, carrying: ph.carry(u) });
  };
}
