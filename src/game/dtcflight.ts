// The movers of the DARPA Triage Challenge area (see dtc.ts): the drone that flies a survey of the crash site now and then, and
// the Spot robot that walks out to a casualty, checks it over and walks back. Like drive.ts and errand.ts, they only set the
// prop's x and z (and the heading, for the robot); the hover lift owns its height. What they do to the model, they do through
// `userData`: the drone is told how high it is (`setFlight`), the robot how it walks and scans (`pose`).
//
// Both leave a note in `dtcScan` of where their sensor is and whether it is on, which the casualties read: a casualty the drone
// or the robot has its sensor on is "seen", and its tag turns from grey to its triage colour (see dtcmodels.ts).
import type { Group } from "three";
import { lapCurve } from "./drive";
import type { AnimCtx } from "./models";
import type { MedicPlan } from "./scenes";

/** Where each sensor is (world px, z being the world's y) and whether it is scanning now. */
export const dtcScan = {
  drone: { on: false, x: 0, z: 0 },
  spot: { on: false, x: 0, z: 0 },
  /** What is known of each casualty, by where they lie (the casualties put themselves here; the medics read it). */
  casualties: new Map<string, CasualtyState>(),
};

/**
 * One casualty as the team sees them: `found` once the drone or the robot has had a sensor on them, `claimed` once a medic is on the way,
 * `helped` once a medic has treated them (at `helpedAt`, seconds). When the drone or the robot looks at them again, they are
 * due another visit.
 */
export interface CasualtyState {
  x: number;
  z: number;
  tag: string; // triage colour: g, y, r, k
  found: boolean;
  claimed: boolean;
  helped: boolean;
  helpedAt: number;
}



export const DRONE = {
  alt: 30, // how high it cruises (px)
  inspect: 15, // how low it drops to look at a casualty
  reach: 22, // the radius of the circle its camera sees on the ground while cruising (it narrows to 0.42 of that over a casualty)
  hit: 12, // a casualty this near (horizontally) is scanned, which only happens while it is down over them
};
export const SPOT = { hit: 16 };

/** What the drone model is told each frame (`userData.setFlight`). */
export interface FlightPose {
  alt: number; // height above its pad, px
  lift: number; // 0 on the pad .. 1 up (climbing out, settling back)
  focus: number; // 0 cruising .. 1 down over a casualty, camera narrowed onto them
  power: number; // 0 rotors still .. 1 flying
  dt: number;
  t: number;
}

/** What the robot model is told each frame (`userData.pose`). */
export interface SpotPose {
  phase: number; // radians through the stride
  swing: number; // 0 standing .. 1 walking
  scan: number; // 0 .. 1, how far the sensor mast is up and sweeping
  t: number;
}

const SPEED = 28; // px/s between casualties
const LIFT = 1.5; // seconds to climb out and to settle back
const FIRST = [2, 3]; // seconds after the scene starts to the first flight
const GAP = [3, 5]; // seconds from landing to the next take-off (a battery swap)

const WALK = 15; // px/s
const STRIDE = 8.5; // rad/s of the stride at full swing
const FIRST_WALK = [6, 9];
const GAP_WALK = [14, 22];
const SCAN = 3.4; // seconds spent over the casualty
const TURN = 0.8; // turning round at the casualty, and again at home

/** What the medic model is told each frame (`userData.pose`). */
export interface MedicPose {
  phase: number; // radians through the stride
  swing: number; // 0 standing .. 1 walking
  kneel: number; // 0 standing .. 1 down beside the casualty, working
  t: number;
}

const RUN = 24; // px/s a medic goes at
const REACT = 1.0; // seconds from a casualty being found to the medic setting off
const TREAT = 4.6; // seconds spent kneeling by them
const KNEEL = 0.5; // seconds to get down, and up again
const RANK: Record<string, number> = { r: 0, y: 1, g: 2 }; // who is seen to first: red, then yellow, then green (black is not visited)

