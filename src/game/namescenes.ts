import { SLAB, NAME, NAME_H, NAME_ZONE_MARGIN, nameZone } from "./name";
import type { Prop, Scene } from "./scenes";

// The two kinds of area here. Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.

/** The name's area: a project-like zone (it opens a card), with the letters standing in it. */
export function nameScene(ox: number, oy: number): Scene {
  const z = nameZone();
  const m = NAME_ZONE_MARGIN;
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  // bottom-centre anchored, so y is the footprint's front edge
  const footprint = { kind: "rect" as const, w: NAME.letters, h: NAME_H };
  const props: Prop[] = [
    { sprite: "kdname", ...at(z.w / 2, m + NAME_H), solid: footprint },
    // the pool of light on the ground that comes up under the letters when they are hovered (a flat prop of its own, see nameglow.ts)
    { sprite: "kdnameglow", ...at(z.w / 2, m + NAME_H), solid: footprint },
  ];
  return {
    area: { x: ox, y: oy, w: z.w, h: z.h },
    building: { x: ox + m, y: oy + m, w: NAME.letters, h: NAME_H },
    labelAt: { x: ox + z.w / 2, y: oy + m },
    labelHeight: 22,
    height: 14,
    // the letters rise on hover, and a soft oval pool of light comes up on the ground under them (nameglow.ts); no square patch of light
    hover: { glow: 0 },
    props,
    decals: [],
  };
}

/** One link slab: a link, so it opens its URL when it is pressed (no card), and its plate rises and brightens when it is hovered. */
export function slabScene(ox: number, oy: number, id: string): Scene {
  const { w, depth, areaH, areaBack } = SLAB;
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  // the footprint stands a little way in from the area's back edge; bottom-centre anchored, so y is its front edge
  const props: Prop[] = [{ sprite: `kdslab-${id}`, ...at(w / 2, areaBack + depth), solid: { kind: "rect", w, h: depth } }];
  return {
    area: { x: ox, y: oy, w, h: areaH },
    building: { x: ox, y: oy + areaBack, w, h: depth },
    labelAt: { x: ox + w / 2, y: oy + areaBack }, // (no label is shown for a link)
    labelHeight: 20,
    height: SLAB.height,
    // nothing rises or glows on the ground: the plate is the hover
    hover: { lift: 0, glow: 0 },
    props,
    decals: [],
  };
}
