// The movers of the DARPA Triage Challenge area (see dtc.ts), who work as a team on the casualties:
//
//   1. the drone flies a survey over the site, stopping over each casualty it comes to: they are FOUND (their vest takes the triage colour);
//   2. the Spot robot goes to whoever has been found and not yet checked, walks up to them and scans them close up: they are CONFIRMED
//      (a ping appears on the ground round them: a medic is needed here), and it moves on to the next one at once;
//   3. a medic goes to whoever has been confirmed, kneels and treats them: they are HELPED, and the medic goes on to the next one.
//
// So each works one step behind the one before, all at the same time, and each hands the casualty on to the next. When the drone comes
// round again to someone already helped, the round starts over for them. The robots and medics walk the site's paths (a map of nodes and
// edges, `MedicPlan`), the shortest way between where they are and where they are going.
//
// Like drive.ts and errand.ts, they only set the prop's x and z (and the heading for the walkers); the hover lift owns its height. What
// they do to the model, they do through `userData`: the drone is told how high it is (`setFlight`), the robot how it walks and scans
// (`pose`), the medic how it walks and kneels (`pose`).
//
// They leave a note in `dtcScan` of where each sensor is and whether it is on, which the casualties read to flash their brackets.
import type { Group } from "three";
import { lapCurve } from "./drive";
import type { AnimCtx } from "./models";
import type { MedicPlan } from "./scenes";

/** Where each sensor is (world px, z being the world's y) and whether it is scanning now. */
export const dtcScan = {
  drone: { on: false, x: 0, z: 0 },
  spot: { on: false, x: 0, z: 0 },
  /** What is known of each casualty, by where they lie (the casualties put themselves here; the robot and the medics read it). */
  casualties: new Map<string, CasualtyState>(),
};

/**
 * One casualty as the team sees them: `found` once the drone has had a sensor on them, `scouted` once the robot is on the way, `confirmed`
 * once it has checked them close up, `claimed` once a medic is on the way, `helped` once a medic has treated them (at `helpedAt`, seconds).
 * When the drone comes to look at them again after that, the round starts over for them.
 */
export interface CasualtyState {
  x: number;
  z: number;
  tag: string; // triage colour: g, y, r, k
  found: boolean;
  scouted: boolean;
  confirmed: boolean;
  claimed: boolean;
  helped: boolean;
  helpedAt: number;
}

export const DRONE = {
  alt: 30, // how high it flies (px), cruising and looking at a casualty alike
  hit: 12, // a casualty this near (horizontally) is scanned, which only happens while it is down over them
};
export const SPOT = { hit: 16 };

/** What the drone model is told each frame (`userData.setFlight`). */
export interface FlightPose {
  alt: number; // height above its pad, px
  lift: number; // 0 on the pad .. 1 up (climbing out, settling back)
  focus: number; // 0 cruising .. 1 down over a casualty, its camera locked on them
  aim: { dx: number; dz: number }; // from the drone to the point on the ground it is looking at (world px)
  power: number; // 0 rotors still .. 1 flying
  dt: number;
  t: number;
}

const NO_AIM = { dx: 0, dz: 0 };

/** What the robot model is told each frame (`userData.pose`). */
export interface SpotPose {
  phase: number; // radians through the stride
  swing: number; // 0 standing .. 1 walking
  scan: number; // 0 .. 1, how far the sensor mast is up and sweeping
  t: number;
}

/** What the medic model is told each frame (`userData.pose`). */
export interface MedicPose {
  phase: number; // radians through the stride
  swing: number; // 0 standing .. 1 walking
  kneel: number; // 0 standing .. 1 down beside the casualty, working
  t: number;
}

// the drone
const SPEED = 28; // px/s between casualties
const LIFT = 1.5; // seconds to climb out and to settle back
const FIRST = [2, 3]; // seconds after the scene starts to the first flight
const GAP = [3, 5]; // seconds from landing to the next take-off (a battery swap)

// the robot: quick on its feet, and always on its way to the next casualty
const SCOUT_RUN = 27; // px/s
const SCOUT_STRIDE = 15; // rad/s of its stride at full swing
const SCOUT_REACT = 0.4; // seconds from a casualty being found to the robot setting off
const SCAN = 2.8; // seconds it spends scanning one casualty
const CONFIRM_AT = 0.55; // the casualty is confirmed this far (as a fraction) into the scan

