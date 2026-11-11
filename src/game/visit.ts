// The formula car's trip to the name: the data that describes it, and the geometry the car drives it with (see drive.ts).
// Everything is in world px; a heading is a direction in the world plane (x east, y south), 0 facing east.
import { CatmullRomCurve3, Vector3 } from "three";

export interface Pt {
  x: number;
  y: number;
}

/** Where the car is and which way its nose points (z is the world's y, as in three). */
export interface Pose {
  x: number;
  z: number;
  h: number;
}

/**
 * The trip, as points the car's path is drawn through. It is made of pieces of the lap (see racingScene): the cone track is
 * shared with it, and the way home is the lap's own lane.
 */
export interface Visit {
  /** From the parking spot, out of the bay and down the cone track, to the finish (the last point). */
  track: Pt[];
  /** From the finish to the stop, in order: the stop is the last point, and the car faces along the last stretch. */
  toStop: Pt[];
  /** The rest of the standard lap after the finish (the loop, the lane, the arc into the bay): a lap taken from the track goes round it. */
  lapRest: Pt[];
  /** Where the lane starts: a car that turns round (at the stop, or on the way out) aims for it. */
  join: Pt;
  /** The lane and the arc into the bay, from `join` on. */
  laneTail: Pt[];
}

/** One stretch of the car's way: its poses, a pixel or so apart, and how it is driven. */
export interface Leg {
  poses: Pose[];
  len: number;
  /** px/s at its fastest. */
  speed: number;
  /** The car comes to a stop at the end of it (otherwise it drives straight on into the next one). */
  brake: boolean;
  /** For the way out: how far along it the cone track ends (a car before it can still carry on round the lap). */
  trackLen: number;
  /** The leg ends in the parking spot: the car's heading is eased onto the parked one. */
  park: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Points that are not on top of each other (a centripetal spline cannot take two at one place). */
function apart(points: Pt[], min = 1.5): Pt[] {
  const kept: Pt[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > min) kept.push(p);
  }
  return kept;
}

/** The poses along a smooth curve through the points, about a pixel apart. */
function curvePoses(points: Pt[]): Pose[] {
  const pts = apart(points);
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, z: p.y, h: 0 }));
  const curve = new CatmullRomCurve3(
    pts.map((p) => new Vector3(p.x, 0, p.y)),
    false,
    "centripetal"
  );
  curve.arcLengthDivisions = Math.max(400, pts.length * 60);
  const n = Math.max(2, Math.ceil(curve.getLength()) + 1);
  const poses: Pose[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const p = curve.getPointAt(u);
    const d = curve.getTangentAt(u);
    poses.push({ x: p.x, z: p.z, h: Math.atan2(d.z, d.x) });
  }
  return poses;
}

const spacing = (poses: Pose[]) => {
  let len = 0;
  for (let i = 1; i < poses.length; i++) len += Math.hypot(poses[i].x - poses[i - 1].x, poses[i].z - poses[i - 1].z);
  return len;
};

export function makeLeg(poses: Pose[], opts: { speed: number; brake: boolean; park?: boolean; trackLen?: number }): Leg {
  return { poses, len: spacing(poses), speed: opts.speed, brake: opts.brake, park: !!opts.park, trackLen: opts.trackLen ?? 0 };
}

/**
 * A leg along `points`, starting from where the car is now (`from`, going the way its nose points) or, with none, from the first point.
 * The points must all be ahead of the car.
 */
export function legThrough(from: Pose | null, points: Pt[], opts: { speed: number; brake: boolean; park?: boolean; finish?: Pt }): Leg {
  const lead = 8; // a point straight ahead of the car, so that the path leaves it along its heading
  // (the points close to the car are left out: next to the lead point they would make the path wiggle)
  const all = from
    ? [
        { x: from.x, y: from.z },
        { x: from.x + Math.cos(from.h) * lead, y: from.z + Math.sin(from.h) * lead },
        ...points.filter((p) => Math.hypot(p.x - from.x, p.y - from.z) >= lead + 6),
      ]
    : points;
  const poses = curvePoses(all);
  let trackLen = 0;
  if (opts.finish) {
    // how far along the cone track ends: the pose nearest the finish line
    let best = 0;
    let bestD = Infinity;
    poses.forEach((p, i) => {
      const d = Math.hypot(p.x - opts.finish!.x, p.z - opts.finish!.y);
      if (d < bestD) (bestD = d), (best = i);
    });
    trackLen = (best / Math.max(1, poses.length - 1)) * spacing(poses);
  }
  return makeLeg(poses, { ...opts, trackLen });
}

/** The points of `pts` that are still ahead of the car (the nearest one, if it is not behind it, and all after). */
export function pointsAhead(from: Pose, pts: Pt[]): Pt[] {
  let best = 0;
  let bestD = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - from.x, p.y - from.z);
    if (d < bestD) (bestD = d), (best = i);
  });
  const p = pts[best];
  if (!p) return [];
  const ahead = (p.x - from.x) * Math.cos(from.h) + (p.y - from.z) * Math.sin(from.h);
  return pts.slice(ahead < 5 ? best + 1 : best);
}

/**
 * Turning round in one sweep: an arc of radius `r` on the way the car turns the shorter way, until it points at `target`. Returns
 * the poses along it (the last is where the car is when it points at the target; just the first if it already does).
 */
export function uTurn(from: Pose, target: Pt, r: number): Pose[] {
  const bearing = (p: Pose) => Math.atan2(target.y - p.z, target.x - p.x);
  const sign = wrap(bearing(from) - from.h) >= 0 ? 1 : -1;
  const out: Pose[] = [{ ...from }];
  let p = from;
  for (let i = 0; i < 360 && Math.abs(wrap(bearing(p) - p.h)) > 0.3; i++) {
    const h = p.h + sign / r;
    p = { x: p.x + Math.cos((p.h + h) / 2), z: p.z + Math.sin((p.h + h) / 2), h };
    out.push(p);
  }
  return out;
}

/** The pose a fraction of the way along a leg, in pixels from its start. */
export function poseAt(leg: Leg, s: number): Pose {
  const n = leg.poses.length - 1;
  if (n <= 0) return leg.poses[0];
  const f = Math.min(n, Math.max(0, (s / leg.len) * n));
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  const a = leg.poses[i];
  const b = leg.poses[i + 1];
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, h: a.h + wrap(b.h - a.h) * k };
}
