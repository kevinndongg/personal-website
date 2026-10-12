import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The default project area: a construction site, for every project that has no scene of its own yet.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px. The layout is seeded by
// the project id (it may be mirrored left-right, among other things) so the sites are not copies of each other.

const W = 160;
const H = 144;

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

/** A stable 32-bit number for a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32): the same seed always gives the same run of numbers in 0..1. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator for one named part of a site (a crane, a worker): a given seed and name always give the same numbers. */
export function siteRand(seed: number, name: string): () => number {
  return seeded(seed ^ hashString(name));
}

/** Whether a site's layout is flipped left-right. The scene and its models both ask, so they always agree. */
export function isMirrored(seed: number): boolean {
  return siteRand(seed, "mirror")() < 0.5;
}

export function constructionScene(ox: number, oy: number, id: string): Scene {
  const seed = hashString(id);
  const mirror = isMirrored(seed);

  /** A point of the area (as authored, unmirrored) in world px. */
  const at = (x: number, y: number) => ({ x: ox + (mirror ? W - x : x), y: oy + y });
  const quad = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];

  const decals: Decal[] = [
    // bare dirt over the asphalt, a little inside the box border
    {
      kind: "pool",
      points: quad(6, 20, W - 6, H - 6),
      fill: "#8a6d47",
      speckle: ["#9c7d52", "#76593a", "#a88a5e"],
    },
    // the slab the structure stands on
    {
      kind: "pool",
      points: quad(46, 58, 122, 114),
      fill: "#8d8f96",
      border: "#6d6f77",
      speckle: ["#9b9da4", "#7c7e86"],
    },
  ];

  // everything is anchored at its bottom centre, so y is the front edge of the footprint
  const props: Prop[] = [
    { sprite: "tcrane-a", ...at(30, 45), solid: rect(10, 10), seed }, // the tall one, at the back
    { sprite: "tcrane-b", ...at(128, 41), solid: rect(10, 10), seed },
    { sprite: "mcrane", ...at(137, 114), solid: rect(34, 12), seed }, // front right, its boom reaching in over the structure
    { sprite: "structure", ...at(84, 108), solid: rect(60, 46), seed },
    { sprite: "cabin", ...at(20, 112), solid: rect(28, 16), seed },
    { sprite: "pallet-a", ...at(44, 124), solid: rect(14, 9), seed },
    { sprite: "pallet-b", ...at(60, 126), solid: rect(14, 9), seed },
    { sprite: "fence", ...at(40, 133), solid: rect(60, 2), seed }, // two runs with the gate between them
    { sprite: "fence", ...at(124, 133), solid: rect(52, 2), seed },
    { sprite: "hazardsign", ...at(84, 129), solid: rect(14, 3), seed },
    // workers: a circle footprint puts the model 3 px above its y, so these y values are the start of each route + 3
    { sprite: "worker-a", ...at(14, 132), solid: circle(3), seed }, // paces the front, in front of the pallets
    { sprite: "worker-b", ...at(70, 124), solid: circle(3), seed }, // pallets to structure
    { sprite: "worker-c", ...at(50, 115), solid: circle(3), seed }, // a lap of the structure (starts at its front-left)
    { sprite: "worker-d", ...at(12, 123), solid: circle(3), seed }, // the foreman, below the cabin
    // three cones at the gate gap in the fence
    { sprite: "cone-o", ...at(74, 137), solid: circle(3), seed },
    { sprite: "cone-o", ...at(94, 137), solid: circle(3), seed },
    { sprite: "cone-o", ...at(84, 141), solid: circle(3), seed },
  ];

  // the label stands over the structure, between the two crane masts
  const structure = { x: ox + (mirror ? W - 114 : 54), y: oy + 62, w: 60, h: 46 };

  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: structure,
    labelAt: { x: ox + W / 2, y: oy + 70 },
    labelHeight: 62,
    height: 78, // the cranes: tall enough that the zoomed-in framing includes them
    props,
    decals,
  };
}
