// What the FTC field's game pieces are doing, shared by the models that draw them and the robot that moves them. No `three`
// in here: the scene (ftc.ts) needs the sample layout to aim the robot at it, and the layout must come out the same
// everywhere, so it lives in one place.

export const SAMPLE_COLORS = { red: "#d8322c", blue: "#2f74e0", yellow: "#f2c230" } as const;

/** A small repeatable generator (mulberry32): the same seed always gives the same run of numbers in 0..1. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleSpot {
  x: number; // in the submersible's frame: its centre, x east, z south
  z: number;
  yaw: number;
  color: string;
}

const COLS = 6;
const ROWS = 4;
const PALETTE = [SAMPLE_COLORS.red, SAMPLE_COLORS.blue, SAMPLE_COLORS.yellow];

/** The two samples the robot takes (indices into `submersibleSamples`): one at the west end, one just in from the south side. */
export const TAKEN = { left: 0 * ROWS + 1, right: 4 * ROWS + 2 } as const; // column 0 row 1; column 4 row 2

/**
 * The samples lying on the submersible's floor: a jittered grid, the same on every load, for a floor `w` x `d`. The two the
 * robot takes (`TAKEN`) are always a red one on the left and a yellow one on the right; the rest are any colour.
 */
export function submersibleSamples(w: number, d: number): SampleSpot[] {
  const hx = w / 2 - 1.5;
  const hz = d / 2 - 1.5;
  const rand = seeded(2025);
  const out: SampleSpot[] = [];
  for (let i = 0; i < COLS; i++)
    for (let j = 0; j < ROWS; j++) {
      const x = ((i - (COLS - 1) / 2) * (2 * (hx - 4))) / (COLS - 1) + (rand() - 0.5) * 1.8;
      const z = ((j - (ROWS - 1) / 2) * (2 * (hz - 2))) / (ROWS - 1) + (rand() - 0.5) * 0.8;
      const color = PALETTE[Math.floor(rand() * PALETTE.length)];
      const yaw = (rand() - 0.5) * 1.3;
      out.push({ x, z, yaw, color });
    }
  out[TAKEN.left].color = SAMPLE_COLORS.red;
  out[TAKEN.right].color = SAMPLE_COLORS.yellow;
  // The robot picks both up with the scoop across them, so they lie across the way it comes at them: the left one, which it
  // approaches from the west (facing east), north-south; the right one, which it approaches from the south, east-west.
  out[TAKEN.left].yaw = Math.PI / 2;
  out[TAKEN.right].yaw = 0;
  return out;
}

/**
 * The state the robots write every frame, as a function of where they are in their loops (see robotcycle.ts, ppcycle.ts), and the
 * models read. Into the Deep: how much of each of the two samples the robot takes is on the floor (1 there, 0 gone), and how
 * much of the sample it has just dropped in each basket is showing on top (0 not at all, 1 in place); red basket / blue basket,
 * left / right sample. Power Play: how much of the red stack's top cone and of the human player's cone is there (1 there, 0 taken),
 * and the cone just placed on the high / medium junction (0 not at all, 0..1 sliding down the pole, 1 at rest, 1..2 shrinking away).
 * The rest state, and the one reduced motion leaves, is every game piece where it was and nothing placed.
 */
export const ftcField = {
  sample: [1, 1],
  dropped: [0, 0],
  cone: [1, 1],
  placed: [0, 0],
  /** The way the cone just placed on the high / medium junction leans as it is let go (base to tip, world x east, y up, z south). */
  lean: [
    [0, 1, 0],
    [0, 1, 0],
  ],
  /** Center Stage: the two pixels at the east wall, yellow then white (1 there, 0 taken), ... */
  wall: [1, 1],
  /** ...and the two the robot puts on the backdrop, white then yellow (0 not there, 0..1 let go and settling, 1..2 shrinking away). */
  px: [0, 0],
  /** How far each of those was turned (radians) as it was let go: it settles square to the board as it lands. */
  pxTurn: [0, 0],
};

// ---------------------------------------------------------------- Power Play

/** How tall each junction's pole is above its base plate (px); the field's exaggerated poles, the high one the tallest. */
export const PP_HEIGHT = { l: 8, m: 14, h: 20 } as const;

/** The top of a medium or high junction: the base plate (1) and the bare pole, which a cone slides down over. */
export const poleTop = (level: "m" | "h") => 1 + PP_HEIGHT[level];

