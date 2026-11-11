// A prop that drives a lap now and then (the formula car): out of its parking spot, round the path, and home again.
// The car also makes one other trip, to the name, when the about card opens (`visit`, see visit.ts): out along the cone track,
// on to a stop beside the name, and home again when the card closes.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import type { AnimCtx } from "./models";
import { legThrough, makeLeg, poseAt, pointsAhead, uTurn, type Leg, type Pose, type Visit } from "./visit";

/** How fast the car goes: every straight stretch of every drive it makes, its laps included, tops out at this (px/s). */
const CAR_SPEED = 130;
const SPEED = CAR_SPEED / 1.5; // average px/s over a lap (it eases out of and into the parking spot, so it peaks at 1.5x: CAR_SPEED)
const FIRST = [8, 14]; // seconds after the scene starts to the first lap
const GAP = [20, 30]; // seconds from the end of one lap to the next
const SETTLE = 0.08; // the last part of the lap (as a fraction of it) over which the heading eases to the parked one

// the trip to the name
const TURN_R = 16; // turning radius, px, of that U and of any other turn it makes (the lap's last arc is 14)
const ACCEL = 300; // px/s^2 pulling away
const BRAKE = 160; // px/s^2 stopping
const ARRIVE_NEAR = 34; // a car this close to the stop when the card closes goes on to it and turns there, rather than turning round
const SETTLE_HOME = 0.1; // the last part of the way home over which the heading eases to the parked one

/** Where the car is while it is out on a lap, for anyone who watches it go by (the typist at the laptop). */
export const carWatch = { driving: false, x: 0, z: 0 };

const between =([a, b]: number[]) => a + Math.random() * (b - a);
const smooth = (u: number) => u * u * (3 - 2 * u);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The trip to the name as it is under way: the legs still to drive, how far along the first of them, and how fast. */
interface Trip {
  legs: Leg[];
  i: number;
  s: number;
  v: number;
  /** "out": on the way to the name (it can still be called back), "back": on its way home. */
  phase: "out" | "back";
  /** Stopped at the name, for as long as the card is open. */
  dwell: boolean;
}

/**
 * Makes `model` follow `path` (world px; its first and last points are where it is parked) on its own every so often.
 * `model.userData.drive()` starts a lap on demand, and returns whether it did (false while one is already under way).
 * Only x, z and the heading are touched: the hover lift owns the model's height.
 *
 * With a `visit`, `model.userData.sendOut()` sends the car to the name (at once if it is parked or has not yet turned back
 * toward the parking spot on a lap; after the lap if it has) and `model.userData.recall()` brings it home again.
 */
