import type { Decal, Footprint, NavShape, Prop, Scene } from "./scenes";

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
    { sprite: "dtc-wing", ...at(122, 122), angle: 0.15, solid: rect(16, 28) },
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
  // needs help now) and a number for what they wear and how they lie (g1 waves); `angle` is the way their head points. `medic` is where a
  // medic kneels beside them and `robot` where the robot stands to scan them: the medic right beside them, the robot about 10 px from their
  // body (it never goes closer to a casualty than that: a robot near someone hurt is a danger to them).
  // (The key also has k, black, for someone past help: there is none here.)
  const CASUALTIES = [
    { key: "g0", x: 74, y: 96, angle: 0.3, medic: [74, 102], robot: [89, 88] },
    { key: "y0", x: 78, y: 52, angle: -0.4, medic: [77, 47], robot: [89, 39] },
    { key: "r0", x: 90, y: 103, angle: 3.4, medic: [89, 109], robot: [105, 95] },
    { key: "y1", x: 68, y: 72, angle: 1.0, medic: [72, 68], robot: [81, 83] }, // thrown clear, between the tail and the front section
    { key: "g1", x: 144, y: 50, angle: 2.9, medic: [146, 55], robot: [157, 61] },
    { key: "y2", x: 146, y: 116, angle: 0.2, medic: [146, 110], robot: [146, 101] },
    { key: "r1", x: 30, y: 96, angle: -0.5, medic: [32, 101], robot: [44, 104] },
  ] as const;
  props.push(...CASUALTIES.map((c): Prop => ({ sprite: `dtc-casualty-${c.key}`, ...at(c.x, c.y), angle: c.angle })));

  // ---- the medical tent, in the north-east, and its two medics. They go out to whoever the robot has confirmed (red first, then yellow, then
  // green), kneel to treat them and, if somebody else is waiting, go straight on to them; they only come back to the tent when nobody is.
  // The cones stand round the site.
  const CONES = [
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
  ];
  props.push({ sprite: "tent", ...at(178, 48), solid: rect(24, 24) });
  for (const [x, y] of CONES) props.push({ sprite: "cone-o", ...at(x, y), solid: circle(3) });

  // ---- the map the robot and the medics walk by: the ground, the things in their way (the wreck, the tent, the cones: the casualties' bodies
  // they know already), and the points they are parked at and go to. They find their own way between them, round everything.
  const ring = (x: number, y: number, r: number): NavShape => ({ kind: "circle", ...at(x, y), r });
  const slab = (x: number, y: number, w: number, h: number, angle = 0): NavShape => ({ kind: "rect", ...at(x, y), w, h, angle });
  const obstacles: NavShape[] = [
    slab(108, 70, 62, 20, 0.05), // the front section...
    ring(143, 70.5, 9.5), // ...and its nose, tapering
    ring(150.5, 71, 6.5),
    ring(156, 71.5, 3.5),
    slab(111, 51, 26, 22), // its north wing
    slab(112, 83, 24, 8), // and the stub of the south one
    slab(122, 122, 22, 30, 0.15), // the loose wing
    ring(66, 110, 6.5), // the engine
    ring(62, 105, 4), // and its fire
    slab(40, 72, 40, 20, 0.45), // the tail...
    slab(26, 65.3, 10, 28, 0.45), // ...and its tailplane
    slab(178, 36, 24, 24), // the tent
    ...CONES.map(([x, y]) => ring(x, y, 3)),
  ];
  const named: Record<string, [number, number]> = { postA: [160, 62], postB: [170, 66], homeSpot: [152, 92] };
  for (const c of CASUALTIES) {
    named[`${c.key}M`] = [c.medic[0], c.medic[1]];
    named[`${c.key}S`] = [c.robot[0], c.robot[1]];
  }
  const nodes = Object.fromEntries(Object.entries(named).map(([id, [x, y]]) => [id, at(x, y)]));
  const calls = CASUALTIES.map((c) => {
    const lies = at(c.x, c.y);
    const facing = (id: string) => Math.atan2(lies.y - nodes[id].y, lies.x - nodes[id].x);
    return { at: lies, angle: c.angle, node: `${c.key}M`, face: facing(`${c.key}M`), spot: { node: `${c.key}S`, face: facing(`${c.key}S`) } };
  });
  const plan = (home: string) => ({ home, nodes, area: { x: ox, y: oy, w: W, h: H }, obstacles, calls });
  props.push(
    { sprite: "dtc-medic", ...at(160, 62), angle: 2.4, medic: plan("postA") },
    { sprite: "dtc-medic", ...at(170, 66), angle: 2.0, medic: plan("postB") }
  );

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
      { x: 90, y: 103, hold: HOLD },
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
    scout: plan("homeSpot"),
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