// the medics
const RUN = 24; // px/s a medic goes at
const STRIDE = 8.5; // rad/s of a medic's stride at full swing
const REACT = 1.0; // seconds from a casualty being confirmed to the medic setting off
const TREAT = 4.6; // seconds spent kneeling by them
const KNEEL = 0.5; // seconds to get down, and up again

/** Who is seen to first: red, then yellow, then green (and black last, by the robot only: a medic does not go to them). */
const RANK: Record<string, number> = { r: 0, y: 1, g: 2, k: 3 };

const between = ([a, b]: number[]) => a + Math.random() * (b - a);
const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Makes `model` (a drone with `userData.setFlight`) take off from where it stands, fly the survey along `path` (world px; the first and
 * last points are its pad) and land again, over and over. A point with a `hold` is a casualty: the drone slows into it, locks its
 * camera onto them and circles a little above them for that many seconds, then goes on to the next. It does not
 * turn: a quadcopter flies sideways.
 */
export function attachFlight(model: Group, path: { x: number; y: number; hold?: number }[]) {
  const curve = lapCurve(path);
  const lengths = curve.getLengths(); // cumulative arc length at t = k / divisions
  const divisions = lengths.length - 1;
  const total = lengths[divisions];
  const setFlight = model.userData.setFlight as (p: FlightPose) => void;
  const home = { x: model.position.x, z: model.position.z };

  // the schedule: a leg to each stop, a hold at it, and a last leg home, between a climb and a landing
  type Leg = { kind: "leg"; t0: number; t1: number; s0: number; s1: number; fromStop: boolean; toStop: boolean };
  type Hold = { kind: "hold"; t0: number; t1: number; s: number };
  const plan: (Leg | Hold)[] = [];
  let clock = LIFT;
  let s = 0;
  let fromStop = false;
  const leg = (to: number, toStop: boolean) => {
    const dur = Math.max(0.8, ((to - s) / SPEED) * 1.3); // (it eases out of and into each stop, so the average is below the top speed)
    plan.push({ kind: "leg", t0: clock, t1: clock + dur, s0: s, s1: to, fromStop, toStop });
    clock += dur;
    s = to;
  };
  path.forEach((p, i) => {
    if (!p.hold) return;
    leg(lengths[Math.round((i / (path.length - 1)) * divisions)], true);
    plan.push({ kind: "hold", t0: clock, t1: clock + p.hold, s });
    clock += p.hold;
    fromStop = true;
  });
  leg(total, false);
  const flightTime = clock + LIFT;

  let start = -1;
  let next = -1;
  let last = -1;

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) {
      setFlight({ alt: 0, power: 0, lift: 0, focus: 0, dt: 0, t: 0, aim: NO_AIM }); // reduced motion: parked
      return;
    }
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (next < 0) next = t + between(FIRST);
    if (start < 0) {
      if (t < next) {
        setFlight({ alt: 0, power: 0, lift: 0, focus: 0, dt, t, aim: NO_AIM });
        dtcScan.drone.on = false;
        return;
      }
      start = t;
    }
    const e = t - start;
    if (e >= flightTime) {
      start = -1;
      next = t + between(GAP);
      model.position.x = home.x;
      model.position.z = home.z;
      setFlight({ alt: 0, power: 0, lift: 0, focus: 0, dt, t, aim: NO_AIM });
      dtcScan.drone.on = false;
      return;
    }
    const lift = Math.min(smooth(e / LIFT), smooth((flightTime - e) / LIFT));
    // where it is along the survey, and how closely it is looking: 0 cruising .. 1 down over a casualty
    let at = 0;
    let focus = 0;
    let looking = -1; // the distance along the survey of the casualty it looks at
    for (const part of plan) {
      if (e < part.t0) break;
      if (part.kind === "hold") {
        at = part.s;
        focus = 1;
        looking = part.s;
        if (e < part.t1) break;
      } else {
        const u = Math.min(1, (e - part.t0) / (part.t1 - part.t0));
        at = part.s0 + (part.s1 - part.s0) * smooth(u);
        focus = Math.max(part.fromStop ? 1 - smooth(u / 0.3) : 0, part.toStop ? smooth((u - 0.7) / 0.3) : 0);
        looking = part.toStop && (!part.fromStop || u >= 0.5) ? part.s1 : part.fromStop ? part.s0 : -1;
        if (e < part.t1) break;
      }
    }
    const p = curve.getPointAt(Math.min(1, Math.max(0, at / total)));
    const swirl = 2.6 * focus; // a slow circle over the casualty, to look at them from all sides
    model.position.x = p.x + Math.cos(t * 1.4) * swirl;
    model.position.z = p.z + Math.sin(t * 1.4) * swirl;
    const q = looking >= 0 ? curve.getPointAt(Math.min(1, looking / total)) : p;
    setFlight({
      alt: lift * DRONE.alt, // it stays up while it looks
      power: Math.min(1, e / 0.6, (flightTime - e) / 0.3 + 0.2),
      lift,
      focus,
      dt,
      t,
      aim: { dx: q.x - model.position.x, dz: q.z - model.position.z },
    });
    dtcScan.drone.on = focus > 0.8;
    dtcScan.drone.x = p.x;
    dtcScan.drone.z = p.z;
  };
}

