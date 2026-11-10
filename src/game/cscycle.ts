// The Center Stage robot's loop, forever, starting at the east wall: one job, the two pixels there to the backdrop.
//
// It is one smooth run each way. Away from the backdrop it drives straight south under the Stage Door (the arm folds and the slides go down as
// it goes), then turns in one long curve to the east and drives up to the pixels, the intake coming down and the roller starting as it
// approaches: the yellow pixel is pulled in (up the ramp into the bucket's upper place) and the white one behind it, as it comes to rest. Then it
// reverses along the same path, the intake lifting, turning as it goes and running north under the door; once its front is clear it slows, and
// as it slows the slides rise and the arm swings back (parallel to the backdrop). It then stands in one place, and only the turret and the slides
// move: the turret turns, the lock lets go and the white pixel drops in the second row, just left of the green one; the yellow slides down to the
// lower place and is held; the slides rise, the turret turns the other way and the yellow one drops on the purple and the green, a mosaic.
//
// The game pieces are persistent. The two pixels at the wall shrink away as the roller takes them and fresh ones grow back once the robot
// has driven off; the two it places show on the backdrop until it has driven away, and then shrink, so the next lap can do it again. That is
// `ftcField` (ftcfield.ts), worked out every frame from where the robot is in its loop.
//
// Like the other cycles it only sets the prop's x, z and heading (the hover lift owns its height), and poses the model through
// `userData.pose` (see ftccsrobot.ts). Everything is worked out in the world px the scene gives; nothing here knows where the field is.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { BACKDROP_PLACE, CS, CS_WAIT, backdropCell, csDeposit, ftcField } from "./ftcfield";
import type { CSPose } from "./ftccsrobot";
import type { AnimCtx } from "./models";
import type { CenterStageCycle } from "./scenes";

const GONE = 14; // how far (px) the robot has driven from a stop before the pixel it leaves there changes (a placed one shrinks, a taken one is replaced)
const FEED = 1.0; // how long a pixel takes to ride in from the floor to its place in the bucket (s)
const SPIN = 10; // the roller's speed (rad/s)
const SLIDE_V = 24; // how fast the slides move, up or down alike (px/s on average over a move; they ease in and out)
const slideTime = (dist: number) => Math.abs(dist) / SLIDE_V; // how long a slide move of `dist` px takes (s)
const JOINT_W = 4.2; // how fast the arm swings and the turret turns, either way (rad/s on average over a move, about 240 degrees a second; they ease in and out)
const jointTime = (rad: number) => Math.abs(rad) / JOINT_W; // how long a swing or turn of `rad` takes (s)
const DOOR_CLEAR = CS.reachUp + 0.8; // the robot's centre has to be this far past the Stage Door for the raised intake to be clear of it
const FOLD_AT = 4; // how far (px) it has driven back off the backdrop before the arm folds,
const DOWN_AT = 8; // and before the slides go down

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

type Arm = Omit<CSPose, "spin" | "yellow" | "white">;
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
  index: number; // for a pick or spawn, the wall pixel (`ftcField.wall`: 0 yellow, 1 white); for a drop or clear, the backdrop's (`ftcField.px`: 0 white, 1 yellow)
  offset: number;
  /** For a drop: how far the pixel was turned about the board's normal as it was let go (radians). */
  turn?: number;
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop), turning to `turn` by the end of the phase if it is given. */
  at?: Pose;
  turn?: number;
  /** Or the route it drives, with the heading it sets off with and the one it stops with (or, `follow`, its heading following the path, nose first or tail first), and its speed profile (the default eases in and out). */
  route?: { curve: CatmullRomCurve3; h0: number; h1: number; follow?: 1 | -1; ease?: (u: number) => number };
  arm: [Arm, Arm];
  /** When, as a fraction of the phase, each joint moves (the rest move throughout), so that one joint can follow another. */
  when?: Partial<Record<Channel, [number, number]>>;
  marks?: Mark[];
}

/** How long each thing that happens to the field takes. */
const FADE = { pick: 0.06, spawn: 0.4, drop: 0.5, clear: 0.4 };

