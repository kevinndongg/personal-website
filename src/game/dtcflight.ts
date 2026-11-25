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

/** Where each sensor is (world px, z being the world's y) and whether it is scanning now. */
export const dtcScan = {
  drone: { on: false, x: 0, z: 0 },
  spot: { on: false, x: 0, z: 0 },
  /** What is known of each casualty, by where they lie (the casualties put themselves here; the medics read it). */
  casualties: new Map<string, CasualtyState>(),
};

/**
 * One casualty as the team sees them: `found` once the drone or the robot has had a sensor on them, `claimed` once a medic is on the way,
 * `helped` once a medic has treated them (at `helpedAt`, seconds). A while after that they are unfound again, for the next round.
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

/** Seconds a treated casualty stays tagged before the scene starts over for them. */
export const HELPED_FOR = 16;

export const DRONE = {
  alt: 34, // how high it flies (px)
  reach: 22, // the radius of the circle its camera sees on the ground
  hit: 21, // a casualty this near (horizontally) is scanned
};
export const SPOT = { hit: 16 };

/** What the drone model is told each frame (`userData.setFlight`). */
export interface FlightPose {
  alt: number; // height above its pad, px
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

const SPEED = 38; // px/s along the survey
const LIFT = 1.5; // seconds to climb out and to settle back
const FIRST = [3, 5]; // seconds after the scene starts to the first flight
const GAP = [6, 9]; // seconds from landing to the next take-off

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
 * Makes `model` (a drone with `userData.setFlight`) take off from where it stands, fly the survey along `path` (world px; the
 * first and last points are its pad) and land again, every so often. It does not turn: a quadcopter flies sideways.
 */
export function attachFlight(model: Group, path: { x: number; y: number }[]) {
  const curve = lapCurve(path);
  const cruise = curve.getLength() / SPEED;
  const total = LIFT + cruise + LIFT;
  const home = { x: model.position.x, z: model.position.z };
  const setFlight = model.userData.setFlight as (p: FlightPose) => void;

  let start = -1;
  let next = -1;
  let last = -1;

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) {
      setFlight({ alt: 0, power: 0, dt: 0, t: 0 }); // reduced motion: parked
      return;
    }
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (next < 0) next = t + between(FIRST);
    if (start < 0) {
      if (t < next) {
        setFlight({ alt: 0, power: 0, dt, t });
        dtcScan.drone.on = false;
        return;
      }
      start = t;
    }
    const e = t - start;
    if (e >= total) {
      start = -1;
      next = t + between(GAP);
      model.position.x = home.x;
      model.position.z = home.z;
      setFlight({ alt: 0, power: 0, dt, t });
      dtcScan.drone.on = false;
      return;
    }
    const up = smooth(e / LIFT);
    const down = smooth((total - e) / LIFT);
    const lift = Math.min(up, down);
    const u = smooth((e - LIFT) / cruise);
    const p = curve.getPointAt(Math.min(1, Math.max(0, u)));
    model.position.x = p.x;
    model.position.z = p.z;
    setFlight({ alt: DRONE.alt * lift, power: Math.min(1, e / 0.6, (total - e) / 0.3 + 0.2), dt, t });
    dtcScan.drone.on = lift > 0.7;
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

/** One place a medic can be sent: where the casualty lies, the way there from the medics' post (world px; the last point is where the medic kneels) and the heading to kneel facing. */
export interface MedicCall {
  at: { x: number; y: number };
  route: { x: number; y: number }[];
  face: number;
}

const mix = (a: number, b: number, k: number) => a + wrap(b - a) * k;

/**
 * Makes `model` (a medic with `userData.pose`), parked at its post, answer the drone and the robot: when a casualty has been found and
 * nobody is on the way (the most urgent first, then the nearest), it sets off along the route to them, kneels and treats them, then goes
 * back to its post and turns to face the way it did. Casualties reached by none of the `calls` are left alone.
 */
export function attachMedic(model: Group, calls: MedicCall[]) {
  const pose = model.userData.pose as (p: MedicPose) => void;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };
  const curves = calls.map((c) => lapCurve([{ x: home.x, y: home.z }, ...c.route]));
  const lengths = curves.map((c) => c.getLength());
  const homeHeading = -home.ry;

  let job: { i: number; st: CasualtyState; start: number; marked: boolean } | null = null;
  let phase = 0;
  let last = -1;

  const pick = () => {
    let best: { i: number; st: CasualtyState; score: number } | null = null;
    for (const st of dtcScan.casualties.values()) {
      if (!st.found || st.claimed || st.helped || !(st.tag in RANK)) continue;
      const i = calls.findIndex((c) => Math.hypot(c.at.x - st.x, c.at.y - st.z) < 4);
      if (i < 0) continue;
      const score = RANK[st.tag] * 1000 + Math.hypot(st.x - home.x, st.z - home.z);
      if (!best || score < best.score) best = { i, st, score };
    }
    return best;
  };

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: the medics wait at their post
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (!job) {
      const next = pick();
      if (next) {
        next.st.claimed = true;
        job = { i: next.i, st: next.st, start: t, marked: false };
      }
      return;
    }
    const e = t - job.start;
    const curve = curves[job.i];
    const L = lengths[job.i];
    const walk = L / RUN;
    const a = REACT;
    const b = a + walk;
    const c = b + TREAT;
    const d = c + walk;
    const end = d + 0.6;
    if (e >= end) {
      job = null;
      model.position.x = home.x;
      model.position.z = home.z;
      model.rotation.y = home.ry;
      pose({ phase, swing: 0, kneel: 0, t });
      return;
    }
    const tangent = (s: number) => {
      const v = curve.getTangentAt(Math.min(1, Math.max(0, s / L)));
      return Math.atan2(v.z, v.x);
    };
    const face = calls[job.i].face;
    let s = 0;
    let heading = homeHeading;
    let swing = 0;
    let kneel = 0;
    if (e < a) {
      heading = mix(homeHeading, tangent(0), smooth(e / a)); // turns to the way out
    } else if (e < b) {
      s = ((e - a) / walk) * L;
      heading = tangent(s);
      swing = 1;
    } else if (e < c) {
      s = L;
      const k = e - b;
      heading = mix(tangent(L), face, smooth(k / 0.4));
      kneel = Math.min(smooth(k / KNEEL), smooth((TREAT - k) / KNEEL));
      if (!job.marked && k > TREAT - KNEEL) {
        job.marked = true;
        job.st.helped = true;
        job.st.helpedAt = t;
      }
    } else if (e < d) {
      s = L - ((e - c) / walk) * L;
      heading = mix(face, tangent(s) + Math.PI, smooth((e - c) / 0.4));
      swing = 1;
    } else {
      const k = smooth((e - d) / 0.6);
      heading = mix(tangent(0) + Math.PI, homeHeading, k);
      swing = 0.4;
    }
    const p = curve.getPointAt(Math.min(1, Math.max(0, s / L)));
    phase += dt * STRIDE * swing * 1.2;
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -heading;
    pose({ phase, swing, kneel, t });
  };
}