type Pt = { x: number; y: number };

const mix = (a: number, b: number, k: number) => a + wrap(b - a) * k;

/** The site's paths as something to walk: the curve of the shortest way from a point to a node (Dijkstra; there are few of them). */
function navigator(plan: MedicPlan) {
  const ids = Object.keys(plan.nodes);
  const adjacent = new Map<string, { to: string; w: number }[]>(ids.map((id) => [id, []]));
  for (const [a, b] of plan.edges) {
    const w = Math.hypot(plan.nodes[a].x - plan.nodes[b].x, plan.nodes[a].y - plan.nodes[b].y);
    adjacent.get(a)!.push({ to: b, w });
    adjacent.get(b)!.push({ to: a, w });
  }
  const gap = (p: Pt, id: string) => Math.hypot(plan.nodes[id].x - p.x, plan.nodes[id].y - p.y);
  const nearest = (p: Pt) => ids.reduce((best, id) => (gap(p, id) < gap(p, best) ? id : best), ids[0]);
  const shortest = (from: string, to: string): string[] => {
    const dist = new Map(ids.map((id) => [id, Infinity]));
    const prev = new Map<string, string>();
    const todo = new Set(ids);
    dist.set(from, 0);
    while (todo.size) {
      let u: string | null = null;
      for (const id of todo) if (u === null || dist.get(id)! < dist.get(u)!) u = id;
      if (u === null || dist.get(u) === Infinity) break;
      todo.delete(u);
      if (u === to) break;
      for (const { to: v, w } of adjacent.get(u)!) {
        const d = dist.get(u)! + w;
        if (d < dist.get(v)!) {
          dist.set(v, d);
          prev.set(v, u);
        }
      }
    }
    const way = [to];
    while (way[0] !== from) {
      const before = prev.get(way[0]);
      if (!before) break;
      way.unshift(before);
    }
    return way;
  };
  return (from: Pt, to: string) => {
    const way = shortest(nearest(from), to).map((id) => plan.nodes[id]);
    const points = way.length && Math.hypot(way[0].x - from.x, way[0].y - from.y) > 1 ? [{ x: from.x, y: from.y }, ...way] : way.slice();
    if (points.length < 2) points.push({ x: points[0].x + 0.01, y: points[0].y });
    const curve = lapCurve(points);
    return { curve, L: curve.getLength() };
  };
}

/** A walk along a curve: when it began, how long it stands first, the heading it turns from onto the way, and whether it is the walk home. */
interface Leg {
  curve: ReturnType<typeof lapCurve>;
  L: number;
  start: number;
  delay: number;
  headStart: number;
  toHome: boolean;
}

/** Where a walker is on its leg at time `t` going `speed` px/s, the way it faces, whether it is walking and whether it has got there. */
function walkLeg(l: Leg, t: number, speed: number) {
  const e = t - l.start - l.delay;
  const s = Math.min(l.L, Math.max(0, e) * speed);
  const u = Math.min(1, Math.max(0, s / l.L));
  const v = l.curve.getTangentAt(u);
  const q = l.curve.getPointAt(u);
  return {
    at: { x: q.x, y: q.z } as Pt,
    heading: mix(l.headStart, Math.atan2(v.z, v.x), smooth(e / 0.35)),
    walking: e > 0,
    arrived: e > 0 && s >= l.L,
  };
}

