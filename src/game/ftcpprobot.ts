import { BoxGeometry, BufferGeometry, DoubleSide, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshToonMaterial, PlaneGeometry, Shape, Vector2 } from "three";
import { CONE, PP, PP_WAIT } from "./ftcfield";
import { pixelText } from "./ftctext";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";

// Team 6417's Power Play robot, at true scale: 14 in square on a field drawn at 1 px = 1.2 in, so the chassis is 11.67 px. Same
// conventions as ftcrobot.ts: 1 unit = 1 world px, origin at the chassis centre on the floor, +x = front, +z = the robot's right.
// A low chassis (four mecanum wheels hidden between an inner and an outer plate on each side, lead weights at the front) with a tall
// tinted back plate and small side plates round the electronics; drawer slides stand at the back and a blue carriage rides up them
// (the lift). On the carriage a turret swings the upper arm sideways; at the end of the arm is the pivot, and from it a forearm
// hangs down and forward to the claw, which pitches about the pivot. The claw (two blue jaws with black ribbed pads) opens and closes
// in its own horizontal plane and can roll a little about its own axis. Nested pivots posed each frame through `userData.pose`;
// the model has no timeline of its own: ppcycle.ts drives it.

const BLUE = "#2f8bdc"; // the printed parts
const DKBLUE = "#14224a"; // the plates the vinyl is on
const BLACK = "#16161b";
const PANEL = "#23252d";
const STEEL = "#aeb4c0";
const SILVER = "#c8ccd6";
const LEAD = "#7d818c";
const CYAN = "#38d6e8"; // the vinyl
const RED = "#d8322c";

/** What `userData.pose` is given each frame (see `PP` in ftcfield.ts for the layout). */
export interface PPPose {
  lift: number; // the height of the wrist's pivot
  yaw: number; // the turret: 0 = the arm straight ahead, positive = swung to the robot's right (radians)
  tilt: number; // the wrist: 0 = the claw level and pointing along the arm, 135 degrees = swung up and back, carrying
  twist: number; // the claw rolled about its own axis
  claw: number; // 0 = closed, 1 = open
  carrying: boolean; // a cone in the jaws
}

/** How far each jaw swings (radians) when the claw is fully open: the front gap (the chord between the tips) goes from about 4 to about 9 px, wider than the cone (4.8). */
const OPEN = (40 * Math.PI) / 180;

/** Wrist up and the claw open: how it waits. */
const PP_READY: PPPose = { ...PP_WAIT, carrying: false };

// ---------------------------------------------------------------- the arm's plates

/**
 * One plate of the upper arm in the arm's frame (x out from the turret axis, y up from the pivot's height). Its top edge is flat at
 * y = 1.2: the cone, swung up and back over the arm, hangs just above it (its lowest rim passes about 0.5 clear).
 */
const PLATE: [number, number][] = [[-1.2, -1.2], [PP.arm, -1.2], [PP.arm, 1.2], [-0.4, 1.2], [-1.2, 0.4]];
const PLATE_Z = 1.3; // the middle of each plate, either side of the arm's centre line
const PLATE_T = 0.5;
/** Where the standoffs between the plates are (x, y), clear of the forearm's swing and under the plates' top edge. */
const STANDOFFS: [number, number][] = [[1.1, 0.7], [2.3, 0.7], [3.2, 0.5]];

// ---------------------------------------------------------------- the cone

let coneGeo: BufferGeometry | null = null;
const sidedMats = new Map<string, MeshToonMaterial>();

/** The toon material for `color`, drawn from both sides, for thin shells whose inside shows (the cones, the claw's arcs). */
function sided(color: string): MeshToonMaterial {
  let mat = sidedMats.get(color);
  if (!mat) {
    mat = toon(color).clone();
    mat.side = DoubleSide;
    sidedMats.set(color, mat);
  }
  return mat;
}

/**
 * One hollow shell for every cone, like a traffic cone: a flared base ring, a wall that narrows to the top, and a hole at the top (a
 * pole passes through it); open at the wide end. Built from the profile of its wall, ring and lip, turned about the vertical.
 */
function coneShell(): BufferGeometry {
  if (!coneGeo) {
    const { h, base, top, ring, wall } = CONE;
    const inner = (r: number) => r - wall;
    const pts = [
      [ring, 0],
      [ring, 0.5],
      [base, 0.5],
      [top, h],
      [inner(top), h],
      [inner(base), 0.5],
      [inner(base), 0],
      [ring, 0],
    ];
    coneGeo = new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), 20);
  }
  return coneGeo;
}

/** A Power Play cone, standing with its wide end down: hollow, open at both ends. */
export function ppCone(color: string, x: number, y: number, z: number, scale = 1): Group {
  const g = new Group();
  g.add(mesh(coneShell(), sided(color))); // the inside shows through the open ends
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  return g;
}

