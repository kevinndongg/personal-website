// An FTC robot's trip to the name, when the about card opens, and back to exactly where it was in its loop when the card closes.
//
// The three loops (robotcycle.ts, ppcycle.ts, cscycle.ts) work out everything from the time they are given, so a robot is paused by giving
// its cycle one frozen time (it stays posed, and the game pieces stay as they were) and resumed by giving it the time minus all it was
// away. Here the robot drives its own route in the meantime: it joins `visit.path` at the nearest stretch from wherever it is, follows it out of
// the field through its gate (a piece of the wall that lowers: `ftcGates`, drawn by `gateModel` in ftcmodels.ts) and across the map to the stop,
// with its arm put away. Closing the card, it goes back the same way to where it left its loop.
//
// The two ends of the trip meet the loop without a step in anything: the robot leaves with the velocity the loop had at that moment (the way
// out starts along it, at its speed) and comes home arriving along that same velocity, at that speed, on the pose the loop was left in; the
// loop, which was frozen at that moment, picks up from there on the next frame. A robot that was standing still leaves from rest and comes
// home to rest. Speed changes are jerk-limited, so acceleration is continuous as well.
//
// It is a mecanum robot, so it does not have to point where it is going: the route is a path in position alone, and the heading eases from
// the loop's to the stop's over the whole of the way out (and back again on the way home), however the route turns.
//
// Interruption: closing the card while it is on the way out brakes it to a stop where it is, and it goes home from there; opening it again
// while it is coming home finishes the trip home first (it never turns round at speed) and then sets off again.
import type { Group } from "three";
import type { AnimCtx } from "./models";
import type { RobotVisit } from "./scenes";
import { curvePoses, makeLeg, poseAt, spacing, type Leg, type Pose, type Pt } from "./visit";

/** px/s: slower than the formula car (a robot is a much smaller thing). */
export const ROBOT_SPEED = 100;
const ACCEL = 320; // px/s^2 pulling away, at most
const BRAKE = 200; // px/s^2 slowing, at most
const PLAN = 0.35; // it plans its slowing with this share of that, so that it can always follow the plan (the acceleration takes a moment to build)
const JERK = 1600; // px/s^3: how fast the acceleration itself changes
const STOW_TIME = 0.4; // s to put the arm away as it sets off
const STOW_BACK = 40; // px before home over which the arm comes back out
const GATE_NEAR = 46; // px: a gate is down while a robot is this close to it
const RAMP = 0.3; // s: how long the loop's clock takes to slow to a stop, or to speed up again from one
const W_EASE = 0.6; // s: over how long the heading's turning rate is taken from the loop's at one end of the trip and given back at the other
const LOOK = 0.2; // s: how far ahead it looks along its path to set its speed
const A_LAT = 450; // px/s^2: the most a robot is thrown sideways going round a bend, which limits its speed on one
const LEAD = [8, 30]; // px: how far along its velocity the path runs at a join (a fifth to a third of the way to the next point)

/** The gates in the field's wall: one per robot, down (open) while a robot is passing. `open` is 0..1, eased by the gate's own model. */
export const ftcGates = [0, 1, 2].map(() => ({ open: 0, want: new Set<object>() }));

interface V {
  x: number;
  z: number;
}
/** A leg of the trip, with the speed it starts and ends at (px/s) and the fastest it can be going at each of its poses (see `robotLeg`). */
interface RobotLeg extends Leg {
  v0: number;
  vEnd: number;
  vMax: number[];
}

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, k: number) => a + wrap(b - a) * k;
const speedOf = (v: V) => Math.hypot(v.x, v.z);
const apartBy = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The points a route is drawn through: `pts` (the first is where the robot is, the last where it is going), with a point set along the
 * velocity it leaves with, so that the path leaves along it, and one set back along the velocity it arrives with, so that the path arrives along
 * it. Points of `pts` close to those are left out: next to them they would make the path wiggle.
 */
function route(pts: Pt[], vIn: V | null, vOut: V | null): Pt[] {
  const first = pts[0];
  const last = pts[pts.length - 1];
  let mid = pts.slice(1, -1);
  const out: Pt[] = [first];
  const lead = (a: Pt, b: Pt) => clamp(0.3 * apartBy(a, b), LEAD[0], LEAD[1]);
  if (vIn && speedOf(vIn) > 3) {
    const l = lead(first, pts[1]);
    const k = l / speedOf(vIn);
    out.push({ x: first.x + vIn.x * k, y: first.y + vIn.z * k });
    mid = mid.filter((p) => apartBy(p, first) >= l + 6);
  }
  if (vOut && speedOf(vOut) > 3) {
    const l = lead(pts[pts.length - 2] ?? first, last);
    const k = l / speedOf(vOut);
    mid = mid.filter((p) => apartBy(p, last) >= l + 6);
    out.push(...mid, { x: last.x - vOut.x * k, y: last.y - vOut.z * k });
  } else out.push(...mid);
  out.push(last);
  return out;
}

