// The film's motion for the loading screen, as a planner.
//
// What it has to do: show real progress (which arrives in bursts: a few fonts, then 11 photos, then a script, then the
// scene, then a run of GPU uploads) as a film that moves steadily and smoothly. Following the progress directly makes the
// film's speed ripple with the bursts, however well it is smoothed, and handing the browser a new animation at every
// update makes a lot of hand-overs. So the film's position is *planned*:
//
//   progress ---> gate (progress + headroom, itself smoothed by a lag) ---+
//                                                                          v
//   speed (eased) --> runner r: advances at that speed, never past the gate +
//                          |
//                          v   a lag, then a critically damped spring
//                     position x    (position, velocity and acceleration all continuous)
//
// The runner moves at a steady speed, so while it is not held back the film's motion does not depend on the updates at all;
// when it has caught up with what has really loaded it follows the (smoothed) gate. Once everything is ready the gate
// opens and the runner finishes at `finishSpeed`. The runner's speed is itself eased from one value to the next (from
// rest at the start, and from `cruise` to `finishSpeed`), so a load that finishes early does not make the film lurch.
//
// A *plan* is that system simulated forward from the current state (1 ms steps, exact for the lag and the spring) for a
// horizon of a couple of seconds, assuming progress stays where it is. The page plays it as one Web Animations keyframe
// animation per moving part (on the compositor, so it keeps going while the main thread builds the scene). A new plan is
// only made when it would differ from the one that is playing by a visible amount (the runner would reach the gate within
// the horizon, progress that matters arrives, everything is ready), and it starts from the exact state the old one has at
// that moment, so there is no jump in position, speed or acceleration where one takes over from another.

const DT = 0.001; // s, the simulation step

export interface FilmOptions {
  /** The runner's speed (of the whole range per second). `Infinity` turns the pacing off: it follows the gate. */
  cruise: number;
  /** How far ahead of real progress the film may be (of the whole range). */
  headroom: number;
  /** The runner's speed once everything is ready. */
  finishSpeed: number;
  /** The rate (1/s) at which the runner's speed moves to its new value: from rest at the start, and to `finishSpeed`. */
  speedRate: number;
  /** The rate (1/s) at which the gate follows `progress + headroom`: bursts of updates do not get through it. */
  gateRate: number;
  /** The spring's stiffness (rad/s) and the rate (1/s) of the lag in front of it. They must differ. */
  omega: number;
  lag: number;
  /** How far ahead a plan runs (s). */
  horizon: number;
}

export const FILM_DEFAULTS: FilmOptions = {
  cruise: 0.5,
  headroom: 0.06,
  finishSpeed: 0.9,
  speedRate: 3,
  gateRate: 5,
  omega: 16,
  lag: 20,
  horizon: 2.2,
};

interface State {
  r: number; // the runner
  u: number; // its speed
  g: number; // the gate (smoothed)
  y: number; // the position's input: the runner through a lag
  x: number; // the position
  v: number; // its velocity
}

export interface Plan {
  /** The time its state is taken at (ms: the page's frame clock). */
  t0: number;
  /** How long it covers (s). */
  seconds: number;
  /** What it assumed. */
  progress: number;
  finishing: boolean;
  x0: number;
  xEnd: number;
  /** `r, u, g, y, x, v` at every step: 6 numbers a step, step `i` being at `i * DT`. */
  states: Float64Array;
}

const rest: State = { r: 0, u: 0, g: 0, y: 0, x: 0, v: 0 };

export class Film {
  readonly o: FilmOptions;
  private cur: Plan | null = null;

  constructor(options: Partial<FilmOptions> = {}) {
    this.o = { ...FILM_DEFAULTS, ...options };
    if (Math.abs(this.o.lag - this.o.omega) < 1e-6) throw new Error("motion: lag must differ from omega");
  }

  /** The plan that is playing. */
  get current(): Plan | null {
    return this.cur;
  }

  /** The system advanced by `dt` seconds (any size), progress and the finishing flag being as given. */
  private step(s: State, dt: number, progress: number, finishing: boolean): State {
    const { cruise, headroom, finishSpeed, speedRate, gateRate, omega, lag } = this.o;
    const gateTarget = finishing ? 1 : Math.min(1, progress + headroom);
    const g = finishing ? 1 : s.g + (gateTarget - s.g) * (1 - Math.exp(-gateRate * dt));
    const speed = finishing ? finishSpeed : cruise;
    let u = 0;
    let r: number;
    if (Number.isFinite(speed)) {
      u = s.u + (speed - s.u) * (1 - Math.exp(-speedRate * dt)); // (its speed eases to the new value)
      r = Math.min(g, s.r + u * dt);
    } else {
      r = g; // (no pacing: it is the gate)
    }
    // the lag, its input taken as the runner's middle value over the step
    const rm = (s.r + r) / 2;
    const y = rm + (s.y - rm) * Math.exp(-lag * dt);
    // the critically damped spring towards `y`, exact for an input held over the step
    const ym = (s.y + y) / 2;
    const e = s.x - ym;
    const k = Math.exp(-omega * dt);
    const x = ym + (e + (s.v + omega * e) * dt) * k;
    const v = (s.v - omega * (s.v + omega * e) * dt) * k;
    return { r, u, g, y, x, v };
  }

