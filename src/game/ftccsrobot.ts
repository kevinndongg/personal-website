import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from "three";
import { markMoving } from "./bake";
import { CS, CS_WAIT, PIXEL_SIZE, csArm, csPixel } from "./ftcfield";
import { pixelMesh } from "./ftcpixel";
import { DUCK } from "./ftcpprobot";
import { pixelText } from "./ftctext";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";

// Team 6417's Center Stage robot, at true scale: 17 in square on a field drawn at 1 px = 1.2 in, so the chassis is 14.2 px. Same conventions
// as ftcpprobot.ts: 1 unit = 1 world px, origin at the chassis centre on the floor, +x = front, +y up, +z = the robot's right.
// A clear acrylic box (teal lettering, small yellow ducks and a cobblestone strip on its sides) with mecanum wheels inside. On the front an
// intake arm pivots down to take pixels in and up to drive; a roller with yellow fingers pulls them in, and a ramp inside carries them back
// to the bucket. At the back a slide of three stages leans back 30 degrees, parallel to the backdrop; at its top an arm swings through 30
// degrees, and on the arm a turret (up to 60 degrees each way) carries the bucket, a box with a slit down its middle, just long enough for two pixels one above the other and open at the bottom, with a lock
// (a knob through the slit into the lower pixel's hole). Nested pivots posed each frame through `userData.pose`; the model has no timeline of its own: cscycle.ts drives it.

const BLUE = "#2f8bdc"; // the printed parts
const BLACK = "#16161b";
const PANEL = "#23252d";
const STEEL = "#aeb4c0";
const SILVER = "#c8ccd6";
const TEAL = "#19b3a6"; // the vinyl and the roller
const YELLOW = "#f2c230"; // the fingers and the ducks
const GOLD = "#c9a227"; // the intake's motor
const RED = "#d8322c"; // the battery connector
const PIXEL = { y: "#f2c230", w: "#f4f4f4" };

/** What `userData.pose` is given each frame (see `CS` in ftcfield.ts for the layout). */
export interface CSPose {
  intake: number; // the intake arm: 0 = up, for driving, 1 = down, for taking pixels in
  spin: number; // how far the roller has turned (radians)
  slide: number; // how far the slide is extended (px), 0 .. CS.slide.travel
  arm: number; // the outtake arm and bucket, one piece turning about the slide's top: CS.arm.fold = resting flat inside the robot, 0 = swung back out of its back, at the deposit position
  turret: number; // the turret: 0 = the bucket straight, positive = swung to the robot's right (radians)
  gate: number; // the lock: 0 = its knob is in the lower pixel's hole, holding the pixels, 1 = drawn back
  yellow: number; // the yellow pixel: < 0 not on the robot, 0..1 on its way in over the floor and up the ramp, 1 = in the bucket
  white: number; // the white one, the same
  yellowLow: number; // 0 = the yellow pixel in the bucket's upper place, 1 = slid down to the lower one
}

const WAIT: CSPose = { ...CS_WAIT };

/** The path a pixel takes in, in the robot's frame (x, y): lying on the floor ahead, in through the intake, up the ramp, and into the bucket. */
const FLOOR_Y = 0.34; // the centre of a pixel on the floor sheet
const IN = { a: [CS.half + CS.ahead, FLOOR_Y], b: [CS.half - 1.7, 1.1], c: [3.4, 2.55] } as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/** A centred box inside a rotating group (the plain `box` sits on its y). */
function part(g: Group, w: number, h: number, d: number, color: string, x: number, y: number, z: number): Mesh {
  const m = box(w, h, d, color, x, y - h / 2, z);
  g.add(m);
  return m;
}

