// The Into the Deep robot's loop, forever: starting at the west end of the submersible, it does two jobs in turn, each one a flowing drive with
// the arm working as it goes. Each job: the arm is already out, forward, to a sample lying in the submersible (it extended over the last stretch of
// the way in); the head drops and the paddle rolls the sample onto the scoop, and the moment it is on the robot sets off, the head curling up, the
// slide retracting and the arm pivoting up to stand upright with the sample lying on top of it as it accelerates. It drives like that to a basket,
// and over the last second of the run the lift extends straight up to the basket's height, the head swinging round, so that it stops diagonally with
// its back to the bucket and the arm already up. There it leans back over the bucket and tips until the sample slides out, and at that instant it is
// off again: the head turns up out of the bucket and the arm pivots down and retracts as it goes. The long runs cruise at the top speed and brake
// late. The first job takes a red sample to the red basket; the second takes a yellow one from the south side of the submersible to the blue
// basket. The robot never has to turn round: the sample goes over the top.
//
// The game pieces are persistent. The sample the robot takes vanishes from the floor as it rolls onto the scoop and a new one
// grows back in the same spot once the robot has driven away with it; the one it drops shows on top of the basket's pile until
// the robot has driven off, and then shrinks away, so the next lap can do it again. That is `ftcField` (ftcfield.ts), which is
// worked out every frame from where the robot is in its loop, so it can never be left wrong by a skipped frame.
//
// Like drive.ts and errand.ts it only sets the prop's x, z and heading (the hover lift owns its height, so the robot rides the
// floor up and down), and it poses the model through `userData.pose` (see ftcrobot.ts). It is a mecanum robot, so it turns while
// it drives rather than pointing along its route.
import { CatmullRomCurve3, Quaternion, Vector3, type Group } from "three";
import { ftcField } from "./ftcfield";
import { ARM, HEAD, STOWED } from "./ftcrobot";
import type { ArmPose, RobotPose } from "./ftcrobot";
import type { AnimCtx } from "./models";
import type { RobotCycle, RobotJob } from "./scenes";

const TOP = 27; // px/s, the most it drives at: the Power Play robot's top speed
const RAMP = 0.55; // how long it takes to get up to that speed from a stop, and to come back to a stop (s); a long run cruises at TOP in between
const SPEED = TOP / 1.5; // px/s on average along a short run, which has no room to cruise (it eases out of and into its stops, so its top speed is half as much again, TOP)
const INTRO = 0.4; // how long the arm takes to come out from folded at the very start, there being no drive in before it
const EXTEND = 15; // how far (px) from its stop at the submersible the robot is when the arm starts to extend
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
  /** Or the route it drives, turning from the heading it sets off with to the one it stops with, and its speed profile (the default eases in and out). */
  route?: { curve: CatmullRomCurve3; h0: number; h1: number; ease?: (u: number) => number };
  arm: [ArmPose, ArmPose];
  /** For a drive, a second arm move after the first, from `from` to `to` (fractions of the phase), to a new pose. */
  then?: { arm: ArmPose; from: number; to: number };
  /** For a drive, how long the arm takes to go from the first pose to the second, from the start of the phase (it eases over the whole phase if this is not given). */
  armTime?: number;
  /** Or a joint's own track of values through the phase, `[seconds in, value]`, eased from one to the next, which overrides the two above. */
  keys?: Partial<Record<keyof ArmPose, [number, number][]>>;
  spin?: boolean;
  /** Whether a sample is on the scoop, through the phase, its colour, and how far it has rolled onto the scoop. */
  carry: (u: number) => boolean;
  color?: string;
  slide?: (u: number) => number;
  mark?: Mark;
}

/** How long each thing that happens to the field takes. */
const FADE = { pick: 0.3, spawn: 0.4, drop: 0.4, clear: 0.4 }; // (a drop is the sample's fall from the scoop into the bucket)

