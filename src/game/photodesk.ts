import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The photography area: an Olympus OM-1 standing on a desk next to a light table with two strips of film.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.

const W = 224;
const H = 144;

const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

export function photoDeskScene(ox: number, oy: number): Scene {
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const props: Prop[] = [];
  const decals: Decal[] = [];

  // a dark desk mat under everything so the box reads as one surface
  decals.push({
    kind: "pool",
    points: [at(8, 8), at(W - 8, 8), at(W - 8, H - 8), at(8, H - 8)],
    fill: "#2f2d2c",
    border: "#16161d",
    speckle: ["#3a3735", "#262423"],
  });

  // the camera stands on the left with its lens toward the viewer (south); angle PI/2 turns its +x front to face +y
  props.push({ sprite: "omcamera", ...at(48, 74), angle: Math.PI / 2, solid: rect(32, 46) });
  // the light table on the right, two film strips on it
  props.push({ sprite: "lighttable", ...at(152, 124), solid: rect(120, 104) });

  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: { x: ox, y: oy, w: W, h: H },
    labelAt: { x: ox + 112, y: oy + 40 },
    labelHeight: 40,
    height: 34,
    props,
    decals,
  };
}