/** A Power Play cone (px): hollow like a traffic cone, open at the wide end and with a hole at the narrow one that a pole passes through. */
export const CONE = { h: 5.5, base: 2.5, top: 1.5, ring: 2.9, wall: 0.35 } as const;

/** The outer radius of a cone's wall at `h` above its base ring (0.5 thick). */
export const coneRadius = (h: number) => CONE.base + ((CONE.top - CONE.base) * Math.max(0, h - 0.5)) / (CONE.h - 0.5);

/**
 * The Power Play robot's dimensions (px; 1 px = 1.2 in), shared by its model, its cycle and the scene. Robot frame: x forward,
 * y up, z to its right. A horizontal upper arm swings about the turret (a vertical axis on the lift's carriage, `turretX` from the
 * middle) out to the wrist's pivot; from the pivot a forearm hangs down and forward to the claw, in line with the arm, which grips a
 * cone near the floor. The wrist pitches the forearm and claw about the pivot (0 = the claw level, jaws pointing along the arm),
 * so at 135 degrees they have swung up and back over the end of the upper arm. `lift` is the height of the pivot.
 */
export const PP = {
  half: 5.835, // the chassis is 14 in square
  turretX: -1,
  arm: 4.8, // turret axis to the pivot
  grip: 6, // pivot to the middle of the jaws, forward, with the claw level
  drop: 2.4, // and the jaws' middle is this far below the pivot: a cone on the floor is taken with the slides all the way down (pivot 3.4)
  hold: 1, // a held cone's base ring is this far below the jaws' middle (they close just above the ring)
  coneH: CONE.h,
  above: 0.5, // how far above a pole's top a cone's base is let go
  pitch: 1.8, // how far each cone of a stack stands above the one it is nested in (the wall is 0.35 thick and the cone narrows by 1 in 5)
  stackTop: 3.6, // the base of the top cone of the red stack (three cones)
  slide: 13.5, // the height of each stage of the lift's drawer slides
  carriage: 2.5, // the carriage's foot is this far below the pivot
  tilt: (135 * Math.PI) / 180, // the wrist's pivot to carry a cone (0 to pick one up and to put it on a pole)
  twist: (20 * Math.PI) / 180, // the extra roll about the claw's own axis when depositing from the side
} as const;

/** How the arm waits (and where reduced motion leaves it): the wrist up, the claw open, the lift part way. */
export const PP_WAIT = { lift: 14, yaw: 0, tilt: Math.PI / 2, twist: 0, claw: 1 } as const;

/**
 * A point `v` of the claw (relative to the middle of the jaws: x along the claw, y up when level, z across) in the arm's frame
 * (x outward, y up, z sideways), relative to the pivot: the claw rolls about its own axis by `twist`, hangs from the pivot on the
 * forearm, and the wrist pitches the whole of it up by `tilt`.
 */
export function clawToArm(v: readonly [number, number, number], tilt: number, twist: number): [number, number, number] {
  const cr = Math.cos(twist);
  const sr = Math.sin(twist);
  const x = v[0] + PP.grip;
  const y = v[1] * cr - v[2] * sr - PP.drop;
  const z = v[1] * sr + v[2] * cr;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return [x * ct - y * st, x * st + y * ct, z];
}