export function attachCycle(model: Group, cfg: RobotCycle) {
  const curve = (pts: { x: number; y: number }[]) => {
    const c = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, 0, p.y)),
      false,
      "centripetal"
    );
    c.arcLengthDivisions = 600;
    return c;
  };
  /**
   * How long a run along `c` takes and how far along it the robot is after `u` of that: a long run gets up to TOP in RAMP, cruises and comes to a
   * stop in RAMP; a short one just eases in and out (and takes at least 1.4 s).
   */
  const profile = (c: CatmullRomCurve3): { dur: number; ease?: (u: number) => number } => {
    const d = c.getLength();
    if (d <= 2 * TOP * RAMP + 2) return { dur: Math.max(1.4, d / SPEED) };
    const T = d / TOP + RAMP;
    const g = (w: number) => w * w * w - (w * w * w * w) / 2; // the distance covered getting up to speed, in TOP * RAMP, at w of the way through the ramp
    return {
      dur: T,
      ease: (u: number) => {
        const t = u * T;
        if (t < RAMP) return (TOP * RAMP * g(t / RAMP)) / d;
        if (t > T - RAMP) return 1 - (TOP * RAMP * g((T - t) / RAMP)) / d;
        return (TOP * (RAMP / 2 + (t - RAMP))) / d;
      },
    };
  };
  /** How far through a run (0..1) the robot is first within `dist` px of its end. */
  const lastStretch = (c: CatmullRomCurve3, ease: ((u: number) => number) | undefined, dist: number) => {
    const d = c.getLength();
    for (let n = 0; n <= 400; n++) {
      const u = n / 400;
      if (d * (1 - (ease ? ease(u) : smooth(u))) <= dist) return u;
    }
    return 1;
  };
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
    const releaseArm = mix(upArm, tipArm, smooth(0.55)); // where the tip has got to when the sample slides out
    return { job, intakeAt, scoreAt, intakeArm, vertArm, upArm, tipArm, turnedArm, reachedArm, releaseArm };
  };
  const jobs = cfg.jobs.map(prepare);

  // Where each sample leaves the scoop: pose the robot as it is at that moment of the tip (the sample just about to slide off), standing at the
  // basket, and note where the sample is and how it lies, so that the basket can bring it down from there into the bucket.
  {
    const posed = model.userData.pose as ((p: RobotPose) => void) | undefined;
    const where = model.userData.sampleWorld as (() => { pos: Vector3; quat: Quaternion }) | undefined;
    if (posed && where) {
      const y = model.position.y;
      for (const j of jobs) {
        model.position.set(0, y, 0);
        model.rotation.y = 0;
        posed({ ...j.releaseArm, spin: 0, carrying: true, carryColor: j.job.intake.color, slide: 1 });
        const s = where();
        const h = j.scoreAt.h;
        const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -h); // the robot is turned by -h about the vertical, here and there
        const q = turn.multiply(s.quat);
        ftcField.flight[j.job.score.basket] = {
          from: [j.scoreAt.x + s.pos.x * Math.cos(h) - s.pos.z * Math.sin(h), s.pos.y, j.scoreAt.y + s.pos.x * Math.sin(h) + s.pos.z * Math.cos(h)],
          quat: [q.x, q.y, q.z, q.w],
        };
      }
      posed({ ...STOWED, spin: 0, carrying: false, carryColor: YELLOW, slide: 1 });
    }
  }

  /** Pick up (the slide is already out, extended on the way in): the head drops and the sample rolls on. The robot sets off the moment it has it. */
  const intakePhases = (j: ReturnType<typeof prepare>): Phase[] => {
    const color = j.job.intake.color;
    const slot = j.job.intake.slot;
    const ROLL = 0.6; // from the head landing to the sample being on the scoop
    return [
      { dur: 0.25, at: j.intakeAt, arm: [j.reachedArm, j.intakeArm], spin: true, carry: never }, // the head drops to the floor
      {
        dur: ROLL,
        at: j.intakeAt,
        arm: [j.intakeArm, j.intakeArm],
        spin: true,
        // the sample on the floor shrinks away as the paddle rolls it up the scoop
        carry: (u) => u > 0.255 / ROLL,
        slide: (u) => smooth((u - 0.255 / ROLL) / (0.34 / ROLL)),
        color,
        mark: { what: "pick", index: slot, offset: 0.255 },
      },
    ];
  };

  /**
   * Drop it in: the arm is already up (it went up on the way); it leans back over the bucket and tips until the sample slides out, and at that
   * instant the robot is off (the arm pivots down and retracts as it goes).
   */
  const depositPhases = (j: ReturnType<typeof prepare>): Phase[] => {
    const color = j.job.intake.color;
    return [
      {
        dur: 0.44,
        at: j.scoreAt,
        arm: [j.upArm, j.releaseArm],
        carry: always, // (the sample goes with the end of this phase)
        color,
        mark: { what: "drop", index: j.job.score.basket, offset: 0.44 },
      },
    ];
  };

  // the loop: job 0, the way to job 1, job 1, the way back to job 0
  const loop: Phase[] = [];
  jobs.forEach((j, n) => {
    const next = jobs[(n + 1) % jobs.length];
    const color = j.job.intake.color;
    const over = curve([j.intakeAt, ...j.job.over, j.scoreAt]);
    const between = curve([j.scoreAt, ...cfg.between[n], next.intakeAt]);
    const overRun = profile(over);
    const betweenRun = profile(between);
    loop.push(...intakePhases(j));
    // Away from the submersible the moment the sample is on: the head curls up, the slide retracts and the arm stands upright as it goes, and over
    // the last second of the run (not before the arm is upright) the lift goes up to the basket's height, the head swinging round to face the bucket.
    const D = overRun.dur;
    const lift = Math.max(D - 1.0, 0.8); // when the lift starts
    loop.push({
      dur: D,
      route: { curve: over, h0: j.intakeAt.h, h1: j.scoreAt.h, ease: overRun.ease },
      arm: [j.intakeArm, j.upArm],
      keys: {
        pitch: [[0, j.intakeArm.pitch], [0.25, STOWED.pitch], [0.45, STOWED.pitch], [0.8, j.vertArm.pitch]],
        extend: [[0, j.intakeArm.extend], [0.25, j.intakeArm.extend], [0.55, 0], [lift, 0], [D, j.upArm.extend]],
        head: [[0, j.intakeArm.head], [0.25, STOWED.head], [lift, STOWED.head], [D, j.upArm.head]],
        roll: [[0, 0], [lift, 0], [D, j.upArm.roll]],
      },
      carry: always,
      color,
      mark: { what: "spawn", index: j.job.intake.slot, offset: 0.7 }, // a new sample grows back once the robot has set off with this one
    });
    loop.push(...depositPhases(j));
    // Away from the basket at the instant of release: the head turns up out of the bucket and then the arm pivots down and retracts as it goes,
    // and over the last stretch to the submersible the arm extends again
    loop.push({
      dur: betweenRun.dur,
      route: { curve: between, h0: j.scoreAt.h, h1: next.intakeAt.h, ease: betweenRun.ease },
      arm: [j.releaseArm, STOWED],
      keys: {
        head: [[0, j.releaseArm.head], [0.55, STOWED.head]],
        roll: [[0, j.releaseArm.roll], [0.55, 0]],
        extend: [[0.4, j.releaseArm.extend], [1.05, 0]],
        pitch: [[0.4, j.releaseArm.pitch], [1.05, 0]],
      },
      then: { arm: next.reachedArm, from: lastStretch(between, betweenRun.ease, EXTEND), to: 1 },
      carry: never,
      mark: { what: "clear", index: j.job.score.basket, offset: 0.9 }, // and the sample it dropped goes once the robot has driven off
    });
  });
  const loopTotal = loop.reduce((s, p) => s + p.dur, 0);

  // it starts where the loop does, at the first job's intake stop with the arm stowed (reduced motion, which never animates it, leaves it there)
  model.position.set(jobs[0].intakeAt.x, model.position.y, jobs[0].intakeAt.y);
  model.rotation.y = -jobs[0].intakeAt.h;

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
      else dropped[ev.index] += ramp(tl, ev.at, ev.what === "drop" ? FADE.drop : FADE.clear); // 0..1 falling in, 1..2 shrinking away
    }
    ftcField.sample[0] = Math.min(1, Math.max(0, sample[0]));
    ftcField.sample[1] = Math.min(1, Math.max(0, sample[1]));
    ftcField.dropped[0] = Math.min(2, Math.max(0, dropped[0]));
    ftcField.dropped[1] = Math.min(2, Math.max(0, dropped[1]));
  };

  /** The arm's pose `e` seconds (`u` of the way) into a phase. */
  const armAt = (ph: Phase, e: number, u: number, k: number): ArmPose => {
    const a = mix(ph.arm[0], ph.arm[1], ph.armTime ? smooth(e / ph.armTime) : k);
    if (ph.keys) {
      for (const c of ["pitch", "extend", "head", "roll"] as const) {
        const ks = ph.keys[c];
        if (ks) a[c] = track(ks, e);
      }
    }
    return ph.then ? mix(a, ph.then.arm, smooth((u - ph.then.from) / (ph.then.to - ph.then.from))) : a;
  };
  /** A joint's value `e` seconds into its track. */
  const track = (ks: [number, number][], e: number) => {
    if (e <= ks[0][0]) return ks[0][1];
    for (let n = 1; n < ks.length; n++) {
      if (e <= ks[n][0]) return lerp(ks[n - 1][1], ks[n][1], smooth((e - ks[n - 1][0]) / (ks[n][0] - ks[n - 1][0])));
    }
    return ks[ks.length - 1][1];
  };

  let lastT = -1;
  let spinning = 0; // 0..1, how fast the paddle is going
  let spin = 0; // its angle
  model.userData.stowed = { ...STOWED }; // (what robotvisit.ts folds the arm to while the robot is away from its loop)

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: at its first stop, the arm folded, every sample where it was
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;

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
      const p = ph.route.curve.getPointAt(Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : k)));
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
      ...(t < INTRO ? mix(STOWED, armAt(ph, e, u, k), smooth(t / INTRO)) : armAt(ph, e, u, k)), // (the very first moments: the arm comes out from its folded pose, as it does on the way in later)
      spin,
      carrying: ph.carry(u),
      carryColor: ph.color ?? YELLOW,
      slide: ph.slide ? ph.slide(u) : 1,
    });
  };
}