export function attachLap(model: Group, path: { x: number; y: number }[], visit?: Visit) {
  const curve = new CatmullRomCurve3(
    path.map((p) => new Vector3(p.x, 0, p.y)),
    false,
    "centripetal"
  );
  curve.arcLengthDivisions = 1500;
  const duration = curve.getLength() / SPEED;
  const home = { x: model.position.x, z: model.position.z, ry: model.rotation.y };

  let start = -1; // when the lap in progress began (-1: parked)
  let next = -1; // when the next lap starts by itself
  let requested = false;

  // where along the lap (0..1) the finish line is: a lap that is before it is still on its way out
  let uFinish = 1;
  if (visit) {
    const fin = visit.track[visit.track.length - 1];
    let bestD = Infinity;
    for (let k = 0; k <= 600; k++) {
      const p = curve.getPointAt(k / 600);
      const d = Math.hypot(p.x - fin.x, p.z - fin.y);
      if (d < bestD) (bestD = d), (uFinish = k / 600);
    }
  }
  let lapU = 0; // how far round the lap the car is now

  let trip: Trip | null = null;
  let wanted = false; // the about card is open: the car should be at the name
  let redirect = false; // the card has just opened while the car is out on a lap that has not yet turned back

  model.userData.drive = () => {
    if (start >= 0 || requested || trip) return false;
    requested = true;
    return true;
  };
  model.userData.lapState = () => ({ start, next, requested, duration });

  model.userData.sendOut = () => {
    if (!visit) return;
    wanted = true;
    if (start >= 0 && !trip) {
      // out on a lap: if its heading is still away from the parking spot it turns for the name at once; once it has turned back
      // toward it, it goes home first and then out through the cones
      const p = poseNow();
      // (the cosine of the angle between where it points and where the parking spot is: it counts as turned back once it points
      // within 60 degrees of it, which a car still swinging round the loop, even pointing west, does not yet)
      const dist = Math.hypot(home.x - p.x, home.z - p.z) || 1;
      const toHome = ((home.x - p.x) * Math.cos(p.h) + (home.z - p.z) * Math.sin(p.h)) / dist;
      if (toHome <= 0.5) redirect = true;
    }
  };
  model.userData.recall = () => {
    wanted = false;
    redirect = false;
  };
  /** Parked beside the name (the trip's end): what the tag under it waits for. */
  model.userData.visitParked = () => !!trip && trip.dwell;

  carWatch.driving = false;

  const poseNow = (): Pose => ({ x: model.position.x, z: model.position.z, h: -model.rotation.y });
  const place = (p: Pose) => {
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -p.h;
    carWatch.x = p.x;
    carWatch.z = p.z;
  };

  const beginTrip = (leg: Leg, v: number) => {
    trip = { legs: [leg], i: 0, s: 0, v, dwell: false, phase: "out" };
    requested = false;
    start = -1;
  };

  /** Called every frame while the trip to the name is under way. */
  const stepTrip = (t: number, dt: number) => {
    const tr = trip!;
    // (the legs of the trip are all of its own: the standard lap is not touched)
    if (tr.dwell) {
      carWatch.driving = false;
      if (wanted || !visit) return;
      // the card has closed: it pulls away in a wide U back toward the garage, then up the lane and into the bay
      const poses = uTurn(poseNow(), visit.join, TURN_R);
      const end = poses[poses.length - 1];
      tr.legs = [
        makeLeg(poses, { speed: CAR_SPEED, brake: false }),
        legThrough(end, pointsAhead(end, visit.laneTail), { speed: CAR_SPEED, brake: true, park: true }),
      ];
      tr.i = 0;
      tr.s = 0;
      tr.v = 0;
      tr.dwell = false;
      tr.phase = "back";
    }

    // the card closed on the way out: the car does not carry on to the name
    // (not while it is still swinging round onto the way out: that is a second or less, and it is decided when that is done)
    if (tr.phase === "out" && !wanted && visit && tr.i === tr.legs.length - 1) {
      const leg = tr.legs[tr.i];
      const here = poseAt(leg, tr.s);
      if (tr.s < leg.trackLen - 2) {
        // still on the cone track: the lap loops home from here, so it is simply a lap
        const rest = [...pointsAhead(here, visit.track), ...visit.lapRest];
        tr.legs = [legThrough(here, rest, { speed: CAR_SPEED, brake: true, park: true })];
        tr.i = 0;
        tr.s = 0;
        tr.phase = "back";
      } else if (leg.len - tr.s > ARRIVE_NEAR) {
        // past it, and not yet near the stop: turn round without stopping, onto the lane
        const poses = uTurn(here, visit.join, TURN_R);
        const end = poses[poses.length - 1];
        tr.legs = [
          makeLeg(poses, { speed: CAR_SPEED, brake: false }),
          legThrough(end, pointsAhead(end, visit.laneTail), { speed: CAR_SPEED, brake: true, park: true }),
        ];
        tr.i = 0;
        tr.s = 0;
        tr.phase = "back";
      }
    }

    let leg = tr.legs[tr.i];
    const rest = leg.len - tr.s;
    let target = leg.speed;
    // (it plans to stop with 60% of the braking it has, so that it is always able to follow the plan: with all of it, a car that
    // is a little late slows too slowly, and is still moving when it gets there)
    if (leg.brake) target = Math.min(target, 5 + Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, rest)));
    tr.v += Math.min(ACCEL * dt, Math.max(-BRAKE * dt, target - tr.v));
    // (a frame that runs past the end of a leg carries what is left into the next one: stopping at the join for the rest of the
    // frame would be a stutter)
    let s = tr.s + Math.max(0, tr.v) * dt;
    while (s >= leg.len && tr.i + 1 < tr.legs.length) {
      s -= leg.len;
      leg = tr.legs[++tr.i];
    }
    tr.s = Math.min(leg.len, s);

    const pose = poseAt(leg, tr.s);
    if (leg.park) {
      // coming home, the heading eases onto the parked one (the way round, never the long way)
      const w = smooth(Math.min(1, Math.max(0, (tr.s / leg.len - (1 - SETTLE_HOME)) / SETTLE_HOME)));
      pose.h += wrap(-home.ry - pose.h) * w;
    }
    place(pose);
    carWatch.driving = true;

    if (tr.i === tr.legs.length - 1 && tr.s >= leg.len - 0.05) {
      if (leg.park) {
        model.position.x = home.x;
        model.position.z = home.z;
        model.rotation.y = home.ry;
        trip = null;
        carWatch.driving = false;
        next = t + between(GAP);
      } else {
        // arrived at the name
        tr.dwell = true;
        tr.v = 0;
        carWatch.driving = false;
      }
    }
  };

  // The hover glow: on while the pointer is over the car and a click would send it out, off otherwise (set by the renderer
  // through `userData.hovered`; the model's `userData.setGlow` draws it).
  let glow = 0;
  let lastT = -1;

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: the car stays put
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    const inviting = model.userData.hovered === true && start < 0 && !requested && !trip;
    glow += ((inviting ? 1 : 0) - glow) * (1 - Math.exp(-dt * 10));
    (model.userData.setGlow as ((amount: number, t: number) => void) | undefined)?.(glow < 0.002 ? 0 : glow, t);
    if (next < 0) next = t + between(FIRST);

    if (visit && !trip) {
      if (redirect) {
        // the card opened while the car is out on a lap that has not turned back: it turns for the name from where it is
        redirect = false;
        if (start >= 0 && wanted) {
          const here = poseNow();
          const onTrack = lapU < uFinish;
          const ahead = onTrack ? [...pointsAhead(here, visit.track), ...visit.toStop] : pointsAhead(here, visit.toStop);
          // (a car that points away from where it is going swings round on an arc first, so that it never kinks)
          // (it aims at a point well along the way, not the next one: that one is so near that, once the car points at it, the way
          // turns off again at once)
          const aim = ahead.find((p) => Math.hypot(p.x - here.x, p.y - here.z) >= 45) ?? ahead[ahead.length - 1];
          const swing = uTurn(here, aim, TURN_R);
          const from = swing[swing.length - 1];
          const finish = onTrack ? visit.track[visit.track.length - 1] : undefined;
          // (after the swing the car points at `aim`: the way goes on from it, not back through the points it has cut across)
          const leg = legThrough(from, ahead.slice(ahead.indexOf(aim)), { speed: CAR_SPEED, brake: true, finish });
          if (swing.length > 2) {
            const arc = makeLeg(swing, { speed: CAR_SPEED, brake: false });
            beginTrip(arc, SPEED);
            trip!.legs.push(leg);
          } else beginTrip(legThrough(here, ahead, { speed: CAR_SPEED, brake: true, finish }), SPEED);
        }
      } else if (wanted && start < 0) {
        // parked, and the card is open: out through the cones, to the name
        beginTrip(legThrough(null, [...visit.track, ...visit.toStop], { speed: CAR_SPEED, brake: true, finish: visit.track[visit.track.length - 1] }), 0);
      }
    }
    if (trip) {
      stepTrip(t, dt);
      return;
    }

    if (start < 0) {
      if (!requested && (t < next || wanted)) return;
      start = t;
      requested = false;
    }
    const elapsed = t - start;
    if (elapsed >= duration) {
      model.position.x = home.x;
      model.position.z = home.z;
      model.rotation.y = home.ry;
      start = -1;
      next = t + between(GAP);
      carWatch.driving = false;
      return;
    }
    carWatch.driving = true;
    const u = smooth(elapsed / duration);
    lapU = u;
    const p = curve.getPointAt(u);
    const d = curve.getTangentAt(u);
    let heading = Math.atan2(d.z, d.x);
    // coming home, ease the heading onto the parked one (the way round, never the long way)
    const w = smooth(Math.min(1, Math.max(0, (u - (1 - SETTLE)) / SETTLE)));
    const diff = Math.atan2(Math.sin(-home.ry - heading), Math.cos(-home.ry - heading));
    heading += diff * w;
    model.position.x = p.x;
    model.position.z = p.z;
    model.rotation.y = -heading;
    carWatch.x = p.x;
    carWatch.z = p.z;
  };
}
