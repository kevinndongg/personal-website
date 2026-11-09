// The Center Stage robot's loop, forever, starting at the east wall: one job, the two pixels there to the backdrop.
//
// It stands facing east with the intake arm down, takes the yellow pixel in (the roller pulls it in and up the ramp into the bucket's upper
// place), creeps forward and takes the white one in behind it (the lower place), then backs off west with the arm coming up, spins to face
// south and reverses north under the Stage Door to the backdrop, rear first. Once its front is clear of the door the slides rise; at the
// backdrop the arm swings back (parallel to the backdrop), the turret turns and the gate opens: the white pixel drops in the second row,
// just left of the green one. The yellow slides down to the lower place and the gate holds it; the slides rise, the turret turns the other way
// and the gate opens: the yellow one drops on the purple and the green, a mosaic. Then it retracts (slides up a little and the turret
// centres, the arm folds, the slides go down) while it drives forward again, and back round to the wall.
//
// The game pieces are persistent. The two pixels at the wall shrink away as the roller takes them and fresh ones grow back once the robot
// has driven off; the two it places show on the backdrop until it has driven away, and then shrink, so the next lap can do it again. That is
// `ftcField` (ftcfield.ts), worked out every frame from where the robot is in its loop.
//
// Like the other cycles it only sets the prop's x, z and heading (the hover lift owns its height), and poses the model through
// `userData.pose` (see ftccsrobot.ts). Everything is worked out in the world px the scene gives; nothing here knows where the field is.
import { CatmullRomCurve3, Vector3, type Group } from "three";
import { BACKDROP_PLACE, CS, CS_WAIT, backdropCell, csDeposit, ftcField } from "./ftcfield";
import type { CSPose } from "./ftccsrobot";
import type { AnimCtx } from "./models";
import type { CenterStageCycle } from "./scenes";

const CRUISE = 14; // px/s, the most the robot cruises at (the drive to the backdrop peaks a little above)
const GONE = 14; // how far (px) the robot has driven from a stop before the pixel it leaves there changes (a placed one shrinks, a taken one is replaced)
const FEED = 1.3; // how long a pixel takes to ride in from the floor to its place in the bucket (s)
const SPIN = 10; // the roller's speed (rad/s)
const DOOR_CLEAR = CS.reachUp + 0.8; // the robot's centre has to be this far past the Stage Door for the raised intake to be clear of it
const FOLD_AT = 4; // how far (px) it has driven back off the backdrop before the arm folds,
const DOWN_AT = 8; // and before the slides go down
const APPROACH = 3; // how far (px) short of the backdrop's stand it stops to raise the slides and swing the arm, before creeping in

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const ramp = (t: number, t0: number, dur: number) => smooth((t - t0) / dur);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A speed profile along a route: how far along it the robot is after `u` of the phase, leaving at slope `v0` and arriving at slope `v1` (1 = the average speed). */
const hermite = (v0: number, v1: number) => (u: number) => {
  const u2 = u * u;
  const u3 = u2 * u;
  return (u3 - 2 * u2 + u) * v0 + (-2 * u3 + 3 * u2) + (u3 - u2) * v1;
};

type Arm = Omit<CSPose, "spin" | "yellow" | "white">;
type Channel = keyof Arm;
/** A joint's value at moments of a phase, `[u, value]`, eased from one to the next. */
type Keys = [number, number][];

interface Pose {
  x: number;
  y: number;
  h: number; // heading, radians in the world plane (y = south)
}

/** Something that happens to the field at a moment in a phase (`offset` seconds in). */
interface Mark {
  what: "pick" | "spawn" | "drop" | "clear";
  index: number; // for a pick or spawn, the wall pixel (`ftcField.wall`: 0 yellow, 1 white); for a drop or clear, the backdrop's (`ftcField.px`: 0 white, 1 yellow)
  offset: number;
  /** For a drop: how far the pixel was turned about the board's normal as it was let go (radians). */
  turn?: number;
}

