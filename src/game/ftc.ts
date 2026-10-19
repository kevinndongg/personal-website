import type { Decal, Footprint, Prop, Rect, Scene } from "./scenes";

// The FTC area: one square competition field split into three wedges, one per season, with the duck mascot, the driver
// station and the pit crew's things set around it. Positions are relative to the area's top-left corner, then shifted by
// (ox, oy) into world px. The size is kept in step with sceneSize("ftc") in scenes.ts.
//
// The field is drawn at 1 px = 1.2 in, so it is 120 px across (six 20 px foam tiles each way). Everything beside it is
// bigger than life, the way the rest of the map is. The three wedges meet at the centre, 120 degrees each, and run
// clockwise through the seasons: Power Play on the left, Center Stage at the top right, Into the Deep along the front.
// No robots yet: each wedge only has a taped square where its robot will start.

export const W = 176;
export const H = 224;

/** The field's top-left corner (area-local) and side. */
const FIELD = { x: 8, y: 22, size: 120 };

/** The three seasons, in order. `tint` colours the wedge on the floor and the header of its sign. */
export const SEASONS = {
  pp: { name: "POWER PLAY", years: "2022-23", tint: "#e0a43a" },
  cs: { name: "CENTER STAGE", years: "2023-24", tint: "#8a5ad0" },
  itd: { name: "INTO THE DEEP", years: "2024-25", tint: "#2fa7b8" },
} as const;

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

