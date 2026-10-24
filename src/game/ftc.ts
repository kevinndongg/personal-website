import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The FTC area: one square competition field split into three wedges, one per season, with the duck mascot, the driver
// station and the pit crew's things set around it. Positions are relative to the area's top-left corner, then shifted by
// (ox, oy) into world px. The size is kept in step with sceneSize("ftc") in scenes.ts.
//
// The field is drawn at 1 px = 1.2 in, so it is 120 px across (six 20 px foam tiles each way). Everything beside it is
// bigger than life, the way the rest of the map is. The three wedges meet at the centre, 120 degrees each, and run
// clockwise through the seasons: Power Play on the left, Center Stage at the top right, Into the Deep along the front.
// The floor is plain grey with a white tape line between the wedges. No robots yet: each wedge only has a taped square
// where its robot will start.

export const W = 168;
export const H = 204;

/** The field's top-left corner (area-local) and side. */
const FIELD = { x: 8, y: 22, size: 120 };

/**
 * The field's floor, relative to the field's centre (x east, y south): six by six foam tiles, a tape line from the centre
 * to each of the three wedge boundaries (the 30 degree rays meet the side walls at `K`), and the taped square where each
 * season's robot will start, on a tile that has no pole or element in it.
 */
const HALF = FIELD.size / 2;
const K = HALF * Math.tan(Math.PI / 6);
export const FLOOR = {
  size: FIELD.size,
  tiles: 6,
  tape: [
    [{ x: 0, y: 0 }, { x: 0, y: -HALF }],
    [{ x: 0, y: 0 }, { x: HALF, y: K }],
    [{ x: 0, y: 0 }, { x: -HALF, y: K }],
  ],
  marks: (
    [
      [-50, -30],
      [30, -30],
      [0, 16],
    ] as const
  ).map(([x, y]) => ({ x: x - 9, y: y - 9, w: 18, h: 18 })),
};

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
  /** A prop turned about its centre: with an angle, x/y is the centre already. */
  const turned = (sprite: string, c: { x: number; y: number }, angle: number, r: number): Prop => ({
    sprite,
    ...c,
    angle,
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
  props.push(block("ftc-backdrop", f(30, -55), 12, 8));
  // the truss lies across the middle of the third tile down in the right-hand column, its bars running left to right on
  // screen: the model is 12 wide and 20 long, turned a quarter so the length runs east-west
  props.push({ sprite: "ftc-truss", ...f(50, -10), angle: Math.PI / 2, solid: rect(12, 20) });
  props.push(round("ftc-drone", f(38, -46), 3));
  props.push(
    round("ftc-pixel-y", f(10, -24), 3),
    round("ftc-pixel-p", f(14, -42), 3),
    round("ftc-pixel-w", f(6, -34), 3),
    round("ftc-pixel-g", f(41, -54), 3)
  );

  // ---- Into the Deep (front wedge): the submersible in the middle, a basket in each front corner, samples along the front
  props.push(block("ftc-submersible", f(0, 36), 40, 14));
  // the baskets stand tight in the corners with their buckets towards the middle of the field
  props.push(turned("ftc-basket-red", f(-54, 54), -Math.PI / 4, 4), turned("ftc-basket-blue", f(54, 54), (-3 * Math.PI) / 4, 4));
  props.push(
    block("ftc-samples-red", f(-26, 52), 20, 4),
    block("ftc-samples-yellow", f(0, 52), 20, 4),
    block("ftc-samples-blue", f(26, 52), 20, 4)
  );
  // the robot (red alliance, so it works the red basket) parks on the taped start square facing south and runs its scoring
  // loop: round to the submersible's west end, where it faces east and scoops a sample off the floor through the open end;
  // then to the red basket in the corner, where it stops diagonally with its front to the north-east and its back to the
  // bucket, pivots the arm up to vertical, extends it upwards, leans it back over the top of the robot and tips the sample
  // in, so it never has to turn round; and home. See robotcycle.ts. The waypoints keep it clear of the submersible's corner
  // posts at x = -18.5 and of the samples along the front.
  props.push({
    ...turned("ftc-robot-itd", f(0, 16), Math.PI / 2, 6.25),
    cycle: {
      intake: { at: f(-27, 36), target: f(-8, 36) },
      score: { at: f(-44, 44), target: f(-50.9, 50.9), rim: 20 }, // the red basket's high bucket, in line behind the robot
      out: [f(-14, 17), f(-30, 22)],
      over: [f(-36, 40.5)],
      home: [f(-38, 32), f(-30, 22), f(-14, 17)],
    },
  });

  // ---- above the field: the match clock, centred, just behind the north wall
  props.push(block("ftc-scoreboard", at(cx, 10), 32, 8));

  // ---- beside the field, east: the mascot in the top right corner in its chair (turned towards the field and the
  // viewer), then the team banner and the trophy shelf below it
  props.push(turned("ftc-duck", at(150, 24), 2.1, 9));
  props.push(block("ftc-banner", at(150, 70), 10, 6), block("ftc-trophies", at(150, 112), 28, 10));

  // ---- below the field: the driver station, the tote of game pieces flush with the field's east wall, and the pit
  props.push(block("ftc-station", at(cx, 156), 44, 12));
  props.push(block("ftc-bin-pieces", at(120, 156), 22, 14)); // its right edge is the wall's outer face (x 131)
  props.push(block("ftc-pit", at(50, 188), 56, 14));
  props.push({ sprite: "laptop", ...at(36, 190), elevation: 7 }); // open on the pit table, screen towards the viewer
  props.push(block("toolchest", at(98, 190), 18, 12));

  // ---- the stored game pieces: a tight grid of stacks up against the field's south wall (its outer face is y 145), left
  // of the driver station. Tallest at the back, so every row shows over the one in front of it.
  const COLS = [11, 17.5, 24, 30.5];
  const stacks = (y: number, sprites: string[], make: (sprite: string, c: { x: number; y: number }) => Prop) =>
    sprites.map((sprite, i) => make(sprite, at(COLS[i], y)));
  props.push(
    ...stacks(148, ["ftc-cone-stack-red", "ftc-cone-stack-red", "ftc-cone-stack-blue", "ftc-cone-stack-blue"], (s, c) => round(s, c, 3)),
    ...stacks(
      154,
      ["ftc-sample-pile-red", "ftc-sample-pile-yellow", "ftc-sample-pile-yellow", "ftc-sample-pile-blue"],
      (s, c) => block(s, c, 4, 4)
    ),
    ...stacks(160, ["ftc-pixel-stack-y", "ftc-pixel-stack-p", "ftc-pixel-stack-w", "ftc-pixel-stack-g"], (s, c) => round(s, c, 2.7))
  );

  // ---- the floor: the tiles, tape and start squares are a model of their own (`FLOOR`) so that they rise with the rest of
  // the field when the project is hovered; ground paint would stay put. It has no footprint, so it never blocks anything,
  // and without one its model stands 2 px behind the y given here.
  const centre = f(0, 0);
  props.push({ sprite: "ftc-floor", x: centre.x, y: centre.y + 2 });
  const decals: Decal[] = [
    // a dark carpet under the whole area, a little inside the box border
    {
      kind: "pool",
      points: [at(6, 6), at(W - 6, 6), at(W - 6, H - 6), at(6, H - 6)],
      fill: "#2b3040",
      speckle: ["#353b4d", "#232733"],
    },
  ];

  const fieldBox = { x: ox + FIELD.x, y: oy + FIELD.y, w: FIELD.size, h: FIELD.size };
  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: fieldBox,
    labelAt: { x: ox + W / 2, y: oy + 14 },
    labelHeight: 40, // clear of the scoreboard under it
    height: 44, // the banner
    props,
    decals,
  };
}
