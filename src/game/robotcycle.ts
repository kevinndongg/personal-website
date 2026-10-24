// The Into the Deep robot's scoring loop, forever: park, drive to the west end of the submersible, lower the arm and scoop a
// sample off its floor with the front of the robot, fold the arm up with it, drive to the basket and stop with the robot's
// back to it, swing the arm up and back over the top of the robot and tip the sample into the bucket behind it, fold up and
// drive back to the start square. The robot never has to turn round: the sample goes over the top. Like drive.ts and errand.ts
// it only sets the prop's x, z and heading (the hover lift owns its height, so the robot rides the floor up and down), and it
// poses the model through `userData.pose` (see ftcrobot.ts). It is a mecanum robot, so it turns while it drives rather than
// pointing along its route.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { ARM, HEAD, STOWED } from "./ftcrobot";
import type { ArmPose, RobotPose } from "./ftcrobot";
import type { AnimCtx } from "./models";
import type { RobotCycle } from "./scenes";

const SPEED = 36; // px/s along the route (the robot eases out of and into each stop)
const SPIN_RATE = 14; // rad/s of the paddle wheel while it is running
const FLOOR_Y = 1.2; // the top of the submersible's floor plate, where the scoop lies
const OVER_RIM = 2.5; // how far above the bucket's rim the head holds the sample
const TIP = (60 * Math.PI) / 180; // the head tipped nose down to slide the sample out
const TURN = Math.PI * 2;

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
  roll: lerp(a.roll, b.roll, k),
});

/**
 * The arm pose that puts the sample on the scoop over `target` (world px) at `height`, for a robot standing at `at` facing
 * `heading`. In front (`back` false) the scoop points forward, so the wrist pivot is held `HEAD.reach` short of the target;
 * behind (`back` true) the arm leans over the top of the robot and the scoop points backward, so the pivot is that far in front
 * of it, and the head is turned over so that the sample stays on top.
 */
function reach(at: { x: number; y: number }, heading: number, target: { x: number; y: number }, height: number, back: boolean): ArmPose {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const sx = at.x + fx * ARM.x;
  const sy = at.y + fy * ARM.x;
  const along = (target.x - sx) * fx + (target.y - sy) * fy; // negative: behind the shoulder
  const d = back ? along + HEAD.reach : along - HEAD.reach;
  const h = height - ARM.y;
  return {
    pitch: Math.atan2(h, d), // past a quarter turn when the target is behind
    extend: Math.max(0, Math.hypot(d, h) - ARM.base),
    head: back ? Math.PI : 0,
    roll: back ? Math.PI : 0,
  };
}

interface Pose {
  x: number;
  y: number;
  h: number; // heading, radians in the world plane (y = south)
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop). */
  at?: Pose;
  /** Or the route it drives, turning from the heading it sets off with to the one it stops with. */
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

  const { intake, score } = cfg;
  // at the submersible the front of the robot faces the sample; at the basket its back does
  const intakeAt: Pose = { ...intake.at, h: Math.atan2(intake.target.y - intake.at.y, intake.target.x - intake.at.x) };
  const scoreAt: Pose = { ...score.at, h: Math.atan2(score.at.y - score.target.y, score.at.x - score.target.x) };
  const intakeArm = reach(intakeAt, intakeAt.h, intake.target, FLOOR_Y + HEAD.drop, false);
  const scoreArm = reach(scoreAt, scoreAt.h, score.target, score.rim + OVER_RIM, true);
  // the arm goes up in two moves, as the real one does: straight up to its full height first, then it leans back over the bucket
  const upArm: ArmPose = { pitch: Math.PI / 2, extend: scoreArm.extend, head: 0, roll: 0 };
  const tipArm: ArmPose = { ...scoreArm, head: scoreArm.head + TIP };
  // coming back, the head carries on round the way it was going, so that it ends where it started without unwinding
  const foldArm: ArmPose = { ...STOWED, head: TURN, roll: TURN };

  const out = curve([home, ...cfg.out, intakeAt]);
  const over = curve([intakeAt, ...cfg.over, scoreAt]);
  const back = curve([scoreAt, ...cfg.home, home]);
  const drive = (c: CatmullRomCurve3) => Math.max(1.4, c.getLength() / SPEED);
  const never = () => false;
  const always = () => true;

  // about 10 s a lap: the real robot takes 7.5 s from basket to basket, slowed down a little so that every move can be followed
  const phases: Phase[] = [
    { dur: 0.4, at: home, arm: [STOWED, STOWED], carry: never },
    { dur: drive(out), route: { curve: out, h0: home.h, h1: intakeAt.h }, arm: [STOWED, STOWED], carry: never },
    { dur: 0.7, at: intakeAt, arm: [STOWED, intakeArm], spin: true, carry: never }, // lowers the arm, the paddle starting up
    { dur: 1.0, at: intakeAt, arm: [intakeArm, intakeArm], spin: true, carry: (u) => u > 0.55 }, // the sample rolls on
    { dur: 0.6, at: intakeAt, arm: [intakeArm, STOWED], carry: always },
    { dur: drive(over), route: { curve: over, h0: intakeAt.h, h1: scoreAt.h }, arm: [STOWED, STOWED], carry: always },
    { dur: 0.9, at: scoreAt, arm: [STOWED, upArm], carry: always }, // straight up, and out to full height
    { dur: 0.7, at: scoreAt, arm: [upArm, scoreArm], carry: always }, // then leans back over the top, over the bucket
    { dur: 0.7, at: scoreAt, arm: [scoreArm, tipArm], carry: (u) => u < 0.5 }, // tips, and the sample slides out into the bucket
    { dur: 0.8, at: scoreAt, arm: [tipArm, foldArm], carry: never },
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
      const p = ph.route.curve.getPointAt(k);
      at = { x: p.x, y: p.z, h: ph.route.h0 + wrap(ph.route.h1 - ph.route.h0) * k };
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
