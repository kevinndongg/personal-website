import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, TorusGeometry } from "three";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";

// Team 6417's Into the Deep robot, at true scale: 15 in square on a field drawn at 1 px = 1.2 in, so the chassis is 12.5 px.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the chassis centre on the floor, +x = front (the end the
// arm and the intake reach out of; the red number plate is on the back). The hang mechanism, two grey slide stacks and two
// hooks, is only modelled. The arm is a set of nested pivots posed each frame through `userData.pose` (see `RobotPose`);
// the model has no timeline of its own: robotcycle.ts drives it.

const BLUE = "#2f8bdc"; // the robot's blue is brighter and more cyan than the team banner's
const BLACK = "#16161b";
const PANEL = "#23252d";
const STEEL = "#aeb4c0";
const STEEL_DK = "#8b909a";
const SILVER = "#c8ccd6";
const RED = "#d8322c";
const YELLOW = "#f2c230";

/** Where the arm is fixed and what it is made of (px). The cycle works out how to reach a point from these. */
export const ARM = {
  x: 1, // the shoulder pivot, forward of the chassis centre
  y: 5.5, // and its height above the floor
  base: 6.5, // the length of the fixed stage of the slide (the second stage slides out of it)
} as const;

/** The head: how far in front of the wrist pivot a sample sits on the scoop, and how far below the pivot the scoop's underside is. */
export const HEAD = { reach: 2.4, drop: 1.8 } as const;

/** Arm joints, in radians and px: the slide's pitch (0 = level forward, up positive), how far it is extended, and the pitch of the head in the world. */
export interface ArmPose {
  pitch: number;
  extend: number;
  head: number; // 0 = the scoop level, negative = tipped forward
}

/** What `userData.pose` is given each frame. */
export interface RobotPose extends ArmPose {
  spin: number; // the paddle wheel's angle
  carrying: boolean; // a sample on the scoop
}

const deg = (d: number) => (d * Math.PI) / 180;

/** The arm folded up for driving: the slide stands nearly upright in the middle of the deck, the head level at its top. */
export const STOWED: ArmPose = { pitch: deg(82), extend: 0, head: 0 };

/** "6417" in white on the red plate, in a 3 x 5 pixel font. */
function plateTexture() {
  const digits: Record<string, string> = {
    "6": "011100111101111",
    "4": "101101111001001",
    "1": "010110010010111",
    "7": "111001010010010",
  };
  const [c, ctx] = canvasOf(20, 6);
  fillRect(ctx, 0, 0, 20, 6, RED);
  ctx.fillStyle = "#f4f4f4";
  [..."6417"].forEach((ch, n) => {
    for (let i = 0; i < 15; i++) if (digits[ch][i] === "1") ctx.fillRect(2 + n * 4 + (i % 3), 0 + Math.floor(i / 3), 1, 1);
  });
  return nearestTexture(c);
}

/** White bars of different lengths along the black upper panel, for the sponsors' logos. */
function logoTexture() {
  const [c, ctx] = canvasOf(40, 8);
  fillRect(ctx, 0, 0, 40, 8, BLACK);
  ctx.fillStyle = "#e8eaee";
  for (const [x, w] of [[2, 6], [10, 9], [21, 5], [28, 9]] as const) ctx.fillRect(x, 2, w, 3);
  return nearestTexture(c);
}

/** A curved blue hook (a shepherd's crook): a stem, a half-circle and a short tail, standing on the deck and bending forward. */
function hook(x: number, z: number): Group {
  const h = new Group();
  h.add(box(0.7, 8, 0.5, BLUE, 0, 0, 0));
  const crook = mesh(new TorusGeometry(1.8, 0.35, 5, 10, Math.PI), toon(BLUE), 1.8, 8, 0);
  crook.scale.z = 0.7;
  h.add(crook);
  h.add(box(0.7, 2.4, 0.5, BLUE, 3.6, 5.6, 0));
  h.position.set(x, 3.8, z);
  return h;
}

/** A mecanum wheel with its axle along z: black body, yellow hub, dark rollers set around it. */
function wheel(x: number, z: number): Group {
  const g = new Group();
  const body = cyl(1.65, 1.65, 1.2, "#17171c", 0, 0, 0, 12);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hub = cyl(0.8, 0.8, 1.4, YELLOW, 0, 0, 0, 8);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  g.position.set(x, 1.65, z);
  return g;
}