const between = ([a, b]: number[]) => a + Math.random() * (b - a);
const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Makes `model` (a drone with `userData.setFlight`) take off from where it stands, fly the survey along `path` (world px; the first and
 * last points are its pad) and land again, over and over. A point with a `hold` is a casualty: the drone slows into it, drops down,
 * narrows its camera onto them and circles a little above them for that many seconds, then climbs and goes on to the next. It does not
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
      setFlight({ alt: 0, power: 0, lift: 0, focus: 0, dt: 0, t: 0 }); // reduced motion: parked
      return;
    }
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (next < 0) next = t + between(FIRST);
    if (start < 0) {
      if (t < next) {
        setFlight({ alt: 0, power: 0, lift: 0, focus: 0, dt, t });
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
      setFlight({ alt: 0, power: 0, lift: 0, focus: 0, dt, t });
      dtcScan.drone.on = false;
      return;
    }
    const lift = Math.min(smooth(e / LIFT), smooth((flightTime - e) / LIFT));
    // where it is along the survey, and how closely it is looking: 0 cruising .. 1 down over a casualty
    let at = 0;
    let focus = 0;
    for (const part of plan) {
      if (e < part.t0) break;
      if (part.kind === "hold") {
        at = part.s;
        focus = 1;
        if (e < part.t1) break;
      } else {
        const u = Math.min(1, (e - part.t0) / (part.t1 - part.t0));
        at = part.s0 + (part.s1 - part.s0) * smooth(u);
        focus = Math.max(part.fromStop ? 1 - smooth(u / 0.3) : 0, part.toStop ? smooth((u - 0.7) / 0.3) : 0);
        if (e < part.t1) break;
      }
    }
    const p = curve.getPointAt(Math.min(1, Math.max(0, at / total)));
    const swirl = 2.6 * focus; // a slow circle over the casualty, to look at them from all sides
    model.position.x = p.x + Math.cos(t * 1.4) * swirl;
    model.position.z = p.z + Math.sin(t * 1.4) * swirl;
    setFlight({ alt: lift * (DRONE.alt + (DRONE.inspect - DRONE.alt) * focus), power: Math.min(1, e / 0.6, (flightTime - e) / 0.3 + 0.2), lift, focus, dt, t });
    dtcScan.drone.on = focus > 0.8;
    dtcScan.drone.x = p.x;
    dtcScan.drone.z = p.z;
  };
}

/**
 * Makes `model` (a robot with `userData.pose`) walk `route` (world px; the first point is where it is parked, facing along the
 * way out; the last is where it stops, with the casualty straight ahead), scan, turn round, walk back and turn to its parked
 * heading again, every so often.
 */
export function attachPatrol(model: Group, route: { x: number; y: number }[]) {
  const curve = lapCurve(route);
  const L = curve.getLength();
  const walk = L / WALK;
  const total = walk + SCAN + TURN + walk + TURN;
  const pose = model.userData.pose as (p: SpotPose) => void;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };
  const at = (s: number) => curve.getPointAt(Math.min(1, Math.max(0, s / L)));
  const out = (s: number) => {
    const d = curve.getTangentAt(Math.min(1, Math.max(0, s / L)));
    return Math.atan2(d.z, d.x);
  };
  const headOut = out(0);
  const headStop = out(L);

  let start = -1;
  let next = -1;
  let last = -1;
  let phase = 0;

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: parked
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (next < 0) next = t + between(FIRST_WALK);
    if (start < 0) {
      if (t < next) return;
      start = t;
    }
    const e = t - start;
    if (e >= total) {
      start = -1;
      next = t + between(GAP_WALK);
      model.position.x = home.x;
      model.position.z = home.z;
      model.rotation.y = home.ry;
      pose({ phase, swing: 0, scan: 0, t });
      dtcScan.spot.on = false;
      return;
    }

    let s: number; // distance along the route
    let heading: number;
    let swing = 1;
    let scan = 0;
    let scanning = false;
    if (e < walk) {
      s = (e / walk) * L;
      heading = out(s);
    } else if (e < walk + SCAN) {
      s = L;
      heading = headStop;
      swing = 0;
      const k = e - walk;
      scan = Math.min(smooth(k / 0.6), smooth((SCAN - k) / 0.6));
      scanning = k > 0.5;
    } else if (e < walk + SCAN + TURN) {
      s = L;
      const k = smooth((e - walk - SCAN) / TURN);
      heading = headStop + Math.PI * k;
      swing = 0.5;
    } else if (e < walk + SCAN + TURN + walk) {
      const k = (e - walk - SCAN - TURN) / walk;
      s = L - k * L;
      heading = out(s) + Math.PI;
    } else {
      s = 0;
      const k = smooth((e - total + TURN) / TURN);
      const back = headOut + Math.PI;
      heading = back + wrap(-home.ry - back) * k;
      swing = 0.5;
    }
    const p = at(s);
    phase += dt * STRIDE * swing;
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -heading;
    pose({ phase, swing, scan, t });
    dtcScan.spot.on = scanning;
    dtcScan.spot.x = p.x;
    dtcScan.spot.z = p.z;
  };
}

