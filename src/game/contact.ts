import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The contact area: three small plaques side by side, one mark each for email, LinkedIn and GitHub.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.

const W = 128;
const H = 144;

const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

export function contactScene(ox: number, oy: number): Scene {
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });

  // a plain paved pad under the signs, so the group reads as one place
  const decals: Decal[] = [
    {
      kind: "pool",
      points: [at(10, 44), at(W - 10, 44), at(W - 10, 100), at(10, 100)],
      fill: "#34353d",
      speckle: ["#3f4049", "#2b2c33"],
    },
  ];

  // the plaques: bottom-centre anchored, so y is the front edge of their 24-deep footprint
  const props: Prop[] = [{ sprite: "plaques", ...at(W / 2, 84), solid: rect(112, 24) }];

  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: { x: ox + 8, y: oy + 44, w: W - 16, h: 56 },
    labelAt: { x: ox + W / 2, y: oy + 64 },
    labelHeight: 36,
    height: 34,
    props,
    decals,
  };
}
