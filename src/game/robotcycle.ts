// The Into the Deep robot's loop, forever: it parks for a moment, drives to the west end of the submersible, and from then on it
// does two jobs in turn. Each job: extend the arm forward to a sample lying in the submersible (the arm lies flat when
// empty, so it only has to extend) and roll it onto the scoop, retract, pivot the arm up to stand upright with the sample lying
// on top of it, drive like that to a basket and stop diagonally with its back to the bucket, extend the arm straight up and
// lean it back over the robot to tip the sample into the bucket behind it, then lay the arm back down flat. The first job takes
// a red sample to the red basket; the second takes a yellow one
// from the south side of the submersible to the blue basket. The robot never has to turn round: the sample goes over the top.
//
// The game pieces are persistent. The sample the robot takes vanishes from the floor as it rolls onto the scoop and a new one
// grows back in the same spot once the robot has driven away with it; the one it drops shows on top of the basket's pile until
// the robot has driven off, and then shrinks away, so the next lap can do it again. That is `ftcField` (ftcfield.ts), which is
// worked out every frame from where the robot is in its loop, so it can never be left wrong by a skipped frame.
//
// Like drive.ts and errand.ts it only sets the prop's x, z and heading (the hover lift owns its height, so the robot rides the
// floor up and down), and it poses the model through `userData.pose` (see ftcrobot.ts). It is a mecanum robot, so it turns while
// it drives rather than pointing along its route.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { ftcField } from "./ftcfield";
import { ARM, HEAD, STOWED } from "./ftcrobot";
import type { ArmPose, RobotPose } from "./ftcrobot";
import type { AnimCtx } from "./models";
import type { RobotCycle, RobotJob } from "./scenes";

const SPEED = 36; // px/s along the route (the robot eases out of and into each stop)
const SPIN_RATE = 14; // rad/s of the paddle wheel while it is running
const FLOOR_Y = 1.2; // the top of the submersible's floor plate, where the scoop lies
const OVER_RIM = 2.5; // how far above the bucket's rim the head holds the sample
const TIP = (60 * Math.PI) / 180; // the head tipped nose down to slide the sample out
const YELLOW = "#f2c230";

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const ramp = (t: number, t0: number, dur: number) => smooth((t - t0) / dur);
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

/** Something that happens to the field at a moment in a phase (`offset` seconds in), for one of the samples or baskets. */
interface Mark {
  what: "pick" | "spawn" | "drop" | "clear";
  index: number; // the sample (`ftcField.sample`) or the basket (`ftcField.dropped`)
  offset: number;
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop). */
  at?: Pose;
  /** Or the route it drives, turning from the heading it sets off with to the one it stops with. */
  route?: { curve: CatmullRomCurve3; h0: number; h1: number };
  arm: [ArmPose, ArmPose];
  spin?: boolean;
  /** Whether a sample is on the scoop, through the phase, its colour, and how far it has rolled onto the scoop. */
  carry: (u: number) => boolean;
  color?: string;
  slide?: (u: number) => number;
  mark?: Mark;
}