/** A leg along the route through `pts`; its heading eases (the short way round) from `startH` to `endH` over its whole length, whatever the path does. */
function robotLeg(pts: Pt[], vIn: V | null, vOut: V | null, startH: number, endH: number, v0: number, vEnd: number): RobotLeg {
  const poses = curvePoses(route(pts, vIn, vOut));
  const n = Math.max(1, poses.length - 1);
  poses.forEach((p, i) => (p.h = lerpAngle(startH, endH, smooth(i / n))));
  return finishLeg(poses, v0, vEnd);
}

/** `poses` as a leg that starts at speed `v0` and ends at `vEnd`, with the fastest it can be going at each pose worked out. */
function finishLeg(poses: Pose[], v0: number, vEnd: number): RobotLeg {
  if (poses.length < 2) poses = [poses[0], { ...poses[0] }]; // (a leg from where it is to where it is: already there)
  const n = Math.max(1, poses.length - 1);
  const leg = makeLeg(poses, { speed: ROBOT_SPEED, brake: true });
  leg.len = Math.max(leg.len, 0.01);
  // The fastest it can be going at each pose: slow enough for the bends (how sharply the path turns there), and slow enough to be going no faster
  // than `vEnd` at the end, braking at a gentle rate (worked out from the end backwards).
  const ds = leg.len / n;
  const dir = (i: number) => {
    const a = poses[Math.max(0, i - 1)];
    const b = poses[Math.min(n, i + 1)];
    return Math.atan2(b.z - a.z, b.x - a.x);
  };
  const vMax: number[] = new Array(n + 1);
  vMax[n] = vEnd;
  for (let i = n - 1; i >= 0; i--) {
    // the bend's sharpness (rad/px): over a short stretch and a longer one, whichever is sharper (a corner can hide in the longer one)
    const turn = Math.max(
      Math.abs(wrap(dir(Math.min(n, i + 1)) - dir(Math.max(0, i - 1)))) / (2 * ds),
      Math.abs(wrap(dir(Math.min(n, i + 2)) - dir(Math.max(0, i - 2)))) / (4 * ds),
      Math.abs(wrap(dir(Math.min(n, i + 5)) - dir(Math.max(0, i - 5)))) / (10 * ds)
    );
    const bend = turn > 1e-4 ? Math.sqrt(A_LAT / turn) : Infinity;
    vMax[i] = Math.min(bend, Math.sqrt(vMax[i + 1] * vMax[i + 1] + 2 * BRAKE * PLAN * ds));
  }
  return { ...leg, v0, vEnd, vMax };
}

