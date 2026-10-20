// Where the name lies: big raised letters flat on the ground in the open yard, with the contact buttons just south of them.
// World px, on the 768 px map. It sits clear of every project area (the Racing area ends at y = 272, the right-middle
// building starts at x = 560). Plain numbers only, so that world.ts can keep the yard tires off it without pulling in three.
import { NAME_BOX } from "./namepath";

const TILE = 16;

export const NAME = {
  /** The centre line: the middle of the map. */
  cx: 384,
  /** The top of the capital letters. */
  top: 300,
  /** The width the letters are scaled to. */
  letters: 340,
};

/** Path units to world px. */
export const NAME_SCALE = NAME.letters / (NAME_BOX.x1 - NAME_BOX.x0);

/** The baseline: capitals stand on it, and the tail of the g hangs below it. */
export const NAME_BASELINE = NAME.top + NAME_BOX.y1 * NAME_SCALE;

/** The name's footprint on the ground. */
export function nameRect() {
  return {
    x: NAME.cx - NAME.letters / 2,
    y: NAME.top,
    w: NAME.letters,
    h: (NAME_BOX.y1 - NAME_BOX.y0) * NAME_SCALE,
  };
}

/** Where the contact area starts: the first tile row below the g's tail, with a little room. */
export const CONTACT_Y = Math.ceil((NAME_BASELINE - NAME_BOX.y0 * NAME_SCALE + 8) / TILE) * TILE;