/** How long each thing that happens to the field takes. */
const FADE = { pick: 0.3, spawn: 0.4, drop: 0.3, clear: 0.4 };

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
  const drive = (c: CatmullRomCurve3) => Math.max(1.4, c.getLength() / SPEED);
  const never = () => false;
  const always = () => true;

  /** Everything about one job that depends on where its stops are. */
  const prepare = (job: RobotJob) => {
    const { intake, score } = job;
    // at the submersible the front of the robot faces the sample; at the basket its back does
    const intakeAt: Pose = { ...intake.at, h: Math.atan2(intake.target.y - intake.at.y, intake.target.x - intake.at.x) };
    const scoreAt: Pose = { ...score.at, h: Math.atan2(score.at.y - score.target.y, score.at.x - score.target.x) };
    const intakeArm = reach(intakeAt, intakeAt.h, intake.target, FLOOR_Y + HEAD.drop, false);
    // the pivot has to be one scoop's depth above where the sample is let go, which is a little over the bucket's rim
    const scoreArm = reach(scoreAt, scoreAt.h, score.target, score.rim + OVER_RIM + HEAD.drop, true);
    // The arm goes up in two moves, as the real one does: it pivots up to vertical with the slide still retracted (as soon as it
    // has the sample, and it drives like that), then at the basket extends straight up to its full height (the head swinging round
    // to point back as it goes), and last it leans back a little over the bucket as the head tips.
    const vertArm: ArmPose = { ...STOWED, pitch: Math.PI / 2 };
    const upArm: ArmPose = { pitch: Math.PI / 2, extend: scoreArm.extend, head: Math.PI, roll: Math.PI };
    const tipArm: ArmPose = { ...scoreArm, head: scoreArm.head + TIP };
    // Putting the arm away takes care, because the head hangs below the end of the slide and would go through the robot's
    // bumper, deck or hooks if it turned while the slide was near them. So the head always turns while it is clear (high above
    // the robot, or well out in front of it), and only then does the slide pivot down or retract. After the deposit the head
    // turns back the short way round (head -150 deg, roll to 0), up in the air, to the folded pose; before the intake the slide
    // extends with the head folded up, and only then does the head drop to the floor.
    const turnedArm: ArmPose = { ...tipArm, head: STOWED.head, roll: 0 };
    const reachedArm: ArmPose = { ...STOWED, extend: intakeArm.extend };
    return { job, intakeAt, scoreAt, intakeArm, vertArm, upArm, tipArm, turnedArm, reachedArm };
  };
  const jobs = cfg.jobs.map(prepare);

  /** Pick up: the slide extends, the head drops, the sample rolls on, it curls up and retracts, and the arm stands upright. */
  const intakePhases = (j: ReturnType<typeof prepare>): Phase[] => {
    const color = j.job.intake.color;
    const slot = j.job.intake.slot;
    return [
      { dur: 0.45, at: j.intakeAt, arm: [STOWED, j.reachedArm], carry: never }, // the slide just extends forward, no pivoting
      { dur: 0.25, at: j.intakeAt, arm: [j.reachedArm, j.intakeArm], spin: true, carry: never }, // the head drops to the floor
      {
        dur: 0.85,
        at: j.intakeAt,
        arm: [j.intakeArm, j.intakeArm],
        spin: true,
        // the sample on the floor shrinks away as the paddle rolls it up the scoop
        carry: (u) => u > 0.3,
        slide: (u) => smooth((u - 0.3) / 0.4),
        color,
        mark: { what: "pick", index: slot, offset: 0.3 * 0.85 },
      },
      { dur: 0.3, at: j.intakeAt, arm: [j.intakeArm, j.reachedArm], carry: always, color }, // the head curls up, out in front of the robot
      { dur: 0.45, at: j.intakeAt, arm: [j.reachedArm, STOWED], carry: always, color }, // and then the slide retracts
      // and with the sample on it the arm stands upright, ready to go straight up at the basket, and drives like that
      { dur: 0.5, at: j.intakeAt, arm: [STOWED, j.vertArm], carry: always, color },
    ];
  };

  /** Drop it in: the upright arm extends upwards, leans back and tips; the head turns, and the arm pivots down and retracts. */
  const depositPhases = (j: ReturnType<typeof prepare>): Phase[] => {
    const color = j.job.intake.color;
    return [
      // the arm is already upright, so it just extends upwards, the head swinging round to face the bucket
      { dur: 0.9, at: j.scoreAt, arm: [j.vertArm, j.upArm], carry: always, color },
      {
        dur: 0.8,
        at: j.scoreAt,
        arm: [j.upArm, j.tipArm],
        carry: (u) => u < 0.55, // leans back over the bucket and tips: the sample slides out
        color,
        mark: { what: "drop", index: j.job.score.basket, offset: 0.55 * 0.8 },
      },
      { dur: 0.45, at: j.scoreAt, arm: [j.tipArm, j.turnedArm], carry: never }, // the head turns back the short way, still up in the air
      { dur: 0.65, at: j.scoreAt, arm: [j.turnedArm, STOWED], carry: never }, // and then the arm pivots down and retracts
    ];
  };

  // the loop: job 0, the way to job 1, job 1, the way back to job 0
  const loop: Phase[] = [];
  jobs.forEach((j, n) => {
    const next = jobs[(n + 1) % jobs.length];
    const color = j.job.intake.color;
    const over = curve([j.intakeAt, ...j.job.over, j.scoreAt]);
    const between = curve([j.scoreAt, ...cfg.between[n], next.intakeAt]);
    loop.push(...intakePhases(j));
    loop.push({
      dur: drive(over),
      route: { curve: over, h0: j.intakeAt.h, h1: j.scoreAt.h },
      arm: [j.vertArm, j.vertArm], // upright, with the sample on top
      carry: always,
      color,
      mark: { what: "spawn", index: j.job.intake.slot, offset: 0.2 }, // a new sample grows back once the robot has set off with this one
    });
    loop.push(...depositPhases(j));
    loop.push({
      dur: drive(between),
      route: { curve: between, h0: j.scoreAt.h, h1: next.intakeAt.h },
      arm: [STOWED, STOWED],
      carry: never,
      mark: { what: "clear", index: j.job.score.basket, offset: 0.1 }, // and the sample it dropped goes once the robot has driven off
    });
  });
  const loopTotal = loop.reduce((s, p) => s + p.dur, 0);

  // the way in, once: parked for a moment, then to the first job's intake stop
  const first = jobs[0];
  const intro: Phase[] = [
    { dur: 0.4, at: home, arm: [STOWED, STOWED], carry: never },
    {
      dur: drive(curve([home, ...cfg.intro, first.intakeAt])),
      route: { curve: curve([home, ...cfg.intro, first.intakeAt]), h0: home.h, h1: first.intakeAt.h },
      arm: [STOWED, STOWED],
      carry: never,
    },
  ];
  const introTotal = intro.reduce((s, p) => s + p.dur, 0);

  // when, in the loop, each thing happens to the field
  const events: { what: Mark["what"]; index: number; at: number }[] = [];
  let clock = 0;
  for (const p of loop) {
    if (p.mark) events.push({ what: p.mark.what, index: p.mark.index, at: clock + p.mark.offset });
    clock += p.dur;
  }

  /** The field at `tl` seconds into the loop: a sample taken is gone until its replacement grows in; a dropped one is there until cleared. */
  const field = (tl: number) => {
    const sample = [1, 1];
    const dropped = [0, 0];
    for (const ev of events) {
      if (ev.what === "pick") sample[ev.index] -= ramp(tl, ev.at, FADE.pick);
      else if (ev.what === "spawn") sample[ev.index] += ramp(tl, ev.at, FADE.spawn);
      else if (ev.what === "drop") dropped[ev.index] += ramp(tl, ev.at, FADE.drop);
      else dropped[ev.index] -= ramp(tl, ev.at, FADE.clear);
    }
    ftcField.sample[0] = Math.min(1, Math.max(0, sample[0]));
    ftcField.sample[1] = Math.min(1, Math.max(0, sample[1]));
    ftcField.dropped[0] = Math.min(1, Math.max(0, dropped[0]));
    ftcField.dropped[1] = Math.min(1, Math.max(0, dropped[1]));
  };

  let lastT = -1;
  let spinning = 0; // 0..1, how fast the paddle is going
  let spin = 0; // its angle

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: parked, the arm folded, every sample where it was
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;

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
    } else {
      at = ph.at!;
    }
    model.position.x = at.x;
    model.position.z = at.y;
    model.rotation.y = -at.h;

    spinning += ((ph.spin ? 1 : 0) - spinning) * (1 - Math.exp(-dt * 6));
    spin += dt * SPIN_RATE * spinning;
    const pose = model.userData.pose as ((p: RobotPose) => void) | undefined;
    pose?.({
      ...mix(ph.arm[0], ph.arm[1], k),
      spin,
      carrying: ph.carry(u),
      carryColor: ph.color ?? YELLOW,
      slide: ph.slide ? ph.slide(u) : 1,
    });
  };
}