interface Phase {
  dur: number;
  /** Where the robot stands (a stop), turning to `turn` by the end of the phase if it is given. */
  at?: Pose;
  turn?: number;
  /** Or the route it drives, with the heading it sets off with and the one it stops with, and its speed profile (the default eases in and out). */
  route?: { curve: CatmullRomCurve3; h0: number; h1: number; ease?: (u: number) => number };
  arm: [Arm, Arm];
  /** When, as a fraction of the phase, each joint moves (the rest move throughout), so that one joint can follow another. */
  when?: Partial<Record<Channel, [number, number]>>;
  marks?: Mark[];
}

/** How long each thing that happens to the field takes. */
const FADE = { pick: 0.06, spawn: 0.4, drop: 0.5, clear: 0.4 };

export function attachCenterStage(model: Group, cfg: CenterStageCycle) {
  const A0 = CS.half + CS.ahead; // how far ahead of the robot's centre a pixel lies when the roller has it

  // ---- where it stands
  const yStand: Pose = { x: cfg.yellow.x - A0, y: cfg.yellow.y, h: 0 }; // the yellow pixel straight ahead
  const wStand: Pose = { x: cfg.white.x - A0, y: cfg.white.y, h: 0 };
  const lane: Pose = { x: cfg.door.x, y: cfg.yellow.y, h: 0 }; // where it turns, in the lane under the door and on the pixels' row
  const SOUTH = Math.PI / 2;

  // the two deposits: the turret's angle and the slide's extension for each pixel's place on the backdrop
  const cell = (n: number) => backdropCell(BACKDROP_PLACE[n].row, BACKDROP_PLACE[n].col);
  const dW = csDeposit(cell(0).u, cell(0).v);
  const dY = csDeposit(cell(1).u, cell(1).v);
  const stand: Pose = { x: cfg.backdrop.x, y: cfg.backdrop.y + dW.z, h: SOUTH }; // facing south, rear to the backdrop
  const approach: Pose = { ...stand, y: stand.y + APPROACH };
  const phiW = dW.phi; // + = to the robot's right (west when it faces south)
  const phiY = dY.phi;

  const curve = (pts: { x: number; y: number }[]) => {
    const c = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, 0, p.y)),
      false,
      "centripetal"
    );
    c.arcLengthDivisions = 600;
    return c;
  };
  /** A run along `pts` taking `dur`, leaving at `v0` px/s and arriving at `v1`; the heading goes from `h0` to `h1`. */
  const leg = (pts: { x: number; y: number }[], h0: number, h1: number, dur: number, v0: number, v1: number) => {
    const c = curve(pts);
    const d = c.getLength();
    return { dur, route: { curve: c, h0, h1, ease: hermite((v0 * dur) / d, (v1 * dur) / d) } };
  };
  type Drive = { dur: number; route: { curve: CatmullRomCurve3; ease?: (u: number) => number } };
  const pointAt = (ph: Drive, u: number) => ph.route.curve.getPointAt(Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : smooth(u))));
  /** How far into a driving phase (0..1) the robot first satisfies `test` (the end if it never does). */
  const firstU = (ph: Drive, test: (p: { x: number; y: number }) => boolean) => {
    for (let n = 0; n <= 400; n++) {
      const u = n / 400;
      const q = pointAt(ph, u);
      if (test({ x: q.x, y: q.z })) return u;
    }
    return 1;
  };
  /** How many seconds into a driving phase the robot is first `dist` px from `from`. */
  const farOffset = (ph: Drive, from: { x: number; y: number }, dist: number) => firstU(ph, (p) => Math.hypot(p.x - from.x, p.y - from.y) >= dist) * ph.dur;

  // ---- the arm poses along the way
  const S: Arm = { ...CS_WAIT, intake: 1 }; // intake down, everything else stowed
  const driving: Arm = { ...S, intake: 0 };
  const lifted: Arm = { ...driving, slide: dW.e }; // the slides up for the white pixel
  const armBack: Arm = { ...lifted, arm: 0 };
  const lined: Arm = { ...armBack, turret: phiW };
  const open: Arm = { ...lined, gate: 1 };
  const lowered: Arm = { ...open, yellowLow: 1, gate: 0 }; // the yellow slid down to the lower place and held there
  const raised: Arm = { ...lowered, slide: dY.e, turret: phiY };
  const openY: Arm = { ...raised, gate: 1 };
  const clear1: Arm = { ...openY, slide: dY.e + 1.5, turret: 0, gate: 0 }; // slides up slightly and the turret centred

  const loop: Phase[] = [];
  // the yellow pixel in, then a short creep to the white one and the same
  loop.push({ dur: 0.9, at: yStand, arm: [S, S], marks: [{ what: "pick", index: 0, offset: 0.1 }] });
  loop.push({ ...leg([yStand, wStand], 0, 0, 1.0, 0, 0), arm: [S, S], marks: [{ what: "pick", index: 1, offset: 0.9 }] });
  loop.push({ dur: 0.7, at: wStand, arm: [S, S] });
  // backing west with the arm coming up; the new pixels at the wall appear once it is well away
  const backWest = leg([wStand, lane], 0, 0, 2.1, 0, 0);
  loop.push({
    ...backWest,
    arm: [S, driving],
    when: { intake: [0.05, 0.45] },
    marks: [
      { what: "spawn", index: 0, offset: farOffset(backWest, wStand, GONE) },
      { what: "spawn", index: 1, offset: farOffset(backWest, wStand, GONE) + 0.25 },
    ],
  });
  loop.push({ dur: 0.8, at: lane, turn: SOUTH, arm: [driving, driving] });
  // reversing north, under the door: the slides rise only once the front is clear of it
  const north = leg([{ x: lane.x, y: lane.y }, approach], SOUTH, SOUTH, 4.4, 0, 0);
  const uClear = firstU(north, (p) => p.y < cfg.door.y - DOOR_CLEAR);
  loop.push({ ...north, arm: [driving, lifted], when: { slide: [uClear, Math.min(1, uClear + 0.3)] } });
  loop.push({ dur: 0.7, at: approach, arm: [lifted, armBack] });
  loop.push({ ...leg([approach, stand], SOUTH, SOUTH, 1.0, 0, 0), arm: [armBack, lined], when: { turret: [0.1, 0.95] } });
  // the white pixel: the gate opens and it drops; the yellow slides down and is held; then the slides, the turret and the gate for the yellow one
  loop.push({ dur: 0.6, at: stand, arm: [lined, open], when: { gate: [0, 0.5] }, marks: [{ what: "drop", index: 0, offset: 0.3, turn: -phiW }] });
  loop.push({ dur: 0.9, at: stand, arm: [open, lowered], when: { yellowLow: [0, 0.6], gate: [0.6, 1] } });
  loop.push({ dur: 1.8, at: stand, arm: [lowered, raised], when: { slide: [0, 0.5], turret: [0.5, 1] } });
  loop.push({ dur: 0.6, at: stand, arm: [raised, openY], when: { gate: [0, 0.5] }, marks: [{ what: "drop", index: 1, offset: 0.3, turn: -phiY }] });
  // retract: slides up a little and the turret centred together, then the arm folds
  loop.push({ dur: 1.0, at: stand, arm: [openY, clear1], when: { gate: [0.5, 1] } });
  // forward again: once it has backed off the board the arm folds, and once the bucket is out from over the backdrop's platform the slides go
  // all the way down, well before the rear reaches the door
  const exit = leg([stand, lane], SOUTH, SOUTH, 5.0, 0, 0);
  const uFold = firstU(exit, (p) => p.y > stand.y + FOLD_AT);
  const uDown = firstU(exit, (p) => p.y > stand.y + DOWN_AT);
  loop.push({
    ...exit,
    arm: [clear1, driving],
    when: { arm: [uFold, uFold + 0.12], slide: [uDown, Math.min(1, uDown + 0.2)] },
    marks: [
      { what: "clear", index: 0, offset: farOffset(exit, stand, GONE) },
      { what: "clear", index: 1, offset: farOffset(exit, stand, GONE) + 0.2 },
    ],
  });
  loop.push({ dur: 0.8, at: { ...lane, h: SOUTH }, turn: 0, arm: [driving, driving] });
  loop.push({ ...leg([lane, yStand], 0, 0, 1.7, 0, 0), arm: [driving, S], when: { intake: [0.35, 0.85] } });
  const loopTotal = loop.reduce((s, p) => s + p.dur, 0);

  // it starts where the loop does: standing at the wall with the intake down; reduced motion, which never animates it, leaves it there
  model.position.set(yStand.x, model.position.y, yStand.y);
  model.rotation.y = -yStand.h;
  (model.userData.pose as ((p: CSPose) => void) | undefined)?.({ ...S, spin: 0, yellow: -1, white: -1 });

  // when, in the loop, each thing happens to the field
  const events: (Mark & { at: number })[] = [];
  let clock = 0;
  for (const p of loop) {
    for (const m of p.marks ?? []) events.push({ ...m, at: clock + m.offset });
    clock += p.dur;
  }
  const find = (what: Mark["what"], index: number) => events.find((e) => e.what === what && e.index === index)!;
  const pickAt = [find("pick", 0).at, find("pick", 1).at]; // yellow, white
  const dropAt = [find("drop", 0).at, find("drop", 1).at]; // white, yellow
  const clearAt = [find("clear", 0).at, find("clear", 1).at];
  const turnAt = [find("drop", 0).turn!, find("drop", 1).turn!];

  /** The field at `tl` seconds into the loop: a pixel taken is gone until its replacement grows in; a placed one falls, stays, and shrinks away. */
  const field = (tl: number) => {
    const wall = [1, 1];
    for (const ev of events) {
      if (ev.what === "pick") wall[ev.index] -= ramp(tl, ev.at, FADE.pick);
      else if (ev.what === "spawn") wall[ev.index] += ramp(tl, ev.at, FADE.spawn);
    }
    for (let i = 0; i < 2; i++) {
      ftcField.wall[i] = Math.min(1, Math.max(0, wall[i]));
      ftcField.px[i] = tl < dropAt[i] ? 0 : Math.min(2, Math.max(0, ramp(tl, dropAt[i], FADE.drop) + ramp(tl, clearAt[i], FADE.clear)));
      ftcField.pxTurn[i] = turnAt[i];
    }
  };

  /** Where a pixel taken in at `pick` and let go at `drop` is on the robot at `tl`: not on it (-1), on its way in (0..1), or in the bucket (1). */
  const aboard = (tl: number, pick: number, drop: number) => (tl < pick || tl >= drop ? -1 : Math.min(1, (tl - pick) / FEED));

  const channels: Channel[] = ["intake", "slide", "arm", "turret", "gate", "yellowLow"];

  model.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) return; // reduced motion: standing at the wall, every pixel where it was

    // which phase, and how far through it
    const list = loop;
    const tl = t % loopTotal;
    field(tl);
    let e = tl;
    let i = 0;
    while (i < list.length - 1 && e >= list[i].dur) e -= list[i++].dur;
    const ph = list[i];
    const u = e / ph.dur;
    const k = smooth(u);

    let at: Pose;
    if (ph.route) {
      const s = Math.min(1, Math.max(0, ph.route.ease ? ph.route.ease(u) : k));
      const p = ph.route.curve.getPointAt(s);
      at = { x: p.x, y: p.z, h: ph.route.h0 + wrap(ph.route.h1 - ph.route.h0) * s };
    } else if (ph.turn !== undefined) {
      at = { ...ph.at!, h: ph.at!.h + wrap(ph.turn - ph.at!.h) * k };
    } else {
      at = ph.at!;
    }
    model.position.x = at.x;
    model.position.z = at.y;
    model.rotation.y = -at.h;

    const arm = {} as Arm;
    for (const c of channels) {
      const w = ph.when?.[c];
      arm[c] = lerp(ph.arm[0][c], ph.arm[1][c], w ? smooth((u - w[0]) / (w[1] - w[0])) : k);
    }
    const pose = model.userData.pose as ((p: CSPose) => void) | undefined;
    pose?.({ ...arm, spin: arm.intake > 0.2 ? tl * SPIN : 0, yellow: aboard(tl, pickAt[0], dropAt[1]), white: aboard(tl, pickAt[1], dropAt[0]) });
  };
}
