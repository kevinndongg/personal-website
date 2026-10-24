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

/**
 * Where the arm is fixed and what it is made of (px). The cycle works out how to reach a point from these. The shoulder pivot
 * is at the back of the robot and, retracted, the slide lies flat along the deck pointing forward, so to intake it only has to
 * extend; to score it pivots up to vertical and then extends upwards.
 */
export const ARM = {
  x: -5, // the shoulder pivot, at the back of the chassis (behind its centre)
  y: 4.9, // and its height above the floor, just clear of the deck (its top is at 3.8)
  base: 6.5, // the length of the fixed stage of the slide (the second stage slides out of it)
} as const;

/**
 * The head hangs from the end of the slide: how far in front of the wrist pivot a sample sits on the scoop, and how far below
 * the pivot the scoop's underside is. The drop is what lets the scoop reach the floor from a slide lying level on the deck.
 */
export const HEAD = { reach: 2.4, drop: 3.7 } as const;

/**
 * Arm joints, in radians and px: the slide's pitch (0 = level forward, up positive, past pi/2 = leaning back over the robot),
 * how far it is extended, and the head's pitch in the world.
 */
export interface ArmPose {
  pitch: number;
  extend: number;
  /** 0 = the scoop level and pointing forward, pi = level and pointing back, negative / past pi = tipped nose down. */
  head: number;
  /** Turns the head over its length: 0 = the scoop's top side up; pi with `head` = pi keeps it up while it points backward. */
  roll: number;
}

/** What `userData.pose` is given each frame. */
export interface RobotPose extends ArmPose {
  spin: number; // the paddle wheel's angle
  carrying: boolean; // a sample on the scoop
}

const deg = (d: number) => (d * Math.PI) / 180;

/** The arm put away for driving: the slide retracted and lying flat along the deck, the head turned up at its front end. */
export const STOWED: ArmPose = { pitch: 0, extend: 0, head: deg(90), roll: 0 };

