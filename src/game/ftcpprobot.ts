import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { PP, PP_WAIT } from "./ftcfield";
import { centred } from "./ftctext";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";

// Team 6417's Power Play robot, at true scale: 14 in square on a field drawn at 1 px = 1.2 in, so the chassis is 11.67 px. Same
// conventions as ftcrobot.ts: 1 unit = 1 world px, origin at the chassis centre on the floor, +x = front, +z = the robot's right.
// A low chassis (four mecanum wheels in corner pods, open dark-blue side frames, lead weights at the front) with a tall black box
// at the back; drawer slides stand at the back and a blue carriage rides up them (the lift). On the carriage a turret swings the
// one-piece arm sideways; at its end an axle runs out to the wrist, which pitches the claw about an axis across the arm, and
// the claw (two blue jaws with black ribbed pads) opens and closes in its own horizontal plane. Nested pivots posed each frame
// through `userData.pose`; the model has no timeline of its own: ppcycle.ts drives it.

const BLUE = "#2f8bdc"; // the printed parts
const DKBLUE = "#1f4f9c"; // the side frames
const BLACK = "#16161b";
const PANEL = "#23252d";
const TINT = "#1c2230"; // the tinted-black box at the back
const STEEL = "#aeb4c0";
const SILVER = "#c8ccd6";
const LEAD = "#7d818c";
const CYAN = "#38d6e8"; // the vinyl
const ORANGE = "#e8742a";
const RED = "#d8322c";

/** What `userData.pose` is given each frame (see `PP` in ftcfield.ts for the layout). */
export interface PPPose {
  lift: number; // the height of the wrist axis
  yaw: number; // the turret: 0 = the arm straight ahead, positive = swung to the robot's right (radians)
  tilt: number; // the wrist: 0 = the claw level and pointing along the arm, 90 degrees = pointing up, 135 = carrying
  twist: number; // the claw rolled about its own axis
  claw: number; // 0 = closed, 1 = open
  carrying: boolean; // a cone in the jaws
}

/** Wrist up and the claw open: how it waits. */
const PP_READY: PPPose = { ...PP_WAIT, carrying: false };

/** A Power Play cone, standing: a truncated cone with a flat top (the opening a pole passes through) and a flared base ring. */
export function ppCone(color: string, x: number, y: number, z: number, scale = 1): Group {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(1.1 * scale, 2.5 * scale, PP.coneH * scale, 14), toon(color), 0, (PP.coneH / 2) * scale, 0));
  g.add(cyl(2.9 * scale, 2.9 * scale, 0.5 * scale, color, 0, 0, 0, 14));
  g.position.set(x, y, z);
  return g;
}