// ---------------------------------------------------------------- the vinyl

/** "6417" large and "BLU" over "CRU", in the cyan vinyl, on the dark outer plate. */
function plateTexture() {
  const [c, ctx] = canvasOf(48, 14);
  fillRect(ctx, 0, 0, 48, 14, DKBLUE);
  pixelText(ctx, "6417", 2, 2, 2, CYAN);
  pixelText(ctx, "BLU", 36, 2, 1, CYAN);
  pixelText(ctx, "CRU", 36, 8, 1, CYAN);
  return nearestTexture(c);
}

/**
 * An arc of a ring about the vertical axis, between radii `r0` and `r1` and heights `y0` and `y1`, from `th0` to `th1` degrees measured
 * from straight ahead (+x) towards +z (negative angles go the other way).
 */
function arc(color: string, r0: number, r1: number, y0: number, y1: number, th0: number, th1: number): Mesh {
  const profile = [[r0, y0], [r1, y0], [r1, y1], [r0, y1], [r0, y0]].map(([x, y]) => new Vector2(x, y));
  const rad = Math.PI / 180;
  return mesh(new LatheGeometry(profile, Math.max(3, Math.ceil((th1 - th0) / 8)), (90 - th1) * rad, (th1 - th0) * rad), sided(color));
}

/** A mecanum wheel with its axle along z: black body, grey hub. */
function wheel(x: number, z: number): Group {
  const g = new Group();
  const body = cyl(1.65, 1.65, 1.2, "#17171c", 0, 0, 0, 12);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hub = cyl(0.8, 0.8, 1.4, SILVER, 0, 0, 0, 8);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  g.position.set(x, 1.65, z);
  return g;
}