/** "6417" in white on the red plate, in a 3 x 5 pixel font. */
function plateTexture() {
  const digits: Record<string, string> = {
    "6": "011100111101111",
    "4": "101101111001001",
    "1": "010110010010111",
    "7": "111001010010010",
  };
  const [c, ctx] = canvasOf(20, 9);
  fillRect(ctx, 0, 0, 20, 9, RED);
  ctx.fillStyle = "#f4f4f4";
  [..."6417"].forEach((ch, n) => {
    for (let i = 0; i < 15; i++) if (digits[ch][i] === "1") ctx.fillRect(3 + n * 4 + (i % 3), 2 + Math.floor(i / 3), 1, 1);
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
  for (const sx of [-4.3, 4.3]) for (const sz of [-5.15, 5.15]) g.add(wheel(sx, sz)); // inside the side plates
  for (const s of [-1, 1]) {
    // the side: the red number plate over the rear wheel (its outer face is the robot's outer face), the black mesh over the front one
    g.add(box(5.9, 3.4, 0.4, RED, -3.1, 0.4, s * 6.05));
    g.add(box(6.2, 3.4, 0.4, BLACK, 3.05, 0.4, s * 6.05));
    const plate = new Mesh(new PlaneGeometry(5.2, 2.34), new MeshBasicMaterial({ map: plateTexture() }));
    plate.position.set(-3.1, 2.1, s * 6.27);
    if (s < 0) plate.rotation.y = Math.PI;
    g.add(plate);
    g.add(box(10.4, 1.8, 0.4, BLACK, 0, 3.8, s * 6.05)); // above them, the upper panel that carries the logos
    g.add(box(10.6, 0.5, 0.5, BLUE, 0, 5.6, s * 6)); // topped with a blue rail
    const logos = new Mesh(new PlaneGeometry(9, 1.5), new MeshBasicMaterial({ map: logoTexture() }));
    logos.position.set(0, 4.7, s * 6.27);
    if (s < 0) logos.rotation.y = Math.PI;
    g.add(logos);
  }
  g.add(box(10.8, 0.4, 10.6, "#2a2d36", 0, 3.4, 0)); // the deck: its top is at 3.8
  g.add(box(0.8, 3, 11.6, BLUE, HALF - 0.4, 0.8, 0)); // the front bumper plate
  g.add(box(1.8, 1.4, 10.4, BLUE, HALF - 1.1, 1, 0)); // the wide magnetic hang hook across the lower front
  g.add(box(0.15, 0.7, 3, "#b8bcc4", HALF + 0.05, 1.35, 0)); // with its silver label
  g.add(box(0.6, 3.2, 11.6, BLACK, -HALF + 0.3, 0.8, 0)); // the back: black mesh, with a blue bumper rail along its foot
  g.add(box(0.7, 0.8, 11.6, BLUE, -HALF + 0.35, 0.8, 0));
  g.add(box(0.4, 1.8, 10.6, BLACK, -HALF + 0.9, 4, 0));

  // ---- on the deck
  for (const s of [-1, 1]) g.add(box(3.2, 1.2, 1.8, "#2b2e38", -1.9, 3.8, s * 2.7)); // the electronics, either side of the arm
  g.add(box(0.4, 0.4, 0.4, "#4cd964", -0.8, 5, 2.7)); // a green status light
  g.add(box(3.4, 4.2, 0.15, "#e8eaee", -2.4, 3.8, -3.9)); // the white sheet, at one side
  g.add(hook(0.4, 2.7), hook(0.4, -2.7));

  // ---- the hang slides: two grey stacks with a blue plate on each, one each side near the front
  for (const s of [-1, 1]) {
    g.add(box(1.1, 11, 1.5, STEEL, 2.8, 3.8, s * 4.6));
    g.add(box(0.5, 8.5, 1.8, BLUE, 3.5, 4.6, s * 4.6));
    g.add(box(1.3, 0.8, 1.7, BLUE, 2.8, 14.8, s * 4.6));
  }

  // ---- the arm: two blue plates at the back of the deck holding the shoulder, a telescoping slide, a wrist and the head
  for (const s of [-1, 1]) g.add(box(3.4, 3.2, 0.5, BLUE, -4.6, 3.8, s * 1.7));
  const pulley = cyl(1.4, 1.4, 0.5, SILVER, 0, 0, 0, 12); // the big round pulley on the shoulder
  pulley.rotation.x = Math.PI / 2;
  pulley.position.set(ARM.x, ARM.y, 2.3);
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

  // the head: a blue housing, the paddle wheel with its black fingers, and the scoop (the blue plate that lies on the floor).
  // It turns over its own length (`roll`), so that on the way over the top of the robot the scoop keeps its sample on top.
  const head = new Group();
  wrist.add(head);
  head.add(box(2, HEAD.drop + 0.3, 2.6, BLUE, 0, -HEAD.drop + 0.3, 0)); // the housing hangs from the wrist down to the scoop
  head.add(box(3.8, 0.35, 2.2, BLUE, 2.1, -HEAD.drop, 0));
  head.add(box(0.4, 0.2, 0.8, "#bfe9ff", 3.8, -HEAD.drop - 0.2, 0)); // the light under the scoop's tip
  const paddle = new Group();
  paddle.position.set(0.9, -HEAD.drop + 1.5, 1.6);
  const hubMesh = cyl(0.6, 0.6, 0.6, SILVER, 0, 0, 0, 8);
  hubMesh.rotation.x = Math.PI / 2;
  paddle.add(hubMesh);
  for (let i = 0; i < 6; i++) {
    const finger = new Group(); // each finger points out from the hub at its own angle
    finger.rotation.z = (i * Math.PI) / 3;
    finger.add(box(0.35, 1, 0.5, "#111114", 0, 0.3, 0));
    paddle.add(finger);
  }
  head.add(paddle);
  const sample = box(3.8, 1.6, 1.6, YELLOW, 2.4, -HEAD.drop + 0.35, 0); // the sample on the scoop
  head.add(sample);

  const pose = (p: RobotPose) => {
    shoulder.rotation.z = p.pitch;
    stage2.position.x = p.extend;
    wrist.rotation.z = p.head - p.pitch;
    head.rotation.x = p.roll;
    paddle.rotation.z = p.spin;
    sample.visible = p.carrying;
  };
  g.userData.pose = pose;
  pose({ ...STOWED, spin: 0, carrying: false });
  return g;
}