  private stateAt(plan: Plan | null, now: number): State {
    if (!plan) return rest;
    const t = Math.min(Math.max((now - plan.t0) / 1000, 0), plan.seconds);
    const last = plan.states.length / 6 - 1;
    const i = Math.min(Math.floor(t / DT + 1e-9), last);
    const b = i * 6;
    const s = {
      r: plan.states[b],
      u: plan.states[b + 1],
      g: plan.states[b + 2],
      y: plan.states[b + 3],
      x: plan.states[b + 4],
      v: plan.states[b + 5],
    };
    const frac = t - i * DT;
    return frac > 1e-9 && i < last ? this.step(s, frac, plan.progress, plan.finishing) : s;
  }

  /** Where the film is at `now` (the frame clock, ms), and how fast (of the range per second). */
  at(now: number): { x: number; v: number } {
    const s = this.stateAt(this.cur, now);
    return { x: s.x, v: s.v };
  }

  /** Position, velocity and acceleration at `now` (for testing). */
  derivatives(now: number): { x: number; v: number; a: number } {
    const s = this.stateAt(this.cur, now);
    return { x: s.x, v: s.v, a: this.o.omega * this.o.omega * (s.y - s.x) - 2 * this.o.omega * s.v };
  }

  /** The plan that starts from the film's state at `now` and assumes this progress (not adopted). */
  make(now: number, progress: number, finishing: boolean): Plan {
    const s0 = this.stateAt(this.cur, now);
    const steps = Math.ceil(this.o.horizon / DT);
    const states = new Float64Array((steps + 1) * 6);
    let s = s0;
    const put = (i: number, st: State) => {
      const b = i * 6;
      states[b] = st.r;
      states[b + 1] = st.u;
      states[b + 2] = st.g;
      states[b + 3] = st.y;
      states[b + 4] = st.x;
      states[b + 5] = st.v;
    };
    put(0, s);
    for (let i = 1; i <= steps; i++) {
      s = this.step(s, DT, progress, finishing);
      put(i, s);
    }
    return { t0: now, seconds: steps * DT, progress, finishing, x0: s0.x, xEnd: s.x, states };
  }

  /** The position `t` seconds into a plan. */
  static positionAt(plan: Plan, t: number): number {
    const last = plan.states.length / 6 - 1;
    const p = Math.min(Math.max(t / DT, 0), last);
    const i = Math.min(Math.floor(p), last - 1);
    const a = plan.states[i * 6 + 4];
    const b = plan.states[(i + 1) * 6 + 4];
    return a + (b - a) * (p - i);
  }

  /**
   * Whether `next` (made at `now`) would be seen to differ from the plan that is playing: its position, over the time
   * both cover, is more than `tolerance` of the range (a couple of pixels) away from it anywhere.
   */
  differs(next: Plan, now: number, tolerance = 0.004): boolean {
    const cur = this.cur;
    if (!cur) return true;
    if (cur.finishing !== next.finishing) return true;
    const left = Math.min(cur.t0 + cur.seconds * 1000 - now, next.seconds * 1000) / 1000;
    for (let t = 0; t <= left; t += 0.02) {
      const a = Film.positionAt(cur, (now - cur.t0) / 1000 + t);
      const b = Film.positionAt(next, t);
      if (Math.abs(a - b) > tolerance) return true;
    }
    return false;
  }

  /** Takes a plan as the one that is playing. */
  adopt(plan: Plan) {
    this.cur = plan;
  }

  /** How long (ms) from `now` until the film is within `tolerance` of the end of its range (null if not within this plan). */
  untilArrived(now: number, tolerance: number): number | null {
    const cur = this.cur;
    if (!cur) return null;
    const t0 = Math.max(0, (now - cur.t0) / 1000);
    for (let t = t0; t <= cur.seconds; t += 0.004) {
      if (1 - Film.positionAt(cur, t) <= tolerance) return (t - t0) * 1000;
    }
    return null;
  }
}

/**
 * The plan as keyframes for a Web Animations `transform` animation with plain linear easing: `build(x)` makes the value
 * at position `x`, with a keyframe every 5 ms (a third of a frame). Positions are exact, so nothing relies on an easing
 * function being accelerated, and the straight pieces between keyframes are far below a pixel.
 */
export function keyframes(plan: Plan, build: (x: number) => string): { transform: string; offset: number }[] {
  const n = Math.round(plan.seconds / 0.005);
  const frames: { transform: string; offset: number }[] = [];
  let last = plan.x0;
  for (let i = 0; i <= n; i++) {
    const x = i === n ? plan.xEnd : Math.max(last, Film.positionAt(plan, (i / n) * plan.seconds)); // (monotone, against rounding)
    frames.push({ transform: build(x), offset: i / n });
    last = x;
  }
  return frames;
}

/**
 * Keyframes for something that takes one of a few discrete poses (a flip-book): `pose(x)` is which pose the position `x`
 * is at, and `build(pose)` the transform that shows it. Only the changes are keyframes, each held until the next
 * (`steps(1, end)`), so two poses are never shown blended, and the animation is one a compositor takes. Sampled every
 * 2 ms, so a change is placed to within that.
 */
export function steppedKeyframes(plan: Plan, pose: (x: number) => number, build: (pose: number) => string): Keyframe[] {
  const n = Math.round(plan.seconds / 0.002);
  const frames: Keyframe[] = [];
  let last = Number.NaN;
  for (let i = 0; i <= n; i++) {
    const p = pose(i === n ? plan.xEnd : Film.positionAt(plan, (i / n) * plan.seconds));
    if (p !== last) {
      frames.push({ transform: build(p), offset: i / n, easing: "steps(1, end)" });
      last = p;
    }
  }
  const end = frames[frames.length - 1];
  if ((end.offset as number) < 1) frames.push({ transform: end.transform, offset: 1 });
  return frames;
}
