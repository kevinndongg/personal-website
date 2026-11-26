import type { Decal, Footprint, Prop, Scene } from "./scenes";

// The DARPA Triage Challenge area: an airliner has come down. It slid in from the west across a scorched, gouged field and broke
// in three: the tail stopped first, the front section slid on, a wing and an engine came off (the engine is burning). Casualties
// lie about the wreck, each with a vest that is grey until something has looked at them. A drone flies a survey over the site every
// so often, its camera sweeping a circle on the ground, and a Spot robot walks out to one casualty, checks it over and walks back;
// whoever they see gets a box round them and a vest in their triage colour (green, yellow or red), which stays lit, with a ping round
// them, until a medic has been; a while after that they go grey again and the round starts over. A medical tent stands in the
// north-east, with two medics who go out to whoever has been found (red first), kneel to treat them and come back: finding people for
// the medics is what the project is about. The drone and the robot are parked in the south-east.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px. The size is kept in step with
// sceneSize("dtc") in scenes.ts.

export const W = 208;
export const H = 144;

const circle = (r: number): Footprint => ({ kind: "circle", r });
const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

/** Seconds the drone spends over each casualty. */
const HOLD = 3.4;

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

  // ---- the casualties, each lying where they were thrown. The key is the triage colour (g green: walking wounded, y yellow: can wait, r red:
  // needs help now) and a number for what they wear and how they lie (g1 waves). The robot walks out to the red one at (92, 96); the drone
  // passes over all of them. (The key also has k, black, for someone past help: there is none here.)
  const casualty = (key: string, x: number, y: number, angle: number): Prop => ({ sprite: `dtc-casualty-${key}`, ...at(x, y), angle });
  props.push(
    casualty("g0", 74, 96, 0.3),
    casualty("y0", 78, 52, -0.4),
    casualty("r0", 92, 96, 3.4),
    casualty("y1", 68, 72, 1.0), // thrown clear, between the tail and the front section
    casualty("g1", 144, 50, 2.9),
    casualty("y2", 146, 116, 0.2),
    casualty("r1", 30, 96, -0.5)
  );

  // ---- the medical tent, in the north-east, and its two medics. They go out to whoever the drone and the robot find (red first, then
  // yellow, then green), kneel to treat them and, if somebody else is waiting, go straight on to them; they only come back to the tent when
  // nobody is. They walk the site's paths: a few corridors round the wreck (south of the front section, north of the wing, down the east
  // side and round the south), each ending in a spot beside a casualty where the medic kneels.
  const NODES: Record<string, [number, number]> = {
    postA: [160, 62],
    postB: [170, 66],
    n0: [156, 56], // east of the nose
    e1: [158, 74],
    e2: [156, 88],
    e3: [158, 98],
    e4: [156, 108],
    s1: [134, 91.5], // the corridor between the front section and the wing
    s2: [112, 91.5],
    s3: [90, 90],
    v1: [80, 87],
    w1: [104, 98],
    n1: [160, 48], // north, past the wing's tip
    n2: [158, 36],
    n3: [146, 30],
    n4: [124, 27],
    n5: [100, 27],
    n6: [84, 34],
    b1: [150, 122], // round the south of the wing and the engine
    b2: [130, 134],
    b3: [98, 136],
    b4: [70, 130],
    b5: [48, 122],
    b6: [38, 108],
    x1: [92, 114],
    x2: [92, 128],
    // where a medic kneels
    standR0: [98, 102],
    standG0: [80, 91],
    standY1: [73, 80],
    standY0: [83, 46],
    standG1: [150, 54],
    standY2: [152, 112],
    standR1: [35, 102],
    // where the robot stands to scan them (on a different side from the medic) and its post, beside the drone's pad
    homeSpot: [152, 92],
    spotR0: [101, 93],
    spotG0: [70, 89],
    spotY1: [62, 64],
    spotY0: [89, 43],
    spotG1: [156, 46],
    spotR1: [28, 106],
    p1: [70, 46], // the way to the casualty in the gap, round the north-west of the front section
    p2: [62, 56],
  };
  const EDGES: [string, string][] = [
    ["postA", "postB"],
    ["postA", "n0"],
    ["postA", "n1"],
    ["postA", "e1"],
    ["postB", "e1"],
    ["n0", "e1"],
    ["n0", "n1"],
    ["n0", "standG1"],
    ["e1", "e2"],
    ["e2", "e3"],
    ["e3", "e4"],
    ["e4", "standY2"],
    ["e2", "s1"],
    ["s1", "s2"],
    ["s2", "s3"],
    ["s2", "w1"],
    ["w1", "standR0"],
    ["s3", "standG0"],
    ["s3", "v1"],
    ["v1", "standY1"],
    ["n1", "n2"],
    ["n2", "n3"],
    ["n3", "n4"],
    ["n4", "n5"],
    ["n5", "n6"],
    ["n6", "standY0"],
    ["e3", "b1"],
    ["b1", "b2"],
    ["b2", "b3"],
    ["b3", "b4"],
    ["b4", "b5"],
    ["b5", "b6"],
    ["b6", "standR1"],
    ["standR0", "x1"],
    ["x1", "x2"],
    ["x2", "b3"],
    ["homeSpot", "e2"],
    ["homeSpot", "s1"],
    ["s2", "spotR0"],
    ["s3", "spotR0"],
    ["v1", "spotG0"],
    ["standY0", "p1"],
    ["p1", "p2"],
    ["p2", "spotY1"],
    ["n6", "spotY0"],
    ["standY0", "spotY0"],
    ["n1", "spotG1"],
    ["n0", "spotG1"],
    ["b6", "spotR1"],
  ];
  const nodes = Object.fromEntries(Object.entries(NODES).map(([id, [x, y]]) => [id, at(x, y)]));
  const stand = (node: string, spotNode: string, cas: [number, number]) => {
    const c = at(cas[0], cas[1]);
    const facing = (id: string) => Math.atan2(c.y - nodes[id].y, c.x - nodes[id].x);
    return { at: c, node, face: facing(node), spot: { node: spotNode, face: facing(spotNode) } };
  };
  const calls = [
    stand("standR0", "spotR0", [92, 96]),
    stand("standG0", "spotG0", [74, 96]),
    stand("standY1", "spotY1", [68, 72]),
    stand("standY0", "spotY0", [78, 52]),
    stand("standG1", "spotG1", [144, 50]),
    stand("standY2", "b1", [146, 116]),
    stand("standR1", "spotR1", [30, 96]),
  ];
  props.push(
    { sprite: "tent", ...at(178, 48), solid: rect(24, 24) },
    { sprite: "dtc-medic", ...at(160, 62), angle: 2.4, medic: { home: "postA", nodes, edges: EDGES, calls } },
    { sprite: "dtc-medic", ...at(170, 66), angle: 2.0, medic: { home: "postB", nodes, edges: EDGES, calls } }
  );
  for (const [x, y] of [
    [150, 22],
    [170, 84],
    [156, 128],
    [120, 141],
    [84, 141],
    [48, 132],
    [16, 120],
    [16, 40],
    [60, 30],
    [112, 18],
  ])
    props.push({ sprite: "cone-o", ...at(x, y), solid: circle(3) });

  // ---- the drone, parked on its pad in the south-east. It flies slowly from casualty to casualty and stops over each one, locking its camera
  // on them, and then goes on: out over the south side, back along the north, and home to the pad (its first and last
  // points), for a moment, and again. It is always at work: the medics follow what it finds.
  const pad = { x: 179, y: 113 };
  props.push({
    sprite: "dtc-drone",
    ...at(pad.x, pad.y),
    angle: 0,
    flight: [
      pad,
      { x: 146, y: 116, hold: HOLD }, // each casualty it stops over is on the path itself
      { x: 120, y: 104 },
      { x: 92, y: 96, hold: HOLD },
      { x: 74, y: 96, hold: HOLD },
      { x: 30, y: 96, hold: HOLD },
      { x: 50, y: 86 },
      { x: 68, y: 72, hold: HOLD },
      { x: 78, y: 52, hold: HOLD },
      { x: 112, y: 44 },
      { x: 144, y: 50, hold: HOLD },
      { x: 172, y: 76 },
      pad,
    ].map(({ x, y, hold }) => ({ ...at(x, y), hold })),
  });

  // ---- the robot, parked beside the pad facing west. It is the team's scout: it goes to whoever the drone has found, scans them close up and,
  // having confirmed them, goes straight on to the next (see dtcflight.ts); it walks the same paths as the medics.
  props.push({
    sprite: "dtc-spot",
    ...at(152, 92),
    angle: Math.PI,
    scout: { home: "homeSpot", nodes, edges: EDGES, calls },
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
