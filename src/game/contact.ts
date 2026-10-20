import { BUTTON_SIZE } from "./name";
import type { Decal, Prop, Scene } from "./scenes";

// One contact button: a big round button lying on the ground that opens a link when it is pressed. Each of the three
// (email, LinkedIn, GitHub) is a zone of its own, `id` says which. The area is the button itself, so hovering the button
// is hovering the zone (it rises and its ground brightens), and there is no card: world.ts places the three side by side.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.

export function contactScene(ox: number, oy: number, id: string): Scene {
  const S = BUTTON_SIZE;
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });

  // a plain paved disc under the button, so it reads as a place of its own
  const ring = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return at(S / 2 + Math.cos(a) * (S / 2), S / 2 + Math.sin(a) * (S / 2));
  });
  const decals: Decal[] = [
    {
      kind: "pool",
      points: ring,
      fill: "#34353d",
      speckle: ["#3f4049", "#2b2c33"],
    },
  ];

  // bottom-centre anchored, so y is the front edge of the footprint
  const props: Prop[] = [{ sprite: `button-${id}`, ...at(S / 2, S), solid: { kind: "circle", r: S / 2 } }];

  return {
    area: { x: ox, y: oy, w: S, h: S },
    building: { x: ox, y: oy, w: S, h: S },
    labelAt: { x: ox + S / 2, y: oy + S / 2 }, // (no label is shown for a link)
    labelHeight: 10,
    height: 8,
    hover: { lift: 3 }, // (the renderer doubles it: the button rises about 6 px)
    props,
    decals,
  };
}