export function ftcScene(ox: number, oy: number): Scene {
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const half = FIELD.size / 2;
  const cx = FIELD.x + half;
  const cy = FIELD.y + half;
  /** A point of the field (relative to its centre, x east, y south) in world px. */
  const f = (x: number, y: number) => at(cx + x, cy + y);

  // Props are anchored at their bottom centre: a rect footprint's anchor is its front edge, a circle's the point r past
  // its centre. These take the footprint's centre instead, which is what the layout below is worked out in.
  const block = (sprite: string, c: { x: number; y: number }, w: number, d: number): Prop => ({
    sprite,
    x: c.x,
    y: c.y + d / 2,
    solid: rect(w, d),
  });
  const round = (sprite: string, c: { x: number; y: number }, r: number): Prop => ({
    sprite,
    x: c.x,
    y: c.y + r,
    solid: circle(r),
  });

  const props: Prop[] = [];

  // ---- the wall round the field: four low runs just outside the tiles
  props.push(
    block("ftc-wall", f(0, -half - 1.5), FIELD.size + 6, 3),
    block("ftc-wall", f(0, half + 1.5), FIELD.size + 6, 3),
    block("ftc-wall", f(-half - 1.5, 0), 3, FIELD.size),
    block("ftc-wall", f(half + 1.5, 0), 3, FIELD.size)
  );

  // ---- Power Play (left wedge): junction poles on the tile corners, cone stacks to feed them
  // The five-by-five junction pattern is ground / low / medium / high; only the columns that fall inside the wedge are here.
  const junctions: [number, number, string][] = [
    [-40, -40, "ftc-pp-g"],
    [-40, -20, "ftc-pp-l"],
    [-40, 0, "ftc-pp-g"],
    [-40, 20, "ftc-pp-l"],
    [-20, -40, "ftc-pp-l"],
    [-20, -20, "ftc-pp-m-red"], // a cone already on top
    [-20, 0, "ftc-pp-h-blue"],
  ];
  for (const [x, y, sprite] of junctions) props.push(round(sprite, f(x, y), 3));
  props.push(round("ftc-cones-red", f(-50, 10), 3), round("ftc-cones-blue", f(-30, 10), 3));

  // ---- Center Stage (top right wedge): the backdrop against the wall, the truss, the drone, loose pixels
  props.push(block("ftc-backdrop", f(22, -55), 44, 8));
  props.push(block("ftc-truss", f(50, -38), 4, 20));
  props.push(round("ftc-drone", f(38, -46), 3));
  props.push(
    round("ftc-pixel-y", f(10, -24), 3),
    round("ftc-pixel-p", f(14, -42), 3),
    round("ftc-pixel-w", f(6, -34), 3),
    round("ftc-pixel-g", f(44, -34), 3)
  );

  // ---- Into the Deep (front wedge): the submersible in the middle, a basket at each corner, samples along the front
  props.push(block("ftc-submersible", f(0, 36), 40, 14));
  props.push(round("ftc-basket-red", f(-46, 48), 5), round("ftc-basket-blue", f(46, 48), 5));
  props.push(
    block("ftc-samples-red", f(-26, 52), 20, 4),
    block("ftc-samples-yellow", f(0, 52), 20, 4),
    block("ftc-samples-blue", f(26, 52), 20, 4)
  );

  // ---- the signs along the back, one per season, in the colour of its wedge
  props.push(
    block("ftc-sign-pp", at(32, 12), 40, 3),
    block("ftc-sign-cs", at(76, 12), 40, 3),
    block("ftc-sign-itd", at(120, 12), 40, 3)
  );

  // ---- beside the field, east: the match clock, the team banner, the trophy shelf
  props.push(
    block("ftc-scoreboard", at(152, 34), 32, 8),
    block("ftc-banner", at(154, 70), 10, 6),
    block("ftc-trophies", at(152, 110), 28, 10)
  );

  // ---- in front of the field: the driver station, the mascot, the pit table and the spares
  props.push(block("ftc-station", at(cx, 156), 44, 12));
  // the duck in its chair, turned towards the field and the drivers
  props.push({
    sprite: "ftc-duck",
    ...at(26, 176),
    angle: -Math.PI / 2 + 0.35,
    solid: circle(9),
  });
  props.push(block("ftc-pit", at(50, 208), 56, 14));
  props.push({ sprite: "laptop", ...at(36, 210), elevation: 7 }); // open on the pit table, screen towards the viewer
  props.push(block("toolchest", at(98, 210), 18, 12));
  props.push(
    block("ftc-bin-parts", at(122, 170), 22, 14),
    block("ftc-bin-pieces", at(148, 170), 22, 14),
    block("ftc-bin-parts-b", at(122, 192), 22, 14)
  );

  // ---- the floor
  const k = half * Math.tan(Math.PI / 6); // where the 30 degree rays meet the side walls
  const centre = f(0, 0);
  const wedges = [
    { points: [centre, f(-half, k), f(-half, -half), f(0, -half)], tint: SEASONS.pp.tint },
    { points: [centre, f(0, -half), f(half, -half), f(half, k)], tint: SEASONS.cs.tint },
    { points: [centre, f(half, k), f(half, half), f(-half, half), f(-half, k)], tint: SEASONS.itd.tint },
  ];
  // the taped square where each season's robot will start, on a tile that has no pole or element in it
  const robot = (x: number, y: number): Rect => {
    const p = f(x, y);
    return { x: p.x - 9, y: p.y - 9, w: 18, h: 18 };
  };
  const decals: Decal[] = [
    // a dark carpet under the whole area, a little inside the box border
    {
      kind: "pool",
      points: [at(6, 6), at(W - 6, 6), at(W - 6, H - 6), at(6, H - 6)],
      fill: "#2b3040",
      speckle: ["#353b4d", "#232733"],
    },
    {
      kind: "field",
      ...at(FIELD.x, FIELD.y),
      size: FIELD.size,
      tiles: 6,
      wedges,
      tape: [
        [centre, f(0, -half)],
        [centre, f(half, k)],
        [centre, f(-half, k)],
      ],
      marks: [robot(-50, -30), robot(30, -30), robot(0, 16)],
    },
  ];

  const fieldBox = { x: ox + FIELD.x, y: oy + FIELD.y, w: FIELD.size, h: FIELD.size };
  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: fieldBox,
    labelAt: { x: ox + W / 2, y: oy + 14 },
    labelHeight: 34,
    height: 44, // the banner
    props,
    decals,
  };
}
