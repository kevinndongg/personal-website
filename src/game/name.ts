// Where the name is: big raised letters lying flat in the open yard (clicking them opens a card about you), and below them a
// low slab of three link plates, one per link. World px, on the 768 px map, centred on it. It sits clear of every project
// area (the Racing area ends at y = 272, the gallery starts at y = 592). Plain numbers only, so that world.ts and scenes.ts can
// use it without pulling in three.
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
export const SLAB = { w: 60, depth: 38, height: 12, frontHeight: 5, areaH: 52, areaBack: 4 };

/** From the g's tail to the back of the slab. The sun is low, so its shadow runs about 1.3 px north for every px of height: this keeps a 12-tall slab's clear of the name. */
const GAP = 26;
const GROUP_H = NAME_H + GAP + SLAB.depth + (SLAB.areaH - SLAB.areaBack - SLAB.depth);

/** The top of the capital letters: the name and the slab, together, are centred on the map. */
export const NAME_TOP = Math.round(384 - GROUP_H / 2);

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

/** The back edge of the slab's footprint. */
export const SLAB_BACK = NAME_TOP + NAME_H + GAP;

const SLAB_IDS = ["email", "linkedin", "github"] as const;

/** The top-left corners of the zones: the name's, and the three slabs' side by side (their areas touch, and do not overlap). */
export const FIXED_AT: Record<string, { x: number; y: number }> = {
  hub: { x: nameZone().x, y: nameZone().y },
  ...Object.fromEntries(
    SLAB_IDS.map((id, i) => [id, { x: NAME.cx - (3 * SLAB.w) / 2 + i * SLAB.w, y: SLAB_BACK - SLAB.areaBack }])
  ),
};