/** Where along `pts` a robot at `from` joins them: the end of the stretch it is nearest to (so it goes on toward the stop, never back). */
function joinIndex(from: Pt, pts: Pt[]): number {
  let best = 1;
  let bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const k = clamp(((from.x - a.x) * dx + (from.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const d = Math.hypot(from.x - (a.x + dx * k), from.y - (a.y + dy * k));
    if (d < bestD) (bestD = d), (best = i + 1);
  }
  return best;
}

/**
 * Gives a robot (one whose cycle is attached already) the trip: `model.userData.sendOut()` sends it, `model.userData.recall()` brings it home.
 * The cycle's own `userData.stowed` (a pose to travel in) is what its arm is brought to while it is away.
 */
export function attachRobotVisit(model: Group, visit: RobotVisit) {
  const cycle = model.userData.animate as (c: AnimCtx) => void;
  const basePose = model.userData.pose as ((p: Record<string, unknown>) => void) | undefined;
  const stowed = (model.userData.stowed ?? {}) as Record<string, number>;
  const me = {}; // (what a gate knows this robot by)
  let stow = 0; // 0..1: how far the arm is put away (eased when it is used)

  // the arm: while it is away every joint the cycle names is blended toward the travelling pose (the carried piece and the wheels are left as they are)
  model.userData.pose = (p: Record<string, unknown>) => {
    const k = smooth(stow);
    if (k <= 0.001) return basePose?.(p);
    const q = { ...p };
    for (const key of Object.keys(stowed)) if (typeof p[key] === "number") q[key] = (p[key] as number) + (stowed[key] - (p[key] as number)) * k;
    basePose?.(q);
  };

  type Phase = "cycle" | "slow" | "out" | "away" | "back";
  let phase: Phase = "cycle";
  let wanted = false;
  let wantedSince = -1;
  let cycleT = -1; // the loop's own time (it is given this; frozen while the robot is away)
  let rate = 1; // how fast the loop's clock runs (0..1): eased down to rest, and back up, where the way goes against the loop's motion
  let rampFrom = 1;
  let rampT = RAMP; // how long the clock has been easing back up to full speed
  let slowT = 0;
  let lastT = -1;
  let home: Pose = { x: 0, z: 0, h: 0 };
  let loopV: V = { x: 0, z: 0 }; // the loop's velocity as it was left (px/s), and so as it is rejoined: the cycle is frozen at that moment
  let lastPos: V | null = null;
  let loopW = 0; // and how fast the loop was turning then (rad/s)
  let lastH = 0;
  let legTime = 0; // how long the leg in hand has been going (s)
  let fullWay: Pt[] = []; // the part of visit.path it follows, after where it joined it
  let wayOffset = 0; // how many of those it has come back past (it turned round on its way home): the way it is on is `fullWay` from there
  let way: Pt[] = [];
  let leg: RobotLeg | null = null;
  let wpS: number[] = []; // how far along the way out each of `way`'s points is
  let backWay: Pt[] = []; // the points the way home goes through, in the order it does, and how far along it each is
  let backTop = 0; // and which of `fullWay`'s points the first of them is
  let legKind: "out" | "back" = "out"; // which way the leg in hand goes
  let backS: number[] = [];
  let s = 0;
  let v = 0;
  let a = 0; // acceleration along the path (px/s^2)
  let stopAt = Infinity; // brake to a stop here (the card was closed on the way out, or opened again on the way home)
  let turnBack = false; // opened again on the way home: it is braking to a stop, to go back out from there

  model.userData.sendOut = () => {
    wanted = true;
  };
  model.userData.recall = () => {
    wanted = false;
  };
  model.userData.visitPhase = () => phase;
  /** Parked at its spot (the trip's end): what the tag under it waits for. */
  model.userData.visitParked = () => phase === "away" && !!leg && s >= leg.len - 1;

  const poseNow = (): Pose => ({ x: model.position.x, z: model.position.z, h: -model.rotation.y });
  const place = (p: Pose) => {
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -p.h;
  };
  /** The pose `s` px along the leg in hand, its heading carrying the loop's turning rate over from the start (and into the end of the way home). */
  const placeLeg = (rest: number) => {
    const p = poseAt(leg!, s);
    if (phase === "out") {
      const u = legTime / W_EASE;
      if (u < 1) p.h += loopW * legTime * (1 - u) * (1 - u);
    } else if (phase === "back" && leg!.vEnd > 3) {
      const toGo = rest / Math.max(v, 15);
      const u = toGo / W_EASE;
      if (u < 1) p.h -= loopW * toGo * (1 - u) * (1 - u);
    }
    place(p);
  };

  /** Sets off from `here` along the way to the stop; `matched`: with the loop's velocity (the way goes on the way the loop was going), else from rest. */
  const startOut = (here: Pose, matched: boolean, resetHome = true, from?: number) => {
    if (resetHome) home = here; // (not when it turns round on its way home: it still goes home to where it left its loop)
    // (turning round on its way home it goes back the way it has come: on from the point of the way that it has come back to, which is not always the
    // nearest stretch of the lane: a robot outside the wall is nearest to a stretch inside it)
    if (from !== undefined && (from < 0 || from > fullWay.length - 1)) from = undefined;
    if (from === undefined) {
      fullWay = visit.path.slice(joinIndex({ x: here.x, y: here.z }, visit.path));
      wayOffset = 0;
    } else wayOffset = from;
    way = fullWay.slice(wayOffset);
    const pts = [{ x: here.x, y: here.z }, ...way];
    const speed = speedOf(loopV);
    leg = robotLeg(pts, matched ? loopV : null, null, here.h, visit.heading, matched ? speed : 0, 0);
    // how far along the leg each point of the way is (for going home from the middle of it)
    wpS = way.map((w) => {
      let best = 0;
      let bestD = Infinity;
      leg!.poses.forEach((p, i) => {
        const d = Math.hypot(p.x - w.x, p.z - w.y);
        if (d < bestD) (bestD = d), (best = i);
      });
      return (best / Math.max(1, leg!.poses.length - 1)) * leg!.len;
    });
    s = 0;
    v = leg.v0;
    a = 0;
    legTime = 0;
    stopAt = Infinity;
    legKind = "out";
    phase = "out";
  };

  const beginOut = () => {
    const here = poseNow();
    // It leaves with the loop's velocity if the route goes on the way the loop was going (more or less). If it goes another way, or back, the loop
    // is first eased to a stop along its own path (its clock slowing to nothing, so everything on the robot slows with it) and the robot sets off from rest.
    const speed = speedOf(loopV);
    const from = { x: here.x, y: here.z };
    const j = joinIndex(from, visit.path);
    const goes = visit.path.slice(j).find((w) => apartBy(w, from) >= 14) ?? visit.path[j];
    const along = speed > 3 && goes ? (loopV.x * (goes.x - here.x) + loopV.z * (goes.y - here.z)) / (speed * apartBy(goes, from)) : 1;
    if (speed <= 3 || along >= 0.75) return startOut(here, speed > 3);
    slowT = 0;
    phase = "slow";
  };

  const beginBack = () => {
    const here = poseNow();
    // the points of the way it has passed, back to front, and then home. It comes home to the loop's velocity if it can arrive along it (more or
    // less); if the way in goes against it (the way back along the lane usually does) it comes to rest and the loop's clock eases up from nothing.
    // (and, if it has turned round on the way home before, on past the points before the ones it is on, to where it left its loop)
    let behind: Pt[];
    if (legKind === "back") {
      // stopped part of the way home (it was turning round to go out again) and sent home again: on by the points of the way home it has not passed
      behind = backWay.filter((_, i) => backS[i] > s + 4);
      backTop -= backWay.length - behind.length;
    } else {
      const passedOut = way.filter((_, i) => wpS[i] < s - 6);
      behind = [...passedOut.reverse(), ...fullWay.slice(0, wayOffset).reverse()];
      backTop = wayOffset + passedOut.length - 1;
    }
    legKind = "back";
    stopAt = Infinity; // (what the way out was told to stop at is not for the way home)
    turnBack = false;
    const prev = behind.length ? behind[behind.length - 1] : { x: here.x, y: here.z };
    const speed = speedOf(loopV);
    const comes = apartBy(prev, { x: home.x, y: home.z });
    const along = speed > 3 && comes > 1 ? (loopV.x * (home.x - prev.x) + loopV.z * (home.z - prev.y)) / (speed * comes) : 0;
    const arrives = along >= 0.5 && comes >= 24;
    leg = robotLeg([{ x: here.x, y: here.z }, ...behind, { x: home.x, y: home.z }], null, arrives ? loopV : null, here.h, home.h, 0, arrives ? speed : 0);
    backWay = behind;
    backS = behind.map((w) => {
      let best = 0;
      let bestD = Infinity;
      leg!.poses.forEach((p, i) => {
        const d = Math.hypot(p.x - w.x, p.z - w.y);
        if (d < bestD) (bestD = d), (best = i);
      });
      return (best / Math.max(1, leg!.poses.length - 1)) * leg!.len;
    });
    s = 0;
    v = 0;
    a = 0;
    legTime = 0;
    phase = "back";
  };

  model.userData.animate = (ctx: AnimCtx) => {
    const t = ctx.t;
    if (t <= 0) return cycle(ctx); // reduced motion
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    if (cycleT < 0) cycleT = t;
    if (wanted) {
      if (wantedSince < 0) wantedSince = t;
    } else wantedSince = -1;

    /** Runs the loop a frame on at `r` of its speed, and notes how it is moving (what the way out leaves with and the way home arrives with). */
    const advance = (r: number) => {
      cycleT += dt * r;
      cycle({ ...ctx, t: cycleT });
      const p = poseNow();
      if (lastPos && dt > 0) {
        loopV = { x: (p.x - lastPos.x) / dt, z: (p.z - lastPos.z) / dt };
        loopW = wrap(p.h - lastH) / dt;
      }
      lastPos = { x: p.x, z: p.z };
      lastH = p.h;
    };

    if (phase === "slow") {
      if (!wanted) {
        // the card was closed before it had stopped: the loop speeds up again from where it is
        phase = "cycle";
        rampFrom = rate;
        rampT = 0;
      } else {
        slowT += dt;
        rate = 1 - smooth(slowT / RAMP);
        advance(rate);
        if (slowT >= RAMP) startOut(poseNow(), false);
        return;
      }
    }

    if (phase === "cycle") {
      if (wanted && t - wantedSince >= visit.delay) {
        beginOut();
        if (phase === "slow") {
          advance(rate);
          return;
        }
      } else {
        if (rampT < RAMP) {
          rampT += dt;
          rate = rampFrom + (1 - rampFrom) * smooth(rampT / RAMP);
        } else rate = 1;
        advance(rate);
        return;
      }
    }

    // away from the loop: the cycle is held at the moment it was left (its pose, its game pieces), and this drives the robot
    cycle({ ...ctx, t: cycleT }); // (it puts the robot back at its loop's place: where the robot really is is put again below)
    if (leg) placeLeg(Math.max(0, leg.len - s));

    if (phase === "away") {
      if (wanted) {
        if (turnBack) {
          // stopped on its way home because the card was opened again: it sets off for the stop from here
          turnBack = false;
          const passed = backWay.filter((_, i) => backS[i] <= s + 4).length;
          startOut(poseNow(), false, false, backTop - passed + 1);
        } else if (leg && s < leg.len - 1) phase = "out"; // (braked to a stop part of the way, and wanted again)
      } else beginBack();
    }
    // opened again before it is home: it brakes to a stop where it is (it never turns round at speed) and goes back out; a robot that is nearly
    // home finishes the way home instead. Closed again before it has stopped: it carries on home.
    if (phase === "back" && wanted && !turnBack && leg && leg.len - s > 40) {
      turnBack = true;
      stopAt = Math.min(leg.len, s + (v * v) / (2 * BRAKE * PLAN) + 1);
    } else if (phase === "back" && !wanted && turnBack) {
      turnBack = false;
      stopAt = Infinity;
    }
    if (phase === "out" && !wanted) {
      if (stopAt === Infinity && leg) stopAt = Math.min(leg.len, s + (v * v) / (2 * BRAKE * PLAN) + 1);
    } else if (phase === "out") stopAt = Infinity;

    if (leg && (phase === "out" || phase === "back")) {
      const end = Math.min(leg.len, stopAt);
      const vEnd = end === leg.len ? leg.vEnd : 0;
      // the speed it should have here: up to cruise (or the loop's speed, if it is coming home to a faster one), no faster than the bends allow, and
      // slowed in time for where the leg ends (or where it was told to stop)
      const cruise = Math.max(ROBOT_SPEED, vEnd);
      // (judged a little way ahead of where it is, which is where it will be when the speed it asks for takes effect: judged from here, it is always a
      // little too fast on the way down to a slower speed)
      const sAhead = Math.min(leg.len, s + v * LOOK);
      const last = leg.vMax.length - 1;
      let along = Infinity; // (the lowest ceiling between here and there: a bend in between counts)
      for (let k = Math.round((s / leg.len) * last); k <= Math.min(last, Math.round((sAhead / leg.len) * last)); k++) along = Math.min(along, leg.vMax[k]);
      const floor = vEnd === 0 ? 3 : 0; // (so that it does get there)
      const target = Math.max(floor, Math.min(cruise, along, end < leg.len ? Math.sqrt(2 * BRAKE * PLAN * Math.max(0, end - sAhead)) : Infinity));
      const want = clamp((target - v) * 6, -BRAKE, ACCEL);
      a += clamp(want - a, -JERK * dt, JERK * dt);
      v = Math.max(0, v + a * dt);
      const sNext = s + v * dt;
      s = Math.min(end, sNext);
      legTime += dt;
      placeLeg(Math.max(0, end - s));
      if (s >= end - 0.05) {
        if (phase === "out" || end < leg.len - 0.05) {
          phase = "away";
          v = 0;
          a = 0;
        } else {
          // Home. Arriving along the loop's velocity, the loop goes on from the moment it was left: this frame is already the loop's, carried on by as
          // much as the robot would still have moved this frame had the way been longer, so that no frame is a short step. Arriving at rest, the loop's
          // clock eases up from nothing.
          if (vEnd > 3) {
            cycleT += Math.min(dt, Math.max(0, sNext - end) / vEnd);
            cycle({ ...ctx, t: cycleT });
            rate = 1;
            rampFrom = 1;
            rampT = RAMP;
          } else {
            place(home);
            rate = 0;
            rampFrom = 0;
            rampT = 0;
          }
          stow = 0;
          phase = "cycle";
          const here = poseNow();
          lastPos = { x: here.x, z: here.z };
          lastH = here.h;
          ftcGates[visit.gate.id].want.delete(me);
          return;
        }
      }
    }

    // the arm: put away as it sets off, and brought back out over the last stretch home
    if (phase === "back" && leg) stow = Math.min(stow, (leg.len - s) / STOW_BACK);
    else stow = Math.min(1, stow + dt / STOW_TIME);

    // the gate is down while it is near
    const p = poseNow();
    const g = ftcGates[visit.gate.id];
    if (Math.hypot(p.x - visit.gate.at.x, p.z - visit.gate.at.y) < GATE_NEAR) g.want.add(me);
    else g.want.delete(me);
  };
}
