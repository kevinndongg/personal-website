// Where the name is: big raised letters lying flat in the middle of the yard (clicking them opens a card about you). The three
// link slabs, one per link, stand in a row in the top-right corner, above the top-right project. World px, on the 768 px map. The
// name sits clear of every project area (the Racing area ends at y = 272, the gallery starts at y = 592). Plain numbers only, so
// that world.ts and scenes.ts can use it without pulling in three.
import { NAME_BOX } from "./namepath";

export const NAME = {
  /** The centre line: the middle of the map. */
  cx: 384,
  /** The width the letters are scaled to. */
  letters: 340,
};

/** Path units to world px. */
export const NAME_SCALE = NAME.letters / (NAME_BOX.x1 - NAME_BOX.x0);

/** Capitals to the bottom of the g's tail. */
export const NAME_H = (NAME_BOX.y1 - NAME_BOX.y0) * NAME_SCALE;

/** One slab (a link each): a low wedge, its footprint, its height at the back and the front, and the zone area round it. */
export const SLAB = { w: 48, depth: 30, height: 10, frontHeight: 4, areaH: 40, areaBack: 4 };

/** The top of the capital letters: the name is centred on the map (a half of the map is 384). */
export const NAME_TOP = Math.round(384 - NAME_H / 2);

/** The baseline: capitals stand on it, and the tail of the g hangs below it. */
export const NAME_BASELINE = NAME_TOP + NAME_BOX.y1 * NAME_SCALE;

/** The name's footprint on the ground. */
export function nameRect() {
  return { x: NAME.cx - NAME.letters / 2, y: NAME_TOP, w: NAME.letters, h: NAME_H };
}

/** The name's zone: its footprint with a margin round it, so that it is easy to hover. */
export const NAME_ZONE_MARGIN = 10;
export function nameZone() {
  const r = nameRect();
  const m = NAME_ZONE_MARGIN;
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

const SLAB_IDS = ["email", "linkedin", "github"] as const;

/**
 * The slabs' row: its right edge is the top-right project's right edge (zones keep 48 px from the map's edge), and its top is 16
 * px down from the map's top. The top-right project sits lower than its slot (see world.ts), so that its cranes do not reach them.
 */
const SLAB_RIGHT = 768 - 48;
const SLAB_TOP = 16;

/** The top-left corners of the zones: the name's, and the three slabs' side by side (their areas touch, and do not overlap). */
export const FIXED_AT: Record<string, { x: number; y: number }> = {
  hub: { x: nameZone().x, y: nameZone().y },
  ...Object.fromEntries(
    SLAB_IDS.map((id, i) => [id, { x: SLAB_RIGHT - 3 * SLAB.w + i * SLAB.w, y: SLAB_TOP }])
  ),
};
