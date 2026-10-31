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
};

// ---------------------------------------------------------------- Power Play

/** How tall each junction's pole is above its base plate (px); the field's exaggerated poles, the high one the tallest. */
export const PP_HEIGHT = { l: 8, m: 14, h: 20 } as const;

/** The top of a medium or high junction: the base plate (1), the pole and the cap on top of it (0.9). */
export const poleTop = (level: "m" | "h") => 1 + PP_HEIGHT[level] + 0.9;

/**
 * The Power Play robot's dimensions (px; 1 px = 1.2 in), shared by its model, its cycle and the scene. Robot frame: x forward,
 * y up, z to its right. One arm swings about the turret (a vertical axis on the lift's carriage, `turretX` from the middle); at its
 * end an axle runs out sideways to the claw, which hangs in a plane `offset` to the right of the arm, so that it can swing right
 * over the top without meeting the arm. The claw, level when the wrist is at 0, points along the arm from the axle. `lift` is the
 * height of the wrist axle (the carriage's foot).
 */
export const PP = {
  half: 5.835, // the chassis is 14 in square
  turretX: -2,
  arm: 8.8, // turret axis to wrist axle
  offset: 4.2, // the claw's plane, to the right of the arm
  grip: 3.4, // wrist axle to the middle of the jaws, along the level claw
  hold: 1, // a held cone's base ring is this far below the jaws' middle (they close just above the ring)
  coneH: 5.5,
  above: 0.5, // how far above a pole's cap a cone's base is let go
  stackTop: 2.4, // the base of the top cone of the red stack (three cones, 1.2 apart)
  slide: 12, // the height of each stage of the lift's drawer slides
  tilt: (135 * Math.PI) / 180, // the wrist's pivot to carry a cone (0 to pick one up and to put it on a pole)
  twist: (20 * Math.PI) / 180, // the extra roll about the claw's own axis when depositing from the side
} as const;

/** How the arm waits (and where reduced motion leaves it): the wrist up, the claw open, the lift part way. */
export const PP_WAIT = { lift: 10, yaw: 0, tilt: Math.PI / 2, twist: 0, claw: 1 } as const;

/**
 * A point of the claw's frame (x along the claw, y up when level, z across) in the arm's frame (x outward, y up, z sideways),
 * relative to the wrist axle: the claw rolls about its own axis by `twist`, then the wrist pitches it up by `tilt`.
 */
export function clawToArm(v: readonly [number, number, number], tilt: number, twist: number): [number, number, number] {
  const cr = Math.cos(twist);
  const sr = Math.sin(twist);
  const y1 = v[1] * cr - v[2] * sr;
  const z1 = v[1] * sr + v[2] * cr;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return [v[0] * ct - y1 * st, v[0] * st + y1 * ct, z1];
}

/**
 * The centre of a held cone's base in the arm's frame, relative to the turret axis and the wrist's height (x outward, y up, z
 * sideways): that is the point that goes over a pole, or on to a cone to be taken.
 */
export function heldBase(tilt: number, twist: number): [number, number, number] {
  const c = clawToArm([PP.grip, -PP.hold, 0], tilt, twist);
  return [PP.arm + c[0], c[1], PP.offset + c[2]];
}