/** The lettering and three small ducks, on a transparent ground (they float on the clear plate above the bottom plate). 56 x 18 texels. */
function sideTexture() {
  const W = 56;
  const H = 18;
  const [c, ctx] = canvasOf(W, H);
  pixelText(ctx, "6417", 2, 1, 2, TEAL);
  pixelText(ctx, "BLU", 36, 1, 1, TEAL);
  pixelText(ctx, "CRU", 36, 7, 1, TEAL);
  ctx.fillStyle = YELLOW;
  for (const dx of [3, 14, 25]) {
    // a small duck: the bitmap sampled down to 8 x 7 texels
    for (let r = 0; r < 7; r++) for (let q = 0; q < 8; q++) if (DUCK[Math.floor((r * DUCK.length) / 7)][Math.floor((q * DUCK[0].length) / 8)] === "#") ctx.fillRect(dx + q, 10 + r, 1, 1);
  }
  return nearestTexture(c);
}

/**
 * The bottom side plate: a solid teal panel with a yellow cobblestone pattern, cells of irregular shape with teal lines between them (the nearest
 * of a jittered set of points to each texel, the same on every load). 112 x 24 texels.
 */
function plateTexture() {
  const W = 112;
  const H = 24;
  const [c, ctx] = canvasOf(W, H);
  fillRect(ctx, 0, 0, W, H, TEAL);
  let seed = 6417;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pts: [number, number][] = [];
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 16; gx++) pts.push([(gx + 0.2 + rnd() * 0.6) * 7 + (gy % 2) * 3.5, (gy + 0.2 + rnd() * 0.6) * 6]);
  ctx.fillStyle = YELLOW;
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      for (const [px, py] of pts) {
        const d = Math.hypot(x - px, (y - py) * 1.15);
        if (d < d1) [d1, d2] = [d, d1];
        else if (d < d2) d2 = d;
      }
      if (d2 - d1 > 1.4) ctx.fillRect(x, y, 1, 1);
    }
  }
  return nearestTexture(c);
}

/** The intake's side arms: a plate with a row of round holes, drawn with transparent holes. */
function perforated() {
  const [c, ctx] = canvasOf(40, 8);
  fillRect(ctx, 0, 0, 40, 8, BLUE);
  for (let x = 3; x < 38; x += 5) ctx.clearRect(x, 2, 2, 4);
  return nearestTexture(c);
}

/** A wheel is as wide as the gap it stands in: the pod between an outer plate and an inner plate is only just wider. */
const WHEEL_Z = 6.0;
const WHEEL_W = 1.5;

/** A mecanum wheel with its axle along z: black body, grey hub. */
function wheel(x: number, z: number): Group {
  const g = new Group();
  const body = cyl(1.5, 1.5, WHEEL_W, "#17171c", 0, 0, 0, 12);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0, 0);
  g.add(body);
  // the mecanum rollers round the rim, each set at 45 degrees to the axle, so the wheel reads as one from above
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5;
    const roller = mesh(new BoxGeometry(0.5, 0.55, WHEEL_W - 0.1), toon(k % 2 ? "#4a4d58" : "#2f323c"), Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0);
    roller.rotation.order = "ZXY";
    roller.rotation.z = a;
    roller.rotation.x = Math.PI / 4;
    g.add(roller);
  }
  const hub = cyl(0.8, 0.8, WHEEL_W + 0.1, SILVER, 0, 0, 0, 8);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0, 0);
  g.add(hub);
  const cap = cyl(0.35, 0.35, WHEEL_W + 0.2, "#7d818c", 0, 0, 0, 8); // the axle's end
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, 0, 0);
  g.add(cap);
  g.position.set(x, 1.65, z);
  return g;
}

