import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The DARPA Triage Challenge area: an airliner has come down. It slid in from the west across a scorched, gouged field and broke
// in three: the tail stopped first, the front section slid on, a wing and an engine came off (the engine is burning). Casualties
// lie about the wreck, each with a vest that is grey until something has looked at them. A drone flies a survey over the site every
// so often, its camera sweeping a circle on the ground, and a Spot robot walks out to one casualty, checks it over and walks back;
// whoever they see gets a box round them and a vest in their triage colour (green, yellow, red or black), which fades again after
// a while. A medical tent stands in the north-east, and the drone and the robot are parked beside it in the south-east.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px. The size is kept in step with
// sceneSize("dtc") in scenes.ts.

export const W = 208;
export const H = 144;

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

export function dtcScene(ox: number, oy: number): Scene {
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const props: Prop[] = [];

  // ---- the wreck. With an angle, x/y is the centre of the model and a rect footprint turns with it.
  props.push(
    { sprite: "dtc-tail", ...at(40, 72), angle: 0.45, solid: rect(40, 20) },
    { sprite: "dtc-fuselage", ...at(108, 70), angle: 0.05, solid: rect(62, 20) },
    { sprite: "dtc-wing", ...at(114, 114), angle: 0.15, solid: rect(16, 28) },
    { sprite: "dtc-engine", ...at(66, 110), angle: 0.9, solid: rect(11, 8) },
    // the fire at the engine's burnt end
    { sprite: "dtc-fire", ...at(62.5, 105.5) }
  );

  // ---- what fell out of it
  const debris = (kind: string, x: number, y: number, angle: number): Prop => ({ sprite: `dtc-debris-${kind}`, ...at(x, y), angle });
  props.push(
    debris("panel-0", 66, 86, 0.6),
    debris("panel-1", 20, 62, -0.2),
    debris("panel-2", 134, 94, 0.9),
    debris("panel-0", 150, 86, 1.4),
    debris("panel-1", 92, 122, 0.3),
    debris("panel-2", 30, 108, 2.2),
    debris("seat", 70, 60, 0.7),
    debris("seat", 72, 84, -0.4),
    debris("seat", 24, 86, 1.9),
    debris("case-r", 88, 50, 0.3),
    debris("case-b", 140, 128, 1.1),
    debris("case-g", 38, 114, 0.5),
    debris("case-r", 42, 104, 2.4),
    debris("wheel", 138, 100, 0)
  );

  // ---- the casualties, each lying where they were thrown. The key is the triage colour (g green, y yellow, r red, k black) and a number
  // for what they wear and how they lie (g1 waves). The robot walks out to the red one at (92, 96); the drone passes over all of them.
  const casualty = (key: string, x: number, y: number, angle: number): Prop => ({ sprite: `dtc-casualty-${key}`, ...at(x, y), angle });
  props.push(
    casualty("g0", 74, 96, 0.3),
    casualty("y0", 78, 52, -0.4),
    casualty("r0", 92, 96, 3.4),
    casualty("k0", 52, 96, 1.9),
    casualty("g1", 144, 50, 2.9),
    casualty("y2", 146, 116, 0.2),
    casualty("r1", 30, 96, -0.5)
  );

  // ---- the medical tent and its crew, in the north-east, with a few cones round the site
  props.push(
    { sprite: "tent", ...at(178, 48), solid: rect(24, 24) },
    { sprite: "person-w", ...at(160, 62), solid: circle(3) },
    { sprite: "person-r", ...at(170, 66), solid: circle(3) }
  );
  for (const [x, y] of [
    [156, 34],
    [162, 80],
    [156, 128],
    [120, 136],
    [84, 136],
    [48, 132],
    [16, 120],
    [16, 40],
    [60, 30],
    [130, 26],
  ])
    props.push({ sprite: "cone-o", ...at(x, y), solid: circle(3) });

  // ---- the drone, parked on its pad in the south-east, and the survey it flies: out over the casualties one after another, back over
  // the tail and the north side of the wreck, and home. (Its first and last points are the pad.)
  const pad = { x: 179, y: 113 };
  props.push({
    sprite: "dtc-drone",
    ...at(pad.x, pad.y),
    angle: 0,
    flight: [
      pad,
      { x: 156, y: 116 },
      { x: 130, y: 100 },
      { x: 98, y: 98 },
      { x: 76, y: 98 },
      { x: 54, y: 100 },
      { x: 32, y: 98 },
      { x: 46, y: 76 },
      { x: 62, y: 56 },
      { x: 78, y: 50 },
      { x: 110, y: 46 },
      { x: 142, y: 50 },
      { x: 170, y: 72 },
      pad,
    ].map((p) => at(p.x, p.y)),
  });

  // ---- the robot, parked beside it facing west, and its walk: along the south side of the front section, to where the red casualty is
  // just ahead of it
  props.push({
    sprite: "dtc-spot",
    ...at(152, 92),
    angle: Math.PI,
    patrol: [
      { x: 152, y: 92 },
      { x: 138, y: 92 },
      { x: 120, y: 92 },
      { x: 104, y: 92 },
    ].map((p) => at(p.x, p.y)),
  });

  // ---- the ground: the burnt field round the wreck, the furrow the plane cut as it came in from the west, and the drone's pad
  const decals: Decal[] = [
    {
      kind: "pool",
      points: [at(10, 48), at(70, 36), at(150, 42), at(170, 70), at(162, 112), at(100, 128), at(40, 118), at(12, 90)],
      fill: "#2c2a28",
      speckle: ["#38352f", "#211f1d"],
    },
    {
      kind: "pool",
      points: [at(6, 58), at(28, 60), at(40, 66), at(40, 84), at(26, 82), at(6, 76)],
      fill: "#4a3a2c",
      speckle: ["#5a4838", "#3a2c20"],
    },
    { kind: "frame", ...at(pad.x, pad.y), w: 30, h: 30, angle: 0, color: "#f4f4f4", fill: "#3a3e4a" },
  ];

  return {
    area: { x: ox, y: oy, w: W, h: H },
    building: { x: ox + 24, y: oy + 50, w: 134, h: 62 },
    labelAt: { x: ox + 100, y: oy + 24 },
    labelHeight: 52, // clear of the tail's fin and the smoke
    height: 56, // the smoke
    props,
    decals,
  };
}