type Pt = { x: number; y: number };

const mix = (a: number, b: number, k: number) => a + wrap(b - a) * k;

/**
 * Makes `model` (a medic with `userData.pose`), parked at its post (`plan.home`), answer the drone and the robot: when a casualty has
 * been found and nobody is on the way (the most urgent first, then the nearest to where the medic is), it walks there along the site's
 * paths (`plan.nodes` and `plan.edges`, the shortest way), kneels and treats them. Then, if another casualty is waiting, it goes straight
 * on to them from where it kneels; only when nobody is waiting does it walk back to its post and turn to face the way it did. A medic on
 * its way home turns back if somebody is found. Casualties that none of the `plan.calls` reach are left alone.
 */
export function attachMedic(model: Group, plan: MedicPlan) {
  const pose = model.userData.pose as (p: MedicPose) => void;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };
  const homeHeading = -home.ry;
  const calls = plan.calls;

  // the paths: shortest way between two nodes (Dijkstra; there are few of them)
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

  interface Leg {
    curve: ReturnType<typeof lapCurve>;
    L: number;
    start: number;
    delay: number; // seconds standing before it sets off
    headStart: number; // the heading it begins with, which it turns from onto the way
    toHome: boolean;
  }
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
    const way = shortest(nearest(at), to).map((id) => plan.nodes[id]);
    const points = way.length && Math.hypot(way[0].x - at.x, way[0].y - at.y) > 1 ? [{ x: at.x, y: at.y }, ...way] : way.slice();
    if (points.length < 2) points.push({ x: points[0].x + 0.01, y: points[0].y });
    const curve = lapCurve(points);
    leg = { curve, L: curve.getLength(), start: t, delay, headStart: heading, toHome };
    mode = "walk";
  };

  /** The casualty to go to: found, nobody on the way, not yet treated, and one of ours; the most urgent, then the nearest. */
  const pick = () => {
    let best: { ci: number; st: CasualtyState; score: number } | null = null;
    for (const st of dtcScan.casualties.values()) {
      if (!st.found || st.claimed || st.helped || !(st.tag in RANK)) continue;
      const ci = calls.findIndex((c) => Math.hypot(c.at.x - st.x, c.at.y - st.z) < 4);
      if (ci < 0) continue;
      const score = RANK[st.tag] * 1000 + Math.hypot(st.x - at.x, st.z - at.y);
      if (!best || score < best.score) best = { ci, st, score };
    }
    return best;
  };
  const dispatch = (t: number, next: { ci: number; st: CasualtyState }, delay: number) => {
    next.st.claimed = true;
    job = { st: next.st, face: calls[next.ci].face };
    startLeg(t, calls[next.ci].node, false, delay);
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
        const next = pick(); // somebody was found on the way home: turn back
        if (next) dispatch(t, next, 0.2);
      }
      const l = leg!;
      const e = t - l.start - l.delay;
      const s = Math.min(l.L, Math.max(0, e) * RUN);
      const u = Math.min(1, Math.max(0, s / l.L));
      const v = l.curve.getTangentAt(u);
      heading = mix(l.headStart, Math.atan2(v.z, v.x), smooth(e / 0.35));
      const q = l.curve.getPointAt(u);
      at = { x: q.x, y: q.z };
      swing = e > 0 ? 1 : 0;
      if (e > 0 && s >= l.L) {
        if (l.toHome) {
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
