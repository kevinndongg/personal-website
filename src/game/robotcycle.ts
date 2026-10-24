// The Into the Deep robot's scoring loop, forever: park, drive up to the submersible, lower the arm and scoop a sample off its
// floor, fold the arm up with it, drive round to the basket, raise the arm over the bucket, tip the sample in, fold up and drive
// back to the start square. Like drive.ts and errand.ts it only sets the prop's x, z and heading (the hover lift owns its
// height, so the robot rides the floor up and down), and it poses the model through `userData.pose` (see ftcrobot.ts).
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { ARM, HEAD, STOWED } from "./ftcrobot";
import type { ArmPose, RobotPose } from "./ftcrobot";
import type { AnimCtx } from "./models";
import type { RobotCycle } from "./scenes";

const SPEED = 24; // px/s along the route (the robot eases out of and into each stop)
const SPIN_RATE = 14; // rad/s of the paddle wheel while it is running
const FLOOR_Y = 1.2; // the top of the submersible's floor plate, where the scoop lies
const OVER_RIM = 2.5; // how far above the bucket's rim the head holds the sample
const DUMP = (-60 * Math.PI) / 180; // the head tipped forward to slide the sample out

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const mix = (a: ArmPose, b: ArmPose, k: number): ArmPose => ({
  pitch: lerp(a.pitch, b.pitch, k),
  extend: lerp(a.extend, b.extend, k),
  head: lerp(a.head, b.head, k),
});

/**
 * The arm pose that puts the wrist pivot over `target` (world px) at `height`, for a robot standing at `at` facing `heading`:
 * the pivot is held back from the target by `HEAD.reach`, so the sample on the scoop ends up on it.
 */
function reach(at: { x: number; y: number }, heading: number, target: { x: number; y: number }, height: number): ArmPose {
  const sx = at.x + Math.cos(heading) * ARM.x;
  const sy = at.y + Math.sin(heading) * ARM.x;
  const d = Math.max(0.1, Math.hypot(target.x - sx, target.y - sy) - HEAD.reach);
  const h = height - ARM.y;
  return { pitch: Math.atan2(h, d), extend: Math.max(0, Math.hypot(d, h) - ARM.base), head: 0 };
}

interface Pose {
  x: number;
  y: number;
  h: number; // heading, radians in the world plane (y = south)
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop), or the route it drives (then `at` is not used). */
  at?: Pose;
  route?: { curve: CatmullRomCurve3; h0: number; h1: number };
  arm: [ArmPose, ArmPose];
  spin?: boolean;
  carry: (u: number) => boolean; // whether a sample is on the scoop, through the phase
}

export function attachCycle(model: Group, cfg: RobotCycle) {
  const home: Pose = { x: model.position.x, y: model.position.z, h: -model.rotation.y };
  const curve = (pts: { x: number; y: number }[]) => {
    const c = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, 0, p.y)),
      false,
      "centripetal"
    );
    c.arcLengthDivisions = 600;
    return c;
  };

  const { intake, score, via } = cfg;
  // at each stop the robot faces what it is working on
  const intakeAt: Pose = { ...intake.at, h: Math.atan2(intake.target.y - intake.at.y, intake.target.x - intake.at.x) };
  const scoreAt: Pose = { ...score.at, h: Math.atan2(score.target.y - score.at.y, score.target.x - score.at.x) };
  const intakeArm = reach(intakeAt, intakeAt.h, intake.target, FLOOR_Y + HEAD.drop);
  const scoreArm = reach(scoreAt, scoreAt.h, score.target, score.rim + OVER_RIM);
  const dumpArm: ArmPose = { ...scoreArm, head: DUMP };

  const out = curve([home, intakeAt]);
  const mid = curve([intakeAt, ...via, scoreAt]);
  const back = curve([scoreAt, ...[...via].reverse(), home]);
  const drive = (c: CatmullRomCurve3) => Math.max(1.8, c.getLength() / SPEED);
  const never = () => false;
  const always = () => true;

  const phases: Phase[] = [
    { dur: 1.5, at: home, arm: [STOWED, STOWED], carry: never },
    { dur: drive(out), route: { curve: out, h0: home.h, h1: intakeAt.h }, arm: [STOWED, STOWED], carry: never },
    { dur: 1.2, at: intakeAt, arm: [STOWED, intakeArm], spin: true, carry: never }, // lowers the arm, the paddle starting up
    { dur: 1.6, at: intakeAt, arm: [intakeArm, intakeArm], spin: true, carry: (u) => u > 0.55 }, // the sample rolls on
    { dur: 1.0, at: intakeAt, arm: [intakeArm, STOWED], carry: always },
    { dur: drive(mid), route: { curve: mid, h0: intakeAt.h, h1: scoreAt.h }, arm: [STOWED, STOWED], carry: always },
    { dur: 1.8, at: scoreAt, arm: [STOWED, scoreArm], carry: always },
    { dur: 0.9, at: scoreAt, arm: [scoreArm, dumpArm], carry: (u) => u < 0.5 }, // tips, and the sample slides out over the bucket
    { dur: 1.0, at: scoreAt, arm: [dumpArm, STOWED], carry: never },
    { dur: drive(back), route: { curve: back, h0: scoreAt.h, h1: home.h }, arm: [STOWED, STOWED], carry: never },
  ];
  const total = phases.reduce((s, p) => s + p.dur, 0);

  let lastT = -1;
  let spinning = 0; // 0..1, how fast the paddle is going
  let spin = 0; // its angle

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: parked, the arm folded
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;

    let e = t % total;
    let i = 0;
    while (i < phases.length - 1 && e >= phases[i].dur) e -= phases[i++].dur;
    const ph = phases[i];
    const u = e / ph.dur;
    const k = smooth(u);

    let at: Pose;
    if (ph.route) {
      // follow the route, turning from the heading it set off with onto the way it is going, and onto the heading it stops with
      const p = ph.route.curve.getPointAt(k);
      const d = ph.route.curve.getTangentAt(k);
      let h = ph.route.h0 + wrap(Math.atan2(d.z, d.x) - ph.route.h0) * smooth(k / 0.2);
      h += wrap(ph.route.h1 - h) * smooth((k - 0.75) / 0.25);
      at = { x: p.x, y: p.z, h };
    } else {
      at = ph.at!;
    }
    model.position.x = at.x;
    model.position.z = at.y;
    model.rotation.y = -at.h;

    spinning += ((ph.spin ? 1 : 0) - spinning) * (1 - Math.exp(-dt * 6));
    spin += dt * SPIN_RATE * spinning;
    const pose = model.userData.pose as ((p: RobotPose) => void) | undefined;
    pose?.({ ...mix(ph.arm[0], ph.arm[1], k), spin, carrying: ph.carry(u) });
  };
}