/** "BLU CRU" over "6417", in the cyan vinyl, on the dark side plate. */
function plateTexture() {
  const [c, ctx] = canvasOf(28, 16);
  fillRect(ctx, 0, 0, 28, 16, "#14224a");
  centred(ctx, 28, "BLU CRU", 2, 1, CYAN);
  centred(ctx, 28, "6417", 9, 1, CYAN);
  return nearestTexture(c);
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

  // ---- the chassis
  g.add(box(9.4, 0.4, 8, PANEL, -0.5, 0.5, 0)); // the floor plate between the side frames (its top is at 0.9)
  for (const sx of [-3.9, 3.9]) for (const sz of [-5.15, 5.15]) g.add(wheel(sx, sz));
  for (const s of [-1, 1]) {
    // the open ladder side frame: a foot rail, a top rail, posts, and a rod across each wheel
    g.add(box(11, 0.35, 0.4, DKBLUE, 0, 0.7, s * 5.6));
    g.add(box(11, 0.35, 0.4, DKBLUE, 0, 3.5, s * 5.6));
    for (const px of [-5.3, -2.3, 2.3, 5.3]) g.add(box(0.4, 3.2, 0.4, DKBLUE, px, 0.7, s * 5.6));
    for (const wx of [-3.9, 3.9]) g.add(box(2.6, 0.25, 0.3, DKBLUE, wx, 2.5, s * 5.6));
    // between the wheels, the side plate with the team's name
    g.add(box(4.4, 2.8, 0.3, "#14224a", 0, 0.8, s * 5.7));
    const plate = new Mesh(new PlaneGeometry(4.2, 2.4), new MeshBasicMaterial({ map: plateTexture() }));
    plate.position.set(0, 2.2, s * 5.86);
    if (s < 0) plate.rotation.y = Math.PI;
    g.add(plate);
  }
  g.add(box(0.5, 1.2, 7.2, DKBLUE, 4.65, 0.6, 0)); // the front bumper, kept narrow
  for (const s of [-1, 1]) g.add(box(2, 1, 1.8, LEAD, 3.8, 0.9, s * 2.3)); // the lead weights, either side of the arm's path

  // at the back, one side: the tall tinted-black box with the Control Hub on top, the ultrasonic sensor behind it and the sponsors' vinyl
  g.add(box(6, 7, 2.2, TINT, -2.8, 0.9, -3.7));
  g.add(box(2.6, 0.5, 1.5, ORANGE, -2.2, 7.9, -3.7));
  g.add(box(1.4, 0.2, 1, BLACK, -2.2, 8.4, -3.7));
  g.add(box(1, 1.6, 1.6, BLUE, -6.3, 3.2, -3.7)); // the sensor's housing, poking out of the back
  g.add(box(0.2, 0.7, 0.7, "#bfe9ff", -6.85, 3.65, -3.7));
  for (const [y, w] of [[5.6, 4.4], [4.4, 3]] as const) {
    g.add(box(w, 0.5, 0.15, CYAN, -2.8, y, -2.55));
    g.add(box(w, 0.5, 0.15, CYAN, -2.8, y, -4.85));
  }
  g.add(box(3.6, 2.4, 1.8, PANEL, -2.8, 0.9, 3.5)); // the battery, on the other side
  g.add(box(2, 0.4, 0.15, "#f2c230", -2.8, 2.4, 2.58));

  // ---- the lift: drawer slides, a pair at the back, three stages each that cascade up: the fixed one, a middle one and an inner one,
  // each a little narrower than the one outside it. Down they are one compact stack; up they share the travel equally.
  const stages: Group[] = [];
  const shades = [STEEL, SILVER, "#e2e5ec"];
  for (let k = 0; k < 3; k++) {
    const stage = new Group();
    for (const s of [-1, 1]) {
      stage.add(box(1.2 - 0.3 * k, PP.slide, 1 - 0.1 * k, shades[k], -5 + 0.3 * k, 0.9, s * 1.4));
      stage.add(box(0.15, PP.slide - 0.6, 1.1 - 0.1 * k, "#6d717e", -5 + 0.3 * k + 0.5 - 0.15 * k, 1.2, s * 1.4)); // a dark runner down its face
    }
    g.add(stage);
    stages.push(stage);
  }

  // the carriage rides the inner stage: its foot is at the wrist's height
  const carriage = new Group();
  g.add(carriage);
  carriage.add(box(2.2, 3.4, 4.6, BLUE, -5, 0, 0));
  carriage.add(box(1.4, 0.3, 3.2, "#0f1a33", -5, 3.4, 0));
  carriage.add(cyl(1.5, 1.5, 0.9, PANEL, PP.turretX, 0.2, 0, 12)); // the turret's servo

  // ---- the arm is one piece down the middle, swinging about the turret: a beam to a servo block, and from the block the wrist's axle
  // runs out sideways to the claw, which hangs beside the arm (so that it can swing right over the top without meeting it)
  const arm = new Group();
  arm.position.x = PP.turretX;
  carriage.add(arm);
  arm.add(cyl(1.3, 1.3, 1.4, BLUE, 0, 1, 0, 12));
  arm.add(box(PP.arm, 1.4, 1.2, BLUE, PP.arm / 2, 1, 0));
  arm.add(box(1.7, 2.8, 1.2, BLUE, PP.arm - 0.35, -0.4, 0)); // the wrist's servo block at its end
  arm.add(box(1.2, 0.8, 0.4, PANEL, PP.arm, 2, 0.7));
  const axle = cyl(0.4, 0.4, PP.offset, STEEL, PP.arm, 0, PP.offset / 2 + 0.4, 8);
  axle.rotation.x = Math.PI / 2;
  axle.position.y = 0;
  arm.add(axle);

  // ---- the wrist pitches the claw, and the claw rolls about its own axis; its frame has x along the jaws, y up, z across
  const tilt = new Group();
  tilt.position.set(PP.arm, 0, PP.offset);
  arm.add(tilt);
  const twist = new Group();
  tilt.add(twist);
  twist.add(box(0.6, 1.6, 4, BLUE, 0.3, -0.5, 0)); // the palm, well behind the cone's rim
  const jaws: { g: Group; side: number }[] = [];
  for (const s of [-1, 1]) {
    const jaw = new Group();
    jaw.add(box(4.4, 1.4, 0.4, BLUE, 2.2, -0.4, 0));
    jaw.add(box(2.4, 1.2, 0.25, BLACK, 2.8, -0.3, -s * 0.325)); // the black rubber pad on the inside
    for (const rx of [2.2, 2.8, 3.4]) jaw.add(box(0.1, 1.2, 0.1, "#3a3a44", rx, -0.3, -s * 0.5)); // and its ribs
    jaw.position.x = 0.6;
    twist.add(jaw);
    jaws.push({ g: jaw, side: s });
  }
  const held = ppCone(RED, PP.grip, -PP.hold, 0); // the cone in the jaws: upright in the claw's frame, wide end towards the palm's level
  twist.add(held);

  const pose = (p: PPPose) => {
    const lift = Math.min(27, Math.max(1, p.lift));
    carriage.position.y = lift;
    stages.forEach((st, k) => (st.position.y = (k * (lift - 1)) / 3)); // the inner stage reaches 2/3 of the way, the carriage the last third
    arm.rotation.y = -p.yaw;
    tilt.rotation.z = p.tilt;
    twist.rotation.x = p.twist;
    for (const { g: jaw, side } of jaws) {
      jaw.position.z = side * (2.65 + 0.5 * p.claw);
      jaw.rotation.y = -side * 0.2 * p.claw;
    }
    held.visible = p.carrying;
  };
  g.userData.pose = pose;
  pose(PP_READY);
  return g;
}