export function ppRobotModel(): Group {
  const g = new Group();
  const HALF = PP.half;

  // ---- the chassis: the floor plate between the inner plates
  g.add(box(9.8, 0.4, 8.3, PANEL, -0.3, 0.5, 0)); // its top is at 0.9
  for (const sx of [-3.9, 3.9]) for (const sz of [-5, 5]) g.add(wheel(sx, sz));
  const outerTex = plateTexture();
  for (const s of [-1, 1]) {
    // every wheel sits between an outer plate (the one with the team's name) and an inner one, so it cannot be seen from either side;
    // the top of the pod stays open, with a few silver rods across it
    g.add(box(11.37, 3.3, 0.285, DKBLUE, 0.15, 0.3, s * (HALF - 0.1425)));
    g.add(box(11, 3.3, 0.25, DKBLUE, 0, 0.3, s * 4.275));
    for (const rx of [-4.4, -2.2, 0, 2.2, 4.4]) g.add(box(0.25, 0.3, 1.3, STEEL, rx, 3.6, s * 4.975));
    // between the wheels, dark structure: a deck, two motors on their sides, and C-channel brackets with a brace across them
    g.add(box(4.4, 0.3, 1.15, "#1b1d24", 0, 0.3, s * 4.975));
    for (const mx of [-1.1, 1.1]) {
      const motor = cyl(0.7, 0.7, 1.6, "#2a2d36", mx, 0, s * 4.975, 10);
      motor.rotation.z = Math.PI / 2;
      motor.position.y = 1.5;
      g.add(motor);
      g.add(box(0.15, 0.9, 0.9, "#3a3d48", mx + 0.85, 1.05, s * 4.975));
    }
    for (const bx of [-1.8, 0, 1.8]) g.add(box(0.25, 2.5, 1, "#3a3d48", bx, 0.6, s * 4.975));
    g.add(box(4, 0.25, 0.3, "#2a2d36", 0, 2.85, s * 4.975));
    const vinyl = new Mesh(new PlaneGeometry(11, 3), new MeshBasicMaterial({ map: outerTex }));
    vinyl.position.set(0.15, 1.95, s * (HALF + 0.02));
    if (s < 0) vinyl.rotation.y = Math.PI;
    g.add(vinyl);
  }
  g.add(box(0.5, 1.2, 7.2, "#1f4f9c", 4.65, 0.6, 0)); // the front bumper, kept narrow
  for (const s of [-1, 1]) g.add(box(2, 1, 1.8, LEAD, 3.8, 0.9, s * 2.3)); // the lead weights, either side of the arm's path

  // ---- the back: a tall tinted plate across it that stops 2.7 px above the floor over each wheel pod, so that the rear wheels show behind
  // it as they do in the photo; small vertical plates stand over the corners of the sides
  const glass = new MeshLambertMaterial({ color: "#1a2a55", transparent: true, opacity: 0.78, depthWrite: false });
  g.add(mesh(new BoxGeometry(0.3, 9, 8.3), glass, -HALF + 0.15, 0.9 + 4.5, 0)); // the middle, down to the floor plate
  for (const s of [-1, 1]) {
    g.add(mesh(new BoxGeometry(0.3, 6.3, HALF - 0.3 - 4.15), glass, -HALF + 0.15, 6.75, s * ((HALF - 0.3 + 4.15) / 2))); // over the pod
    g.add(mesh(new BoxGeometry(3.2, 6.3, 0.3), glass, -HALF + 1.6, 6.75, s * (HALF - 0.15))); // the corner plate, on the outer plate
  }
  g.add(box(0.6, 2.6, 2.8, BLACK, -5.2, 3.0, -3.9)); // the Control Hub, black, against the inside of the plate
  g.add(box(0.1, 1.4, 1.6, "#4a4d58", -4.88, 3.6, -3.9));
  g.add(box(3.2, 2.4, 1.8, PANEL, -3.4, 0.9, 3.4)); // the battery
  g.add(box(2, 0.4, 0.15, "#f2c230", -3.4, 2.4, 2.48));

  // ---- the lift: drawer slides, a pair at the back, three stages each that cascade up: the fixed one, a middle one and an inner one,
  // each a little narrower than the one outside it. Down they are one compact stack; up they share the travel equally.
  const stages: Group[] = [];
  const shades = [STEEL, SILVER, "#e2e5ec"];
  for (let k = 0; k < 3; k++) {
    const stage = new Group();
    for (const s of [-1, 1]) {
      stage.add(box(1.2 - 0.3 * k, PP.slide, 1 - 0.1 * k, shades[k], -4.2 + 0.3 * k, 0.9, s * 1.4));
      stage.add(box(0.15, PP.slide - 0.6, 1.1 - 0.1 * k, "#6d717e", -4.2 + 0.3 * k + 0.5 - 0.15 * k, 1.2, s * 1.4)); // a dark runner down its face
    }
    g.add(stage);
    stages.push(stage);
  }

  // the carriage rides the inner stage; its origin is the pivot's height, its foot `PP.carriage` below that
  const carriage = new Group();
  g.add(carriage);
  carriage.add(box(2.2, 4.5, 4.6, BLUE, -4.2, -PP.carriage, 0));
  carriage.add(box(1.4, 0.3, 3.2, "#0f1a33", -4.2, -PP.carriage + 4.5, 0));
  carriage.add(box(PP.turretX + 3.1, 1.25, 2.8, BLUE, (PP.turretX - 3.1) / 2, -PP.carriage, 0)); // the shoulder under the arm, out to the turret
  carriage.add(cyl(1.3, 1.3, 0.6, PANEL, PP.turretX, -1.85, 0, 12)); // the turret's servo

  // ---- the upper arm: two printed plates, one each side, deep at the shoulder and slimmer out to the pivot, held apart by standoffs; between
  // them at the pivot end hangs the forearm, and the round servo sits on the outer plate there (the part Kevin circled)
  const arm = new Group();
  arm.position.x = PP.turretX;
  carriage.add(arm);
  const outline = new Shape(PLATE.map(([x, y]) => new Vector2(x, y)));
  const plateGeo = new ExtrudeGeometry(outline, { depth: PLATE_T, bevelEnabled: false });
  for (const s of [-1, 1]) {
    const plate = mesh(plateGeo, toon(BLUE));
    plate.position.z = s > 0 ? PLATE_Z - PLATE_T / 2 : -PLATE_Z - PLATE_T / 2; // the extrusion runs from z = 0 to its depth
    arm.add(plate);
  }
  for (const [x, y] of STANDOFFS) {
    const rod = cyl(0.3, 0.3, 2 * PLATE_Z - PLATE_T, STEEL, x, y, 0, 8); // a standoff across, between the plates
    rod.rotation.x = Math.PI / 2;
    rod.position.set(x, y, 0);
    arm.add(rod);
    for (const s of [-1, 1]) {
      const head = cyl(0.45, 0.45, 0.15, SILVER, x, y, 0, 8); // and the screw head on each plate
      head.rotation.x = Math.PI / 2;
      head.position.set(x, y, s * (PLATE_Z + PLATE_T / 2 + 0.07));
      arm.add(head);
    }
  }
  arm.add(cyl(1, 1, 2.4, BLUE, 0, -1.2, 0, 12)); // the turret's end of the arm, between the plates
  // between the plates, under the standoffs, black servos, a gearbox and a cable block, so the arm looks solid from above as well as the side; all
  // kept under y = 0.2 so the standoffs and the cone swing clear over them
  const gap = PLATE_Z * 2 - PLATE_T - 0.1; // as wide as fits between the plates
  arm.add(box(1.8, 1.3, gap, BLACK, 1.5, -1.1, 0)); // the turret's servo
  arm.add(box(0.9, 0.1, gap - 0.4, "#4a4d58", 1.3, 0.2, 0)); // with its label
  arm.add(box(1, 1.1, gap, "#23252d", 3.1, -1.1, 0)); // a gearbox
  arm.add(box(1.6, 0.9, gap, BLACK, -0.2, -1.1, 0)); // and the cable block behind the turret
  // the pivot: one solid axle right through both plates, a bearing on each plate where it passes
  const across = (r: number, len: number, color: string, z: number, x = PP.arm) => {
    const c = cyl(r, r, len, color, x, 0, z, 14);
    c.rotation.x = Math.PI / 2;
    c.position.set(x, 0, z);
    arm.add(c);
  };
  const outer = PLATE_Z + PLATE_T / 2; // the plates' outer faces
  across(0.45, 2 * outer + 0.6, STEEL, 0); // the axle, ending just proud of the bearings
  for (const s of [-1, 1]) {
    across(0.9, 0.12, STEEL, s * (outer + 0.06)); // a flat steel bearing on each plate, hardly standing off it
    across(0.55, 0.2, "#6d717e", s * (outer + 0.1)); // with the axle's end in the middle
  }

  // ---- the wrist pitches the forearm and the claw about the pivot
  const gap2 = PLATE_Z * 2 - PLATE_T - 0.1;
  const tilt = new Group();
  tilt.position.set(PP.arm, 0, 0);
  arm.add(tilt);
  const palmX = PP.grip - 3.1; // the palm's centre, the forearm's end
  const len = Math.hypot(palmX, PP.drop);
  const forearm = new Group();
  forearm.rotation.z = Math.atan2(-PP.drop, palmX);
  const wrist = gap2; // the forearm fills the whole space between the bearings, plate to plate
  forearm.add(box(len, 1.4, wrist, BLUE, len / 2, -0.7, 0));
  const knuckle = cyl(1.1, 1.1, wrist, BLUE, 0, 0, 0, 14); // a round hub round the axle
  knuckle.rotation.x = Math.PI / 2;
  knuckle.position.set(0, 0, 0);
  forearm.add(knuckle);
  tilt.add(forearm);

  // ---- the claw hangs from the forearm's end and rolls about its own axis, through the middle of the jaws; its frame has x along the
  // jaws, y up, z across
  const twist = new Group();
  twist.position.set(PP.grip, -PP.drop, 0);
  tilt.add(twist);
  twist.add(box(0.6, 1.6, 4, BLUE, -3.1, -0.5, 0)); // the palm, well behind the cone's rim
  // the jaws are two curved arms, a ring round the cone with its front open: blue arcs with black ribbed pads on the inside. They meet the
  // palm behind, and each hinges there (at its rear end) and swings out to open the front wider than the cone
  const jaws: { g: Group; side: number }[] = [];
  const hinge = { x: 2.7 * Math.cos((165 * Math.PI) / 180), z: 2.7 * Math.sin((165 * Math.PI) / 180) };
  for (const s of [-1, 1]) {
    const jaw = new Group();
    const arcs = new Group(); // drawn about the ring's centre, offset so that the jaw's group origin is its hinge
    const [a0, a1] = s > 0 ? [55, 165] : [-165, -55];
    arcs.add(arc(BLUE, 2.65, 3, -0.4, 1, a0, a1));
    for (let i = 0; i < 5; i++) {
      const t0 = 60 + i * 21;
      arcs.add(arc(BLACK, 2.45, 2.65, -0.3, 0.9, s > 0 ? t0 : -(t0 + 16), s > 0 ? t0 + 16 : -t0)); // the ribs
    }
    arcs.position.set(-hinge.x, 0, -s * hinge.z);
    jaw.position.set(hinge.x, 0, s * hinge.z);
    jaw.add(arcs);
    twist.add(jaw);
    jaws.push({ g: jaw, side: s });
  }
  const held = ppCone(RED, 0, -PP.hold, 0); // the cone in the jaws: upright in the claw's frame, wide end down
  twist.add(held);

  const pose = (p: PPPose) => {
    const lift = Math.min(31, Math.max(3, p.lift));
    carriage.position.y = lift;
    stages.forEach((st, k) => (st.position.y = (k * (lift - PP.carriage - 1)) / 3)); // the inner stage reaches 2/3 of the way, the carriage the last third
    arm.rotation.y = -p.yaw;
    tilt.rotation.z = p.tilt;
    twist.rotation.x = p.twist;
    for (const { g: jaw, side } of jaws) jaw.rotation.y = -side * OPEN * p.claw;
    held.visible = p.carrying;
  };
  g.userData.pose = pose;
  pose(PP_READY);
  return g;
}