export function csRobotModel(): Group {
  const g = new Group();
  const HALF = CS.half;
  const H = CS.height;

  // ---- the chassis: a floor plate, and the four mecanum wheels, each pair between an outer and an inner plate (clear acrylic edged in
  // aluminium, so they read from above), tied across the top of each pod by rods
  g.add(box(11.6, 0.4, 11.4, PANEL, -0.5, 0.5, 0)); // its top is at 0.9
  for (const sx of [-4.6, 4.2]) for (const sz of [-WHEEL_Z, WHEEL_Z]) g.add(wheel(sx, sz));
  const clear = new MeshLambertMaterial({ color: "#cfe9f2", transparent: true, opacity: 0.28, depthWrite: false });
  const inner = new MeshLambertMaterial({ color: "#b9dbe6", transparent: true, opacity: 0.45, depthWrite: false });
  const sideTex = sideTexture();
  const plateTex = plateTexture();
  const IN_Z = WHEEL_Z - WHEEL_W / 2 - 0.2; // the inner plates stand just inside the wheels, so each wheel is packed between its two plates
  const IN_H = 5.6;
  for (const s of [-1, 1]) {
    g.add(mesh(new BoxGeometry(2 * HALF, H - 0.3, 0.25), clear, 0, 0.3 + (H - 0.3) / 2, s * (HALF - 0.125))); // the outer plate
    const PLATE_TOP = 2.9; // the bottom side plate: a solid panel, proud of the clear plate, from the rear to just short of the intake's bay
    const plateLen = 2 * HALF - 1.2;
    g.add(box(plateLen, PLATE_TOP - 0.3, 0.15, TEAL, -0.6, 0.3, s * (HALF + 0.075)));
    const face = new Mesh(new PlaneGeometry(plateLen - 0.3, PLATE_TOP - 0.6), new MeshBasicMaterial({ map: plateTex }));
    face.position.set(-0.6, 0.3 + (PLATE_TOP - 0.3) / 2, s * (HALF + 0.16));
    if (s < 0) face.rotation.y = Math.PI;
    g.add(face);
    const vh = H - PLATE_TOP - 0.2; // the lettering above it, on the clear plate
    const vinyl = new Mesh(new PlaneGeometry((vh * 56) / 18, vh), new MeshBasicMaterial({ map: sideTex, transparent: true, depthWrite: false }));
    vinyl.position.set(0, PLATE_TOP + vh / 2 + 0.05, s * (HALF + 0.02));
    if (s < 0) vinyl.rotation.y = Math.PI;
    g.add(vinyl);
    part(g, 2 * HALF, 0.3, 0.45, STEEL, 0, H, s * (HALF - 0.22)); // the rim along the top of each outer plate
    g.add(mesh(new BoxGeometry(12.4, IN_H - 0.3, 0.25), inner, -0.4, 0.3 + (IN_H - 0.3) / 2, s * IN_Z)); // the inner plate
    part(g, 12.4, 0.3, 0.45, STEEL, -0.4, IN_H, s * IN_Z); // with its rim
    for (const rx of [-5.2, -2.6, 0, 2.6, 5.2]) part(g, 0.3, 0.3, HALF - 0.25 - IN_Z, STEEL, rx, IN_H - 0.15, s * ((HALF - 0.25 + IN_Z) / 2)); // rods across the pod
    // in each pod, between the wheels: a deck over the motors, with the electronics on it
    part(g, 3.4, 0.25, HALF - 0.25 - IN_Z - 0.3, "#2a2d36", -1.2, 3.6, s * ((HALF - 0.25 + IN_Z) / 2));
    for (const mx of [-1.9, -0.4]) {
      const motor = cyl(0.7, 0.7, 1.4, "#2a2d36", mx, 0, s * WHEEL_Z, 10);
      motor.rotation.x = Math.PI / 2;
      motor.position.set(mx, 2.1, s * WHEEL_Z);
      g.add(motor);
      part(g, 0.3, 1.4, 0.9, "#3a3d48", mx + 0.9, 2.4, s * WHEEL_Z);
    }
  }
  g.add(mesh(new BoxGeometry(0.25, H - 0.3, 2 * HALF), clear, HALF - 0.125, 0.3 + (H - 0.3) / 2, 0)); // the front
  g.add(box(0.5, 0.3, 2 * HALF, STEEL, HALF - 0.25, H - 0.15, 0)); // its rim
  // the electronics on the decks: the battery on the left, the control and expansion hubs on the right, wires across the ramp between them
  part(g, 3.2, 1.7, 1.4, PANEL, -1.2, 4.6, -WHEEL_Z);
  part(g, 2.2, 0.12, 0.8, YELLOW, -1.2, 5.5, -WHEEL_Z); // its strap
  part(g, 0.5, 0.5, 0.5, RED, 0.7, 4.1, -WHEEL_Z); // the connector
  part(g, 3.2, 0.5, 1.4, BLACK, -1.2, 3.95, WHEEL_Z); // the control hub
  part(g, 2.6, 0.08, 1.0, "#4a4d58", -1.2, 4.23, WHEEL_Z); // its label
  part(g, 3.2, 0.5, 1.4, "#1b1d24", -1.2, 4.5, WHEEL_Z); // the expansion hub stacked on it
  part(g, 0.5, 0.35, 0.5, TEAL, 0.2, 4.9, WHEEL_Z); // a power switch
  for (const wx of [-3.2, -2.4]) part(g, 0.14, 0.14, 2 * IN_Z + 0.6, BLACK, wx, 1.0, 0); // black wires and servo leads across, under the bucket

  // ---- the ramp: a plate from the intake's mouth up to the bucket, with rows of yellow fingers across it
  const ramp = new Group();
  ramp.position.set(IN.b[0], IN.b[1] - 0.45, 0);
  const rampLen = Math.hypot(IN.c[0] - IN.b[0], IN.c[1] - IN.b[1]);
  ramp.rotation.z = -Math.atan2(IN.c[1] - IN.b[1], IN.b[0] - IN.c[0]); // the ramp rises towards the back
  part(ramp, rampLen + 0.4, 0.25, 6.6, BLUE, -rampLen / 2, 0, 0); // the ramp is blue
  for (const s of [-1, 1]) part(ramp, rampLen + 0.4, 0.7, 0.25, BLUE, -rampLen / 2, 0.45, s * 3.2); // with a low wall down each side
  for (let i = 1; i < 4; i++) for (const z of [-2.4, -0.8, 0.8, 2.4]) part(ramp, 0.2, 0.7, 0.35, YELLOW, -(rampLen * i) / 4, 0.45, z);
  g.add(ramp);

  // ---- the intake arm: pivots about the axle low across the front that the bottom row of fixed yellow fingers is on; from it two perforated side
  // arms reach up to the roller with five curved fingers (down for taking pixels in, they lie forward along the floor; up, they stand nearly upright)
  const PIVOT = { x: HALF - 2.3, y: 1.8 };
  const L = 4.7;
  const ARM_Z = 3.55; // inboard of the inner plates, so the front wheels have the pods to themselves
  const intake = new Group();
  intake.position.set(PIVOT.x, PIVOT.y, 0);
  g.add(intake);
  const holes = new MeshBasicMaterial({ map: perforated(), transparent: true, side: DoubleSide, alphaTest: 0.5 });
  for (const s of [-1, 1]) {
    const arm = new Mesh(new PlaneGeometry(L + 1.2, 1.7), holes);
    arm.position.set(L / 2, 0, s * ARM_Z);
    intake.add(arm);
    part(intake, L + 1.2, 0.3, 0.3, BLUE, L / 2, 0.85, s * ARM_Z); // the edges that stiffen it
    part(intake, L + 1.2, 0.3, 0.3, BLUE, L / 2, -0.85, s * ARM_Z);
  }
  const axle = cyl(0.35, 0.35, 2 * ARM_Z + 0.6, STEEL, 0, 0, 0, 8);
  axle.rotation.x = Math.PI / 2;
  axle.position.set(0, 0, 0);
  intake.add(axle);
  const motor = cyl(0.8, 0.8, 1.6, GOLD, 0, 0, 0, 10); // the gold motor, on the outside of one arm at the roller's end
  motor.rotation.x = Math.PI / 2;
  motor.position.set(L, 0, ARM_Z + 1.1);
  intake.add(motor);
  const roller = new Group();
  roller.position.set(L, 0, 0);
  intake.add(roller);
  const drum = cyl(0.5, 0.5, 2 * ARM_Z, TEAL, 0, 0, 0, 10);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, 0, 0);
  roller.add(drum);
  // four yellow flippers on the roller, the same shape as the five on the bottom bar and standing between them (z = +-0.8, +-2.4 against their
  // 0, +-1.6, +-3.2): a short paddle out from the drum with its tip curled over
  for (const z of [-2.4, -0.8, 0.8, 2.4]) {
    part(roller, 1.1, 0.35, 0.45, YELLOW, 0.8, 0, z);
    part(roller, 0.35, 0.8, 0.45, YELLOW, 1.4, -0.3, z);
  }
  for (const s of [-1, 1]) part(intake, L - 1, 0.12, 0.12, BLACK, L / 2, 0.2, s * 2.2); // the black cords across the arms
  // the lower bar: five yellow flippers on the axle low at the front, short, with their tips curling up
  for (let k = -2; k <= 2; k++) {
    part(g, HALF + 0.3 - PIVOT.x, 0.3, 0.45, YELLOW, (PIVOT.x + HALF + 0.3) / 2, 0.4, k * 1.6);
    part(g, 0.35, 0.9, 0.45, YELLOW, HALF + 0.4, 0.75, k * 1.6);
  }
  part(g, 0.5, 0.5, 2 * ARM_Z, BLUE, PIVOT.x, 0.5, 0);

  // ---- the slide: three stages stacked side by side, one stack against each inner plate (the lowest stage fixed to the plate, the next beside it, and
  // the highest, which carries the arm, innermost), leaning back at CS.lean; the foot of the lowest is at CS.slide
  const slide = new Group();
  slide.name = "cs-slide";
  slide.position.set(CS.slide.x, CS.slide.y, 0);
  slide.rotation.z = CS.lean; // its local y runs up the slide, its local -x towards the backdrop
  g.add(slide);
  const stages: Group[] = [];
  const shades = [STEEL, SILVER, "#e2e5ec"];
  const stageZ = (k: number) => CS.slide.rails + (2 - k) * CS.slide.pitch;
  for (let k = 0; k < 3; k++) {
    const stage = new Group();
    const w = 1.2 - 0.1 * k;
    for (const s of [-1, 1]) {
      part(stage, w, CS.slide.len, CS.slide.pitch - 0.08, shades[k], 0, CS.slide.len / 2, s * stageZ(k));
      part(stage, 0.12, CS.slide.len - 0.6, CS.slide.pitch - 0.3, "#6d717e", -w / 2, CS.slide.len / 2, s * stageZ(k)); // a dark runner down its rear face
    }
    if (k === 2) {
      // the arm's pivot: an axle across between the two stacks, out behind the slide's rear face and down from the top of the highest stage, held by
      // an aluminium plate on the inner side of each highest stage that reaches back to it
      const px = -CS.pivot.out;
      const py = CS.slide.len + CS.pivot.along;
      const zi = stageZ(2) - CS.slide.pitch / 2 - 0.2; // the plate's middle, just inside the stage
      const hinge = cyl(0.3, 0.3, 2 * zi + 0.4, STEEL, 0, 0, 0, 8);
      hinge.rotation.x = Math.PI / 2;
      hinge.position.set(px, py, 0);
      stage.add(hinge);
      for (const s of [-1, 1]) {
        part(stage, -px + 1.0, 3.6, 0.35, "#c9ced6", (px - 0.8) / 2 + 0.1, CS.slide.len - 1.6, s * zi); // the plate
        part(stage, 1.0, 0.8, 0.6, STEEL, -0.2, CS.slide.len - 0.4, s * (zi + 0.2)); // and the bracket that joins it to the stage
      }
    }
    slide.add(stage);
    stages.push(stage);
  }
  for (const s of [-1, 1]) {
    for (const y of [1.2, 4.0]) part(slide, 1.4, 0.6, 0.5, STEEL, 0, y, s * (IN_Z - 0.0)); // clamps holding the lowest stage to the inner plate
    g.add(box(2.6, 0.1, 1.2, PANEL, CS.slide.x - 0.4, 0.9, s * (IN_Z - 0.55))); // and its foot on the chassis, under the stack
  }

  // ---- the arm on the top of the slide: its frame has local y up the bucket and -x out towards the backdrop
  const arm = new Group();
  arm.name = "cs-arm";
  g.add(arm);
  // the arm: a printed bar from the pivot out to the turret's servo on the bucket's back (hanging straight down at rest, where the pillar of it shows)
  part(arm, CS.arm.out - 0.9, 0.9, 3, BLUE, (1.5 - CS.arm.out) / 2, 0, 0);
  const servo = cyl(0.9, 0.9, 3.9, BLACK, 0, 0, 0, 10); // the arm's servo, on its hinge
  servo.rotation.x = Math.PI / 2;
  servo.position.set(0, 0, 0);
  arm.add(servo);
  const disc = cyl(1.3, 1.3, 0.35, BLUE, 0, 0, 0, 16); // the sprung wiring holder, a blue disc on the hinge's side
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0.3, 0.7, 2.15);
  arm.add(disc);

  // ---- the turret turns the bucket about the axis out of the arm's end (local x); the bucket hangs below it, a back plate with side rails,
  // a box with a slit down its middle, exactly the length of two pixels, open at the bottom, and a lock
  const turret = new Group();
  turret.position.set(-CS.arm.out, CS.arm.along, 0);
  arm.add(turret);
  const turretServo = cyl(1.0, 1.0, 0.8, BLACK, 0, 0, 0, 14);
  turretServo.rotation.z = Math.PI / 2;
  turretServo.position.set(1.2, 0, 0);
  turret.add(turretServo); // (the turret's own servo stays put)
  const top = CS.bucket.top;
  const bottom = CS.bucket.low + PIXEL_SIZE.corner / 2; // the lower pixel's lowest point: the bucket ends there, open, so the pixel falls out of it
  const len = top + bottom;
  const mid = (top - bottom) / 2;
  for (const s of [-1, 1]) {
    part(turret, 1.5, len, 0.35, BLUE, 0, mid, s * 1.95); // the sides
    part(turret, 0.35, len, 1.6, BLUE, 0.55, mid, s * 1.15); // the back, in two halves with a slit between them down the middle: the pixels show through it
    part(turret, 0.3, len, 1.6, BLUE, -0.6, mid, s * 1.15); // and the front the same, as near the board as the pixels already on it let it come
  }
  part(turret, 1.5, 0.35, 3.9, BLUE, 0, top - 0.17, 0); // the end over the upper pixel
  // the lock, on the back (on top when the bucket lies flat): a small servo with a knob that goes down through the slit into the hole of the
  // lower pixel and holds it by its centre
  const gate = new Group();
  gate.position.set(0.9, -CS.bucket.low, 0);
  const knob = cyl(0.3, 0.3, 1.2, STEEL, 0, 0, 0, 8);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(-0.45, 0, 0); // its tip is in the pixel's hole, at the bucket's middle
  gate.add(knob);
  part(gate, 0.8, 1.1, 1.6, BLACK, 0.5, 0, 0); // the lock's body, on top of the back plate
  turret.add(gate);

  // ---- the pixels: two on their way in over the floor and the ramp, and the same two in the bucket
  const pix = (color: string) => {
    const p = new Group();
    p.add(pixelMesh(color, -PIXEL_SIZE.thick / 2));
    return p;
  };
  const inside = { y: pix(PIXEL.y), w: pix(PIXEL.w) }; // in the robot's frame
  const held = { y: pix(PIXEL.y), w: pix(PIXEL.w) }; // in the turret's: lying with the extrusion towards the backdrop, points up and down
  for (const p of Object.values(inside)) g.add(p);
  for (const p of Object.values(held)) {
    p.children[0].rotation.y = Math.PI / 2; // points up and down, as on the backdrop's lattice
    p.rotation.z = Math.PI / 2; // its flat face to the backdrop (towards -x)
    turret.add(p);
  }

  const upper = csPixel(0, CS.arm.fold, 0, CS.bucket.high); // where the places are when the bucket is at rest, flat inside the robot
  const lower = csPixel(0, CS.arm.fold, 0, CS.bucket.low);

  // the way in, from the floor in front to the slot the pixel will take: (x, y, tilt) at `t` 0..1
  const route = (t: number, slot: [number, number]): [number, number, number] => {
    const ramp = Math.atan2(IN.c[1] - IN.b[1], IN.b[0] - IN.c[0]); // how steeply the ramp climbs towards the back
    const waypoints: [number, number, number][] = [
      [IN.a[0], IN.a[1], 0],
      [IN.b[0], IN.b[1] + 0.1, 0],
      [IN.c[0], IN.c[1] + 0.1, -ramp],
      [slot[0], slot[1], 0],
    ];
    const cuts = [0, 0.2, 0.5, 1];
    for (let i = 1; i < 4; i++) {
      if (t <= cuts[i]) {
        const u = ease((t - cuts[i - 1]) / (cuts[i] - cuts[i - 1]));
        const [x0, y0, a0] = waypoints[i - 1];
        const [x1, y1, a1] = waypoints[i];
        return [lerp(x0, x1, u), lerp(y0, y1, u), lerp(a0, a1, u)];
      }
    }
    return [slot[0], slot[1], 0];
  };

  const pose = (p: CSPose) => {
    // the intake: up (60 degrees above level) to down (level, the roller's fingers at the floor)
    intake.rotation.z = lerp((60 * Math.PI) / 180, 0, p.intake);
    roller.rotation.z = -p.spin;
    const e = Math.min(CS.slide.travel, Math.max(0, p.slide));
    stages.forEach((st, k) => (st.position.y = (k * e) / 2)); // the highest stage carries the arm's pivot, so it goes the whole way
    const a = csArm(e, p.arm);
    arm.position.set(a.hinge[0], a.hinge[1], 0);
    arm.rotation.z = CS.lean - p.arm;
    turret.rotation.x = -p.turret;
    gate.position.x = 0.9 + 1.1 * p.gate; // drawn back out of the pixel's hole
    // the pixels
    const place = (which: "y" | "w", t: number, slotUp: [number, number]) => {
      const fed = t >= 0 && t < 1;
      const inBucket = t >= 1;
      inside[which].visible = fed;
      held[which].visible = inBucket;
      if (fed) {
        const [x, y, tilt] = route(t, slotUp);
        inside[which].position.set(x, y, 0);
        inside[which].rotation.z = tilt;
      }
    };
    place("y", p.yellow, [upper[0], upper[1]]);
    place("w", p.white, [lower[0], lower[1]]);
    // in the bucket: the white sits low, the yellow high until it slides down to the lower place
    held.w.position.set(0, -CS.bucket.low, 0);
    held.y.position.set(0, -lerp(CS.bucket.high, CS.bucket.low, p.yellowLow), 0);
  };
  g.userData.pose = pose;
  pose(WAIT);
  markMoving(g, intake, roller, ...stages, arm, turret, gate, inside.y, inside.w, held.y, held.w);
  return g;
}
