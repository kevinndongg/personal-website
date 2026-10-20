import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The contact area: three big square buttons lying side by side on the ground, one mark each for email, LinkedIn and GitHub.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.

const W = 256;
const H = 96;
const BUTTON = 64; // each button is a square this big
const GAP = 20;
const ROW_W = 3 * BUTTON + 2 * GAP;
const TOP = 12; // from the area's top edge to the row of buttons

const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

export function contactScene(ox: number, oy: number): Scene {
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });

  // a plain paved pad under the buttons, so the group reads as one place
  const decals: Decal[] = [
    {
      kind: "pool",
      points: [at(4, 4), at(W - 4, 4), at(W - 4, H - 4), at(4, H - 4)],
      fill: "#34353d",
      speckle: ["#3f4049", "#2b2c33"],
    },
  ];

  // the row of buttons: bottom-centre anchored, so y is the front edge of their footprint
  const props: Prop[] = [{ sprite: "buttons", ...at(W / 2, TOP + BUTTON), solid: rect(ROW_W, BUTTON) }];

  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: { x: ox + (W - ROW_W) / 2, y: oy + TOP, w: ROW_W, h: BUTTON },
    labelAt: { x: ox + W / 2, y: oy + TOP + BUTTON / 2 },
    labelHeight: 14,
    height: 8,
    props,
    decals,
  };
}