export function attachCenterStage(model: Group, cfg: CenterStageCycle) {
  const A0 = CS.half + CS.ahead; // how far ahead of the robot's centre a pixel lies when the roller has it

  // ---- where it stands, and the one smooth path between the backdrop and the wall
  const yStand: Pose = { x: cfg.yellow.x - A0, y: cfg.yellow.y, h: 0 }; // the yellow pixel straight ahead
  const wStand: Pose = { x: cfg.white.x - A0, y: cfg.white.y, h: 0 };
  const SOUTH = Math.PI / 2;

  // the two deposits, from one stand between them: the turret's angle and the slide's extension for each pixel's place on the backdrop
  const cell = (n: number) => backdropCell(BACKDROP_PLACE[n].row, BACKDROP_PLACE[n].col);
  const OFF = (cell(0).u + cell(1).u) / 2; // across the board, halfway between the two places, so the turret reaches both from where it stands
  const dW = csDeposit(cell(0).u - OFF, cell(0).v);
  const dY = csDeposit(cell(1).u - OFF, cell(1).v);
  const stand: Pose = { x: cfg.backdrop.x + OFF, y: cfg.backdrop.y + dW.z, h: SOUTH }; // facing south, rear to the backdrop
  const phiW = dW.phi; // + = to the robot's right (west when it faces south)
  const phiY = dY.phi;

  // the path out from the backdrop: straight south under the door, then one long turn to the east and in a straight line to the pixels (the way
  // back is the same path travelled in reverse)
  const ROW = cfg.yellow.y;
  const yClear = cfg.door.y - DOOR_CLEAR; // how far north its front is clear of the door
  const ySplit = stand.y + 9; // and where it begins to slow for the stand
  const TURN = 16; // how long the turn is (px of path): its heading eases from south to east, so it begins and ends without a jolt of the steering
  const bend: { x: number; y: number }[] = [];
  {
    let x = 0;
    let y = 0;
    let prev = Math.PI / 2;
    bend.push({ x, y });
    for (let i = 1; i <= 20; i++) {
      const th = (Math.PI / 2) * (1 - smooth(i / 20)); // the heading, from south (pi/2) to east (0)
      x += Math.cos((th + prev) / 2) * (TURN / 20);
      y += Math.sin((th + prev) / 2) * (TURN / 20);
      prev = th;
      bend.push({ x, y });
    }
  }
  const bendEnd = bend[bend.length - 1];
  const arc = bend.map((q) => ({ x: stand.x + q.x, y: ROW - bendEnd.y + q.y }));
  const outward = [{ x: stand.x, y: cfg.door.y + 2 }, ...arc, yStand, wStand]; // from the door to the pixels
  const pathA = [stand, ...outward];
  const pathB1 = [...outward].reverse().concat({ x: stand.x, y: ySplit }); // reversing, to where it begins to slow
  const pathB2 = [{ x: stand.x, y: ySplit }, stand];

  /** `pts` with more points between any two that are far apart, so the spline through them has no sudden change of pace. */
  const fill = (pts: { x: number; y: number }[], step = 2.5) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
      for (let k = 1; k <= n; k++) out.push({ x: lerp(a.x, b.x, k / n), y: lerp(a.y, b.y, k / n) });
    }
    return out;
  };
  const curve = (pts: { x: number; y: number }[]) => {
    const c = new CatmullRomCurve3(
      fill(pts).map((p) => new Vector3(p.x, 0, p.y)),
      false,
      "centripetal"
    );
    c.arcLengthDivisions = 1600;
    return c;
  };
  /** A run along `pts` taking `dur`, leaving at `v0` px/s and arriving at `v1`, its heading following the path (`dir` 1: forwards; -1: reversing). */
  const run = (pts: { x: number; y: number }[], dur: number, v0: number, v1: number, dir: 1 | -1) => {
    const c = curve(pts);
    const d = c.getLength();
    return { dur, route: { curve: c, h0: 0, h1: 0, follow: dir, ease: hermite((v0 * dur) / d, (v1 * dur) / d) } };
  };
  type Drive = { dur: number; route: { curve: CatmullRomCurve3; ease?: (u: number) => number } };
  const pointAt = (ph: Drive, u: number) => ph.route.curve.getPointAt(Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : smooth(u))));
  /** How far into a driving phase (0..1) the robot first satisfies `test` (the end if it never does). */
  const firstU = (ph: Drive, test: (p: { x: number; y: number }) => boolean) => {
    for (let n = 0; n <= 800; n++) {
      const u = n / 800;
      const q = pointAt(ph, u);
      if (test({ x: q.x, y: q.z })) return u;
    }
    return 1;
  };
  /** How many seconds into a driving phase the robot is first `dist` px from `from`. */
  const farOffset = (ph: Drive, from: { x: number; y: number }, dist: number) => firstU(ph, (p) => Math.hypot(p.x - from.x, p.y - from.y) >= dist) * ph.dur;

  // ---- the arm poses along the way
  const S: Arm = { ...CS_WAIT, intake: 1 }; // intake down, everything else stowed: the arm folded, the bucket flat inside the robot
  const driving: Arm = { ...S, intake: 0 };
  const lifted: Arm = { ...driving, slide: dW.e }; // the slides up for the white pixel
  const armBack: Arm = { ...lifted, arm: 0 }; // the arm and bucket swing back through 60 degrees, out of the robot's back, to hang parallel to the backdrop
  const lined: Arm = { ...armBack, turret: phiW };
  const open: Arm = { ...lined, gate: 1 };
  const lowered: Arm = { ...open, yellowLow: 1, gate: 0 }; // the yellow slid down to the lower place and held there
  const raised: Arm = { ...lowered, slide: dY.e, turret: phiY };
  const openY: Arm = { ...raised, gate: 1 };
  const clear1: Arm = { ...openY, turret: 0, gate: 0 }; // the turret centred and the lock shut

  const loop: Phase[] = [];
  // at the backdrop, the last pixel let go: the lock closes and the turret centres
  loop.push({ dur: 0.5, at: stand, arm: [openY, clear1], when: { turret: [0, jointTime(phiY) / 0.5], gate: [0.5, 1] } });
  // away from the backdrop in one run: the arm folds once it has backed off the board and the slides go down before the rear reaches the door,
  // then one long turn, the intake coming down as it drives up to the pixels, the yellow taken first and the white as it comes to rest
  const A = run(pathA, 5.0, 0, 0, 1);
  const uFold = firstU(A, (p) => p.y > stand.y + FOLD_AT);
  const uIn = uFold + jointTime(CS.arm.fold) / A.dur; // the arm is in
  const uDown = Math.max(firstU(A, (p) => p.y > stand.y + DOWN_AT), uIn + 0.01); // the slides go down once it is
  const toPixels = (p: { x: number; y: number }) => Math.hypot(p.x - yStand.x, p.y - yStand.y);
  const uI0 = firstU(A, (p) => toPixels(p) < 24);
  const uI1 = firstU(A, (p) => toPixels(p) < 12);
  loop.push({
    ...A,
    arm: [clear1, S],
    when: { arm: [uFold, uIn], slide: [uDown, Math.min(1, uDown + slideTime(clear1.slide) / A.dur)], intake: [uI0, uI1] },
    marks: [
      { what: "clear", index: 0, offset: farOffset(A, stand, GONE) },
      { what: "clear", index: 1, offset: farOffset(A, stand, GONE) + 0.2 },
      { what: "pick", index: 0, offset: firstU(A, (p) => p.x >= yStand.x - 0.01) * A.dur },
      { what: "pick", index: 1, offset: A.dur },
    ],
  });
  loop.push({ dur: 0.45, at: wStand, arm: [S, S] }); // the roller finishes taking the white one in
  // back to the backdrop in one run, reversing: the intake lifts, the new pixels appear at the wall once it is away, it turns as it goes and runs
  // north under the door; once its front is clear the slides rise, and as it slows to a stop the arm swings back
  const B1 = run(pathB1, 4.3, 0, 8, -1);
  const uClear = firstU(B1, (p) => p.y < yClear);
  loop.push({
    ...B1,
    arm: [S, lifted],
    when: { intake: [0.14, 0.34], slide: [uClear, Math.min(1, uClear + slideTime(dW.e) / B1.dur)] },
    marks: [
      { what: "spawn", index: 0, offset: farOffset(B1, wStand, GONE) },
      { what: "spawn", index: 1, offset: farOffset(B1, wStand, GONE) + 0.25 },
    ],
  });
  loop.push({ ...run(pathB2, 2.2, 8, 0, -1), arm: [lifted, armBack], when: { arm: [0.4, 0.4 + jointTime(CS.arm.fold) / 2.2] } });
  // then it stands there, and only the turret and the slides move: the white pixel, the yellow one down to the lower place, then the yellow
  loop.push({ dur: jointTime(phiW) + 0.03, at: stand, arm: [armBack, lined] });
  loop.push({ dur: 0.5, at: stand, arm: [lined, open], when: { gate: [0, 0.5] }, marks: [{ what: "drop", index: 0, offset: 0.25, turn: -phiW }] });
  loop.push({ dur: 0.7, at: stand, arm: [open, lowered], when: { yellowLow: [0, 0.6], gate: [0.6, 1] } });
  const upT = slideTime(dY.e - dW.e); // the slides go up first, then the turret turns
  const turnT = jointTime(phiY - phiW);
  const upDur = upT + 0.03 + turnT + 0.03;
  loop.push({ dur: upDur, at: stand, arm: [lowered, raised], when: { slide: [0, upT / upDur], turret: [(upT + 0.03) / upDur, (upT + 0.03 + turnT) / upDur] } });
  loop.push({ dur: 0.5, at: stand, arm: [raised, openY], when: { gate: [0, 0.5] }, marks: [{ what: "drop", index: 1, offset: 0.25, turn: -phiY }] });
  const loopTotal = loop.reduce((s, p) => s + p.dur, 0);

  // it starts where the loop does: standing at the wall with the intake down; reduced motion, which never animates it, leaves it there
  model.position.set(yStand.x, model.position.y, yStand.y);
  model.rotation.y = -yStand.h;
  (model.userData.pose as ((p: CSPose) => void) | undefined)?.({ ...S, spin: 0, yellow: -1, white: -1 });

  // when, in the loop, each thing happens to the field
  const events: (Mark & { at: number })[] = [];
  let clock = 0;
  for (const p of loop) {
    for (const m of p.marks ?? []) events.push({ ...m, at: clock + m.offset });
    clock += p.dur;
  }
  const find = (what: Mark["what"], index: number) => events.find((e) => e.what === what && e.index === index)!;
  const pickAt = [find("pick", 0).at, find("pick", 1).at]; // yellow, white
  const dropAt = [find("drop", 0).at, find("drop", 1).at]; // white, yellow
  const clearAt = [find("clear", 0).at, find("clear", 1).at];
  const start = pickAt[0] - 0.2; // it begins where it is just about to take the yellow pixel in, at the wall (no intro)
  const turnAt = [find("drop", 0).turn!, find("drop", 1).turn!];

  /** The field at `tl` seconds into the loop: a pixel taken is gone until its replacement grows in; a placed one falls, stays, and shrinks away. */
  const field = (tl: number) => {
    const wall = [1, 1];
    for (const ev of events) {
      if (ev.what === "pick") wall[ev.index] -= ramp(tl, ev.at, FADE.pick);
      else if (ev.what === "spawn") wall[ev.index] += ramp(tl, ev.at, FADE.spawn);
    }
    for (let i = 0; i < 2; i++) {
      ftcField.wall[i] = Math.min(1, Math.max(0, wall[i]));
      // a placed pixel falls at its drop, stays on the board through the rest of the lap and, in the next, shrinks away once the robot has driven off
      // (the loop begins at the wall, with the board bare, so by then the last lap's pixels have already gone)
      ftcField.px[i] = tl < dropAt[i] ? Math.min(2, 1 + ramp(tl, clearAt[i], FADE.clear)) : ramp(tl, dropAt[i], FADE.drop);
      ftcField.pxTurn[i] = turnAt[i];
    }
  };

  /** Where a pixel taken in at `pick` and let go at `drop` is on the robot at `tl`: not on it (-1), on its way in (0..1), or in the bucket (1). */
  const aboard = (tl: number, pick: number, drop: number) => (tl < pick || tl >= drop ? -1 : Math.min(1, (tl - pick) / FEED));

  const channels: Channel[] = ["intake", "slide", "arm", "turret", "gate", "yellowLow"];

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: standing at the wall, every pixel where it was

    // which phase, and how far through it
    const list = loop;
    const tl = (t + start) % loopTotal;
    field(tl);
    let e = tl;
    let i = 0;
    while (i < list.length - 1 && e >= list[i].dur) e -= list[i++].dur;
    const ph = list[i];
    const u = e / ph.dur;
    const k = smooth(u);

    let at: Pose;
    if (ph.route) {
      const s = Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : k));
      const p = ph.route.curve.getPointAt(s);
      let h = ph.route.h0 + wrap(ph.route.h1 - ph.route.h0) * s;
      if (ph.route.follow) {
        const g = ph.route.curve.getTangentAt(s);
        h = Math.atan2(g.z, g.x) + (ph.route.follow < 0 ? Math.PI : 0);
      }
      at = { x: p.x, y: p.z, h };
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
    const pose = model.userData.pose as ((p: CSPose) => void) | undefined;
    pose?.({ ...arm, spin: arm.intake > 0.2 ? tl * SPIN : 0, yellow: aboard(tl, pickAt[0], dropAt[1]), white: aboard(tl, pickAt[1], dropAt[0]) });
  };
}