/** The plan's call for a casualty at (x, z), or -1. */
const callFor = (plan: MedicPlan, x: number, z: number) => plan.calls.findIndex((c) => Math.hypot(c.at.x - x, c.at.y - z) < 4);

/**
 * Makes `model` (the robot, with `userData.pose`), parked at its post (`plan.home`), the team's scout: when the drone has found a casualty
 * and the robot has not yet been to them (red first, then yellow, then green, then the nearest to where it is), it walks to the spot the plan
 * gives it beside them, scans them close up and so CONFIRMS them (which is what sends a medic), and at once goes on to the next. Only when
 * nobody is waiting does it walk back to its post and turn to face the way it did; if somebody is found on the way back, it turns round.
 */
export function attachScout(model: Group, plan: MedicPlan) {
  const pose = model.userData.pose as (p: SpotPose) => void;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };
  const homeHeading = -home.ry;
  const route = navigator(plan);

  let mode: "idle" | "walk" | "scan" | "settle" = "idle";
  let at: Pt = { x: home.x, y: home.z };
  let heading = homeHeading;
  let leg: Leg | null = null;
  let job: { st: CasualtyState; face: number } | null = null;
  let scanStart = 0;
  let scanFrom = 0;
  let marked = false;
  let settleStart = 0;
  let settleFrom = 0;
  let phase = 0;
  let last = -1;

  const startLeg = (t: number, to: string, toHome: boolean, delay: number) => {
    leg = { ...route(at, to), start: t, delay, headStart: heading, toHome };
    mode = "walk";
  };
  const pick = () => {
    let best: { ci: number; st: CasualtyState; score: number } | null = null;
    for (const st of dtcScan.casualties.values()) {
      if (!st.found || st.scouted || st.confirmed) continue;
      const ci = callFor(plan, st.x, st.z);
      if (ci < 0 || !plan.calls[ci].spot) continue;
      const score = (RANK[st.tag] ?? 3) * 1000 + Math.hypot(st.x - at.x, st.z - at.y);
      if (!best || score < best.score) best = { ci, st, score };
    }
    return best;
  };
  const dispatch = (t: number, next: { ci: number; st: CasualtyState }, delay: number) => {
    next.st.scouted = true;
    const spot = plan.calls[next.ci].spot!;
    job = { st: next.st, face: spot.face };
    startLeg(t, spot.node, false, delay);
  };

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: the robot waits at its post
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    let swing = 0;
    let scan = 0;

    if (mode === "idle") {
      const next = pick();
      if (next) dispatch(t, next, SCOUT_REACT);
      return;
    }
    if (mode === "walk") {
      if (leg!.toHome) {
        const next = pick(); // somebody was found on the way home: turn back
        if (next) dispatch(t, next, 0.1);
      }
      const w = walkLeg(leg!, t, SCOUT_RUN);
      at = w.at;
      heading = w.heading;
      swing = w.walking ? 1 : 0;
      if (w.arrived) {
        if (leg!.toHome) {
          mode = "settle";
          settleStart = t;
          settleFrom = heading;
        } else {
          mode = "scan";
          scanStart = t;
          scanFrom = heading;
          marked = false;
        }
      }
    } else if (mode === "scan") {
      const k = t - scanStart;
      heading = mix(scanFrom, job!.face, smooth(k / 0.35));
      scan = Math.min(smooth(k / 0.5), smooth((SCAN - k) / 0.5));
      dtcScan.spot.on = k > 0.35 && k < SCAN - 0.3;
      dtcScan.spot.x = at.x;
      dtcScan.spot.z = at.y;
      if (!marked && k > SCAN * CONFIRM_AT) {
        marked = true;
        job!.st.confirmed = true; // the medics' cue
      }
      if (k >= SCAN) {
        dtcScan.spot.on = false;
        const next = pick();
        if (next) dispatch(t, next, 0); // straight on to the next one
        else startLeg(t, plan.home, true, 0.2);
      }
    } else {
      const k = (t - settleStart) / 0.6;
      heading = mix(settleFrom, homeHeading, smooth(k));
      swing = 0.4 * (1 - smooth(k));
      if (k >= 1) {
        mode = "idle";
        at = { x: home.x, y: home.z };
        heading = homeHeading;
        swing = 0;
      }
    }
    phase += dt * SCOUT_STRIDE * swing;
    model.position.x = at.x;
    model.position.z = at.y;
    model.rotation.y = -heading;
    pose({ phase, swing, scan, t });
  };
}