/** The same for a direction (the cone's axis, say): no hanging from the pivot. */
export function clawDir(v: readonly [number, number, number], tilt: number, twist: number): [number, number, number] {
  const o = clawToArm([0, 0, 0], tilt, twist);
  const p = clawToArm(v, tilt, twist);
  return [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
}

/**
 * The centre of a held cone's base in the arm's frame, relative to the turret axis and the pivot's height (x outward, y up, z
 * sideways): that is the point that goes over a pole, or on to a cone to be taken.
 */
export function heldBase(tilt: number, twist: number): [number, number, number] {
  const c = clawToArm([0, -PP.hold, 0], tilt, twist);
  return [PP.arm + c[0], c[1], c[2]];
}

// ---------------------------------------------------------------- Center Stage

/**
 * A Center Stage pixel to scale. The game manual gives its size as a hexagon 3 in across and 0.5 in thick, at the field's 1.2 in per px;
 * `across` is the hexagon's width between two parallel sides and `corner` its height from point to point with those sides upright.
 * It is a ring: the manual's drawings (appendix C) show a hexagonal hole through the middle, which I read as about 0.45 of the width.
 */
export const PIXEL_SIZE = { across: 3 / 1.2, corner: 3 / 1.2 / Math.cos(Math.PI / 6), thick: 0.5 / 1.2, hole: 0.45 } as const;

/**
 * How the pixels lie on the backdrop's face: rows of hexagons, six across and five across in turn, the bottom row being the six
 * (each row sits in the gaps of the one below, so the fives leave half a pixel of space at each side).
 */
export const BACKDROP_GRID = {
  cols: 6,
  rows: 8,
  rowPitch: PIXEL_SIZE.corner * 0.75,
  margin: 0.45, // from the board's bottom edge to the lowest hexagon's lowest point
} as const;

/** How many pixels fit in `row` (0 is the bottom one). */
export const backdropRowSize = (row: number) => (row % 2 === 0 ? BACKDROP_GRID.cols : BACKDROP_GRID.cols - 1);

/** The centre of the pixel at `row` (0 is the bottom one) and `col` on the face: `u` across from its middle, `v` up from its bottom edge. */
export function backdropCell(row: number, col: number): { u: number; v: number } {
  return {
    u: (col - (backdropRowSize(row) - 1) / 2) * PIXEL_SIZE.across,
    v: BACKDROP_GRID.margin + PIXEL_SIZE.corner / 2 + row * BACKDROP_GRID.rowPitch,
  };
}

/**
 * The pixels on the backdrop to start with: a few that have slid down into the bottom right corner, each resting on the two beneath it
 * (the one at the board's right edge on one and the side). Bottom row six across, then five, then six; `color` is white (w), yellow
 * (y), purple (p) or green (g).
 */
export const BACKDROP_PILE: { row: number; col: number; color: "y" | "p" | "w" | "g" }[] = [
  { row: 0, col: 1, color: "w" },
  { row: 0, col: 2, color: "g" },
  { row: 0, col: 3, color: "g" },
  { row: 0, col: 4, color: "w" },
  { row: 0, col: 5, color: "w" },
  { row: 1, col: 2, color: "g" },
  { row: 1, col: 3, color: "w" },
  { row: 1, col: 4, color: "w" },
  { row: 2, col: 4, color: "p" },
  { row: 2, col: 5, color: "g" },
];

/** How long the Stage Door's span is: from the post on the tape line to the truss's near A-frame, about two tiles (about 46 in in the manual). */
export const STAGE_DOOR_LEN = 40.9;

/** The backdrop board: its lean (60 degrees from the floor, 30 from vertical as in the manual's C-2), its length, and the platform it stands on. */
export const BACKDROP = { tilt: Math.PI / 3, len: 20, platform: 1.5, depth: 10, faceInset: 0.45 } as const;

/**
 * Where the face's point (`u` across from the middle, `v` up the face from its bottom edge) is relative to the backdrop's centre on the
 * floor: `z` south of it and `h` above the floor.
 */
export function backdropFace(u: number, v: number, lift = 0): { x: number; z: number; h: number } {
  const t = BACKDROP.tilt;
  const zf = (BACKDROP.len - 0.8) / 2 - v; // along the board, the bottom end being +
  const y = BACKDROP.faceInset + lift; // out of the face
  return { x: u, z: y * Math.sin(t) + zf * Math.cos(t), h: BACKDROP.platform + (BACKDROP.len * Math.sin(t)) / 2 + y * Math.cos(t) - zf * Math.sin(t) };
}

/** The two pixels the Center Stage robot places, white then yellow: where on the lattice (see `backdropCell`). The white goes just left of the green in the second row, the yellow on the purple and the green in the third. */
export const BACKDROP_PLACE: { row: number; col: number; color: "w" | "y" }[] = [
  { row: 1, col: 1, color: "w" },
  { row: 3, col: 4, color: "y" },
];

/**
 * Team 6417's Center Stage robot (px; 1 px = 1.2 in): 17 in square, a clear box with an intake arm on the front that pivots down to take
 * pixels in, and at the back a slide leaning back 30 degrees (parallel to the backdrop) with an arm, a turret and a bucket holding two pixels
 * one above the other. Robot frame: x forward, y up, z to its right; the robot deposits backwards, its rear to the backdrop.
 */
export const CS = {
  half: 17 / 2 / 1.2,
  reach: 4.3, // how far the intake's fingertips reach past the front when it is down
  ahead: 3, // how far past the front a pixel lies, centre, when the roller takes it
  reachUp: 9, // how far the intake sticks out ahead of the robot's centre when it is raised for driving
  lean: Math.PI / 6, // the slide's lean from vertical
  slide: { x: -4, y: 1, len: 6.6, travel: 12, rails: 2.8 }, // its foot, the length of each stage, how far it extends at most (three stages) and how far the two rails stand either side of the middle (the arm and bucket pass between them)
  // the arm from the top of the slide to the turret: along the slide (negative: down it) and out towards the backdrop. Arm and bucket are one piece
  // turning about the slide's top. At rest (`fold`, 60 degrees on) they lie flat inside the robot, the bucket forward of the turret's axis; they swing
  // back through 60 degrees, out of the robot's back, to the deposit position, where the bucket is parallel to the backdrop.
  arm: { along: -1.9, out: 3.12, fold: -Math.PI / 3 },
  bucket: { low: 5.8, high: 2.9, top: 0.7 }, // how far below the turret's axis the pixel nearer the opening and the one above it sit; how far the bucket reaches above it
  turret: Math.PI / 3, // the turret's range, each way
  gap: 1.7, // how far in front of the board the pixels' plane is held when it deposits (the bucket's front, 0.6 nearer, clears pixels already placed)
  height: 7.4, // the chassis's height, under the Stage Door's 12.6 px rail with the slide down
} as const;

/** How the robot waits: intake up, slide down, arm folded with the bucket flat inside the robot, turret straight, gate shut, nothing in it. */
export const CS_WAIT = { intake: 0, spin: 0, slide: 0, arm: CS.arm.fold, turret: 0, gate: 0, yellow: -1, white: -1, yellowLow: 0 } as const;

const D = [-Math.sin(CS.lean), Math.cos(CS.lean)] as const; // up the slide, in the (x, y) plane of the robot
const OUT = [-Math.cos(CS.lean), -Math.sin(CS.lean)] as const; // towards the backdrop, square to the slide
const rot2 = (v: readonly [number, number], a: number): [number, number] => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

/**
 * The top of the slide, extended `e` px, and the arm and turret on it, swung back by `beta` (0 = lying along the slide, parallel to the
 * backdrop; `CS.arm.fold` = folded down inside the robot): the hinge, the turret's axis, and the bucket's
 * up and out directions, in the robot's (x, y) plane.
 */
export function csArm(e: number, beta: number) {
  const hinge: [number, number] = [CS.slide.x + (CS.slide.len + e) * D[0], CS.slide.y + (CS.slide.len + e) * D[1]];
  const l = rot2([CS.arm.along * D[0] + CS.arm.out * OUT[0], CS.arm.along * D[1] + CS.arm.out * OUT[1]], -beta);
  return { hinge, axis: [hinge[0] + l[0], hinge[1] + l[1]] as [number, number], up: rot2(D, -beta), out: rot2(OUT, -beta) };
}

/** The centre of a pixel in the bucket, `dist` below the turret's axis along the bucket, with the turret turned `phi` (positive towards the robot's right), in the robot's frame. */
export function csPixel(e: number, beta: number, phi: number, dist: number): [number, number, number] {
  const a = csArm(e, beta);
  return [a.axis[0] - Math.cos(phi) * dist * a.up[0], a.axis[1] - Math.cos(phi) * dist * a.up[1], Math.sin(phi) * dist];
}

/**
 * How the robot stands at the backdrop (heading south, its middle on the backdrop's): where, south of the backdrop's centre (`z`), so that the
 * pixels' plane is `CS.gap` in front of the face, and, for a pixel to land at (`u`, `v`) on the face, the turret's angle and the slide's extension.
 */
export function csDeposit(u: number, v: number) {
  const t = BACKDROP.tilt;
  const b = backdropFace(0, 0, 0); // the face's lower edge
  const a0 = csArm(0, 0);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const z = b.z - a0.axis[0] + (CS.gap - ct * (a0.axis[1] - b.h)) / st; // where the robot's middle is, south of the backdrop's centre
  const vOf = (e: number) => {
    const p = csArm(e, 0).axis;
    return (z + p[0] - b.z) * -ct + (p[1] - b.h) * st; // how far up the face the turret's axis is
  };
  const phi = Math.asin(Math.max(-1, Math.min(1, -u / CS.bucket.low))); // the middle of the robot is across from the face's middle
  const e = v + CS.bucket.low * Math.cos(phi) - vOf(0);
  return { z, phi, e, ok: Math.abs(phi) <= CS.turret + 1e-6 && e >= 0 && e <= CS.slide.travel + 1e-6 };
}
