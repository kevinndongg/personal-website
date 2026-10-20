import { BUTTON_SIZE } from "./name";
import type { Decal, Prop, Scene } from "./scenes";

// One contact button: a big rounded-square button lying on the ground that opens a link when it is pressed. Each of the three
// (email, LinkedIn, GitHub) is a zone of its own, `id` says which. The area is the button itself, so hovering the button
// is hovering the zone (it rises and its ground brightens), and there is no card: world.ts places the three side by side.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.

export function contactScene(ox: number, oy: number, id: string): Scene {
  const S = BUTTON_SIZE;
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });

  // nothing is drawn on the ground around the button: no pad (its speckle covers the whole square it lies in) and no hover
  // glow, so the button stands on the plain yard
  const decals: Decal[] = [];

  // bottom-centre anchored, so y is the front edge of the footprint
  const props: Prop[] = [{ sprite: `button-${id}`, ...at(S / 2, S), solid: { kind: "rect", w: S, h: S } }];

  return {
    area: { x: ox, y: oy, w: S, h: S },
    building: { x: ox, y: oy, w: S, h: S },
    labelAt: { x: ox + S / 2, y: oy + S / 2 }, // (no label is shown for a link)
    labelHeight: 10,
    height: 8,
    hover: { lift: 3, glow: 0 }, // (the renderer doubles the lift: the button rises about 6 px)
    props,
    decals,
  };
}