/**
 * Makes `model` (a medic with `userData.pose`), parked at its post (`plan.home`), the team's last step: when the robot has confirmed a
 * casualty and nobody is on the way (the most urgent first, then the nearest to where the medic is), it walks there, kneels and treats them.
 * Then, if another casualty is waiting, it goes straight on to them from where it kneels; only when nobody is waiting does it walk back to
 * its post and turn to face the way it did. A medic on its way home turns back if somebody is confirmed. A casualty that none of the
 * `plan.calls` reach, or that is black, is left alone.
 */
export function attachMedic(model: Group, plan: MedicPlan) {
  const pose = model.userData.pose as (p: MedicPose) => void;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };
  const homeHeading = -home.ry;
  const route = navigator(plan);

  let mode: "idle" | "walk" | "treat" | "settle" = "idle";
  let at: Pt = { x: home.x, y: home.z };
  let heading = homeHeading;
  let leg: Leg | null = null;
  let job: { st: CasualtyState; face: number } | null = null;
  let treatStart = 0;
  let treatFrom = 0;
  let marked = false;
  let settleStart = 0;
  let settleFrom = 0;
  let phase = 0;
  let last = -1;

  const startLeg = (t: number, to: string, toHome: boolean, delay: number) => {
    leg = { ...route(at, to), start: t, delay, headStart: heading, toHome };
    mode = "walk";
  };
  /** The casualty to go to: confirmed, nobody on the way, not yet treated, and one of ours; the most urgent, then the nearest. */
  const pick = () => {
    let best: { ci: number; st: CasualtyState; score: number } | null = null;
    for (const st of dtcScan.casualties.values()) {
      if (!st.found || !st.confirmed || st.claimed || st.helped || st.tag === "k") continue;
      const ci = callFor(plan, st.x, st.z);
      if (ci < 0) continue;
      const score = (RANK[st.tag] ?? 3) * 1000 + Math.hypot(st.x - at.x, st.z - at.y);
      if (!best || score < best.score) best = { ci, st, score };
    }
    return best;
  };
  const dispatch = (t: number, next: { ci: number; st: CasualtyState }, delay: number) => {
    next.st.claimed = true;
    job = { st: next.st, face: plan.calls[next.ci].face };
    startLeg(t, plan.calls[next.ci].node, false, delay);
  };

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: the medics wait at their post
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    let swing = 0;
    let kneel = 0;

    if (mode === "idle") {
      const next = pick();
      if (next) dispatch(t, next, REACT);
      return;
    }
    if (mode === "walk") {
      if (leg!.toHome) {
        const next = pick(); // somebody was confirmed on the way home: turn back
        if (next) dispatch(t, next, 0.2);
      }
      const w = walkLeg(leg!, t, RUN);
      at = w.at;
      heading = w.heading;
      swing = w.walking ? 1 : 0;
      if (w.arrived) {
        if (leg!.toHome) {
          mode = "settle";
          settleStart = t;
          settleFrom = heading;
        } else {
          mode = "treat";
          treatStart = t;
          treatFrom = heading;
          marked = false;
        }
      }
    } else if (mode === "treat") {
      const k = t - treatStart;
      heading = mix(treatFrom, job!.face, smooth(k / 0.4));
      kneel = Math.min(smooth(k / KNEEL), smooth((TREAT - k) / KNEEL));
      if (!marked && k > TREAT - KNEEL) {
        marked = true;
        job!.st.helped = true;
        job!.st.helpedAt = t;
      }
      if (k >= TREAT) {
        const next = pick();
        if (next) dispatch(t, next, 0.3); // straight on to the next one
        else startLeg(t, plan.home, true, 0.3);
      }
    } else {
      const k = (t - settleStart) / 0.6;
      heading = mix(settleFrom, homeHeading, smooth(k));
      swing = 0.4 * (1 - smooth(k));
      if (k >= 1) {
        mode = "idle";
        at = { x: home.x, y: home.z };
        heading = homeHeading;
        swing = 0;
      }
    }
    phase += dt * STRIDE * swing * 1.2;
    model.position.x = at.x;
    model.position.z = at.y;
    model.rotation.y = -heading;
    pose({ phase, swing, kneel, t });
  };
}
