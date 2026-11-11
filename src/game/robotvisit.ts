// An FTC robot's trip to the name, when the about card opens, and back to exactly where it was in its loop when the card closes.
//
// The three loops (robotcycle.ts, ppcycle.ts, cscycle.ts) work out everything from the time they are given, so a robot is paused by giving
// its cycle one frozen time (it stays posed, and the game pieces stay as they were) and resumed by giving it the time minus all it was
// away. Here the robot drives its own route in the meantime: it joins `visit.path` at the nearest stretch from wherever it is, follows it out of
// the field through its gate (a piece of the wall that lowers: `ftcGates`, drawn by `gateModel` in ftcmodels.ts) and across the map to the stop,
// facing the name, with its arm folded away. Closing the card, it goes back the same way to where it left its loop.
//
// It is a mecanum robot, so it does not have to point along its route: its heading eases onto the route's direction as it sets off and onto
// the stop's (or its loop's) heading as it arrives, rather than turning on an arc as the formula car does (drive.ts).
//
// Interruption: closing the card while it is on the way out brakes it to a stop where it is, and it goes home from there; opening it again
// while it is coming home finishes the trip home first (it never turns round at speed) and then sets off again.
import type { Group } from "three";
import type { AnimCtx } from "./models";
import type { RobotVisit } from "./scenes";
import { curvePoses, makeLeg, poseAt, spacing, type Leg, type Pose, type Pt } from "./visit";

/** px/s: slower than the formula car (a robot is a much smaller thing). */
export const ROBOT_SPEED = 100;
const ACCEL = 240; // px/s^2 pulling away
const BRAKE = 200; // px/s^2 stopping (it plans with 60% of it, so that it can always follow the plan)
const BLEND = 26; // px over which the heading eases onto the route's, and onto the stop's
const STOW_TIME = 0.4; // s to fold the arm away as it sets off
const STOW_BACK = 40; // px before home over which the arm comes back out
const GATE_NEAR = 46; // px: a gate is down while a robot is this close to it

/** The gates in the field's wall: one per robot, down (open) while a robot is passing. `open` is 0..1, eased by the gate's own model. */
export const ftcGates = [0, 1, 2].map(() => ({ open: 0, want: new Set<object>() }));

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, k: number) => a + wrap(b - a) * k;