export function robotModel(): Group {
  const g = new Group();
  const HALF = 6.25;

  // ---- the chassis
  g.add(box(11.6, 0.8, 10, PANEL, 0, 0.9, 0)); // the floor plate between the wheels
  for (const sx of [-4.3, 4.3]) for (const sz of [-5.6, 5.6]) g.add(wheel(sx, sz));
  for (const s of [-1, 1]) {
    g.add(box(10.2, 2.6, 0.3, BLACK, 0, 1, s * 4.9)); // the black mesh panels between the wheels
    g.add(box(10.4, 1.8, 0.3, BLACK, 0, 3.8, s * 5.4)); // and the upper panel that carries the logos
    g.add(box(10.6, 0.5, 0.6, BLUE, 0, 5.6, s * 5.4)); // topped with a blue rail
    const logos = new Mesh(new PlaneGeometry(9, 1.5), new MeshBasicMaterial({ map: logoTexture() }));
    logos.position.set(0, 4.7, s * 5.58);
    if (s < 0) logos.rotation.y = Math.PI;
    g.add(logos);
  }
  g.add(box(10.8, 0.4, 10.6, "#2a2d36", 0, 3.4, 0)); // the deck: its top is at 3.8
  g.add(box(0.8, 3, 11.6, BLUE, HALF - 0.4, 0.8, 0)); // the front bumper plate
  g.add(box(1.8, 1.4, 10.4, BLUE, HALF - 1.1, 1, 0)); // the wide magnetic hang hook across the lower front
  g.add(box(0.15, 0.7, 3, "#b8bcc4", HALF + 0.05, 1.35, 0)); // with its silver label
  g.add(box(0.6, 3.2, 11.6, RED, -HALF + 0.3, 0.8, 0)); // the back: a red plate over the rear mesh
  g.add(box(0.4, 1.8, 10.6, BLACK, -HALF + 0.9, 4, 0));
  const plate = new Mesh(new PlaneGeometry(9, 2.7), new MeshBasicMaterial({ map: plateTexture() }));
  plate.rotation.y = -Math.PI / 2; // faces backwards
  plate.position.set(-HALF - 0.02, 2.4, 0);
  g.add(plate);

  // ---- on the deck
  g.add(box(3.2, 1.4, 4.2, "#2b2e38", -2.8, 3.8, 0)); // the electronics
  g.add(box(0.4, 0.4, 0.4, "#4cd964", -1.2, 5.2, 1.3)); // a green status light
  const sheet = box(0.15, 5, 5.5, "#e8eaee", -1, 3.8, 0); // the white sheet behind the arm
  sheet.rotation.z = 0.25;
  g.add(sheet);
  g.add(hook(-3.2, 2.7), hook(-3.2, -2.7));

  // ---- the hang slides: two grey stacks with a blue plate on each, one each side near the front
  for (const s of [-1, 1]) {
    g.add(box(1.1, 11, 1.5, STEEL, 2.8, 3.8, s * 4.6));
    g.add(box(0.5, 8.5, 1.8, BLUE, 3.5, 4.6, s * 4.6));
    g.add(box(1.3, 0.8, 1.7, BLUE, 2.8, 14.8, s * 4.6));
  }

  // ---- the arm: a housing on the deck, then the shoulder, a telescoping slide, a wrist and the head
  g.add(box(4.4, 2, 5.4, BLUE, 0.8, 3.8, 0));
  for (const s of [-1, 1]) g.add(box(2.6, 3.4, 0.5, BLUE, 0.8, 3.8, s * 2.6));
  const pulley = cyl(1.4, 1.4, 0.5, SILVER, 0, 0, 0, 12); // the big round pulley on the shoulder
  pulley.rotation.x = Math.PI / 2;
  pulley.position.set(ARM.x, ARM.y, 3.1);
  g.add(pulley);

  const shoulder = new Group();
  shoulder.position.set(ARM.x, ARM.y, 0);
  g.add(shoulder);
  shoulder.add(box(ARM.base, 1.4, 1.6, STEEL_DK, ARM.base / 2, -0.7, 0)); // the fixed stage of the slide
  const stage2 = new Group(); // the stage that slides out
  shoulder.add(stage2);
  stage2.add(box(ARM.base, 1.1, 1.3, SILVER, ARM.base / 2, -0.55, 0));
  const wrist = new Group();
  wrist.position.x = ARM.base;
  stage2.add(wrist);

  // the head: a blue housing, the paddle wheel with its black fingers, and the scoop (the blue plate that lies on the floor)
  wrist.add(box(1.8, 1.6, 2.6, BLUE, -0.1, -0.9, 0));
  wrist.add(box(3.8, 0.35, 2.2, BLUE, 2.1, -HEAD.drop, 0));
  wrist.add(box(0.4, 0.2, 0.8, "#bfe9ff", 3.8, -HEAD.drop - 0.2, 0)); // the light under the scoop's tip
  const paddle = new Group();
  paddle.position.set(0.9, -0.5, 1.5);
  const hubMesh = cyl(0.6, 0.6, 0.6, SILVER, 0, 0, 0, 8);
  hubMesh.rotation.x = Math.PI / 2;
  paddle.add(hubMesh);
  for (let i = 0; i < 6; i++) {
    const finger = new Group(); // each finger points out from the hub at its own angle
    finger.rotation.z = (i * Math.PI) / 3;
    finger.add(box(0.35, 1, 0.5, "#111114", 0, 0.3, 0));
    paddle.add(finger);
  }
  wrist.add(paddle);
  const sample = box(3.8, 1.6, 1.6, YELLOW, 2.4, -HEAD.drop + 0.35, 0); // the sample on the scoop
  wrist.add(sample);

  const pose = (p: RobotPose) => {
    shoulder.rotation.z = p.pitch;
    stage2.position.x = p.extend;
    wrist.rotation.z = p.head - p.pitch;
    paddle.rotation.z = p.spin;
    sample.visible = p.carrying;
  };
  g.userData.pose = pose;
  pose({ ...STOWED, spin: 0, carrying: false });
  return g;
}
