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
  return out;
}

/**
 * The state the robot writes every frame, as a function of where it is in its loop (see robotcycle.ts), and the models read:
 * how much of each of the two samples it takes is on the floor (1 there, 0 gone), and how much of the sample it has just
 * dropped in each basket is showing on top (0 not at all, 1 in place). Red basket / blue basket, left / right sample.
 * The rest state, and the one reduced motion leaves, is every sample on the floor and nothing on top of the baskets.
 */
export const ftcField = {
  sample: [1, 1],
  dropped: [0, 0],
};