/** A leg along `pts` (the first is where it is now), its heading easing from `startH` onto the route's direction and then onto `endH`. */
function robotLeg(pts: Pt[], startH: number, endH: number): Leg {
  const poses = curvePoses(pts);
  const len = spacing(poses);
  const n = Math.max(1, poses.length - 1);
  poses.forEach((p, i) => {
    const s = (len * i) / n;
    const h = lerpAngle(startH, p.h, smooth(s / BLEND));
    p.h = lerpAngle(endH, h, smooth((len - s) / BLEND));
  });
  return makeLeg(poses, { speed: ROBOT_SPEED, brake: true });
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
    const k = Math.min(1, Math.max(0, ((from.x - a.x) * dx + (from.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(from.x - (a.x + dx * k), from.y - (a.y + dy * k));
    if (d < bestD) (bestD = d), (best = i + 1);
  }
  return best;
}

/**
 * Gives a robot (one whose cycle is attached already) the trip: `model.userData.sendOut()` sends it, `model.userData.recall()` brings it home.
 * The cycle's own `userData.stowed` (the pose it starts from, with the arm folded) is what its arm is brought to while it is away.
 */
export function attachRobotVisit(model: Group, visit: RobotVisit) {
  const cycle = model.userData.animate as (c: AnimCtx) => void;
  const basePose = model.userData.pose as ((p: Record<string, unknown>) => void) | undefined;
  const stowed = (model.userData.stowed ?? {}) as Record<string, number>;
  const me = {}; // (what a gate knows this robot by)
  let stow = 0; // 0..1: how far the arm is folded away

  // the arm: while it is away every joint the cycle names is blended toward the folded pose (the carried piece and the wheels are left as they are)
  model.userData.pose = (p: Record<string, unknown>) => {
    if (stow <= 0.001) return basePose?.(p);
    const q = { ...p };
    for (const k of Object.keys(stowed)) if (typeof p[k] === "number") q[k] = (p[k] as number) + (stowed[k] - (p[k] as number)) * stow;
    basePose?.(q);
  };

  type Phase = "cycle" | "out" | "away" | "back";
  let phase: Phase = "cycle";
  let wanted = false;
  let wantedSince = -1;
  let lost = 0; // how long it has spent away, in all: the cycle is given the time minus this
  let cycleT = 0; // the cycle time it was last given, which is what it is frozen at while away
  let awayAt = 0;
  let lastT = -1;
  let home: Pose = { x: 0, z: 0, h: 0 };
  let way: Pt[] = []; // the part of visit.path it follows, after where it joined it
  let leg: Leg | null = null;
  let wpS: number[] = []; // how far along the way out each of `way`'s points is
  let s = 0;
  let v = 0;
  let stopAt = Infinity; // brake to a stop here (the card was closed on the way out)

  model.userData.sendOut = () => {
    wanted = true;
  };
  model.userData.recall = () => {
    wanted = false;
  };
  model.userData.visitPhase = () => phase;

  const poseNow = (): Pose => ({ x: model.position.x, z: model.position.z, h: -model.rotation.y });
  const place = (p: Pose) => {
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -p.h;
  };

  const beginOut = (t: number) => {
    home = poseNow();
    awayAt = t;
    const join = joinIndex({ x: home.x, y: home.z }, visit.path);
    way = visit.path.slice(join);
    const pts = [{ x: home.x, y: home.z }, ...way];
    leg = robotLeg(pts, home.h, visit.heading);
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
    v = 0;
    stopAt = Infinity;
    phase = "out";
  };

  const beginBack = () => {
    const here = poseNow();
    // the points of the way it has passed, back to front, and then home
    const behind = way.filter((_, i) => wpS[i] < s - 6).reverse();
    leg = robotLeg([{ x: here.x, y: here.z }, ...behind, { x: home.x, y: home.z }], here.h, home.h);
    s = 0;
    v = 0;
    phase = "back";
  };

  model.userData.animate = (ctx: AnimCtx) => {
    const t = ctx.t;
    if (t <= 0) return cycle(ctx); // reduced motion
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    if (wanted) {
      if (wantedSince < 0) wantedSince = t;
    } else wantedSince = -1;

    if (phase === "cycle") {
      if (wanted && t - wantedSince >= visit.delay) beginOut(t);
      else {
        cycleT = t - lost;
        return cycle({ ...ctx, t: cycleT });
      }
    }

    // away from the loop: the cycle is held at the moment it was left (its pose, its game pieces), and this drives the robot
    cycle({ ...ctx, t: cycleT }); // (it puts the robot back at its loop's place: where the robot really is is put again below)
    if (leg) place(poseAt(leg, s));

    if (phase === "away") {
      if (wanted) {
        if (leg && s < leg.len - 1) phase = "out"; // (braked to a stop part of the way, and wanted again)
      } else beginBack();
    }
    if (phase === "out" && !wanted) {
      if (stopAt === Infinity && leg) stopAt = Math.min(leg.len, s + (v * v) / (2 * BRAKE * 0.6) + 1);
    } else if (phase === "out") stopAt = Infinity;

    if (leg && (phase === "out" || phase === "back")) {
      const end = phase === "out" ? Math.min(leg.len, stopAt) : leg.len;
      const rest = end - s;
      const target = Math.min(ROBOT_SPEED, 5 + Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, rest)));
      v += Math.min(ACCEL * dt, Math.max(-BRAKE * dt, target - v));
      s = Math.min(end, s + Math.max(0, v) * dt);
      place(poseAt(leg, s));
      if (s >= end - 0.05) {
        v = 0;
        if (phase === "out") phase = "away";
        else {
          // home: exactly where the loop was left, and the loop goes on from that moment
          place(home);
          lost += t - awayAt;
          stow = 0;
          phase = "cycle";
          ftcGates[visit.gate.id].want.delete(me);
          return;
        }
      }
    }

    // the arm: folded away as it sets off, and brought back out over the last stretch home
    if (phase === "back" && leg) stow = Math.min(stow, smooth((leg.len - s) / STOW_BACK));
    else stow = Math.min(1, stow + dt / STOW_TIME);

    // the gate is down while it is near
    const p = poseNow();
    const g = ftcGates[visit.gate.id];
    if (Math.hypot(p.x - visit.gate.at.x, p.z - visit.gate.at.y) < GATE_NEAR) g.want.add(me);
    else g.want.delete(me);
  };
}
