// Where the name stands: a stone tablet on a low plinth in the open yard, north of the contact plaques. World px, on the
// 768 px map. It sits clear of every project area (the Racing area ends at y = 272, the contact area starts at y = 312).
// Plain numbers only, so that world.ts can keep the yard tires off it without pulling in three.

export const NAME = {
  /** The centre line: the middle of the map. */
  cx: 384,
  /** The plinth's front (south) edge. */
  front: 300,
  /** How deep the plinth is, front to back. */
  depth: 16,
  /** The width the letters are scaled to. */
  letters: 288,
  /** Stone showing past the letters on each side. */
  pad: 10,
};

/** The plinth's footprint on the ground (the tablet leans back over its rear edge). */
export function nameRect() {
  const w = NAME.letters + 2 * NAME.pad;
  return { x: NAME.cx - w / 2, y: NAME.front - NAME.depth, w, h: NAME.depth };
}
