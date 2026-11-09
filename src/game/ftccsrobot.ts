import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from "three";
import { markMoving } from "./bake";
import { CS, CS_WAIT, PIXEL_SIZE, csArm, csPixel, csWrist } from "./ftcfield";
import { pixelMesh } from "./ftcpixel";
import { DUCK } from "./ftcpprobot";
import { pixelText } from "./ftctext";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";

// Team 6417's Center Stage robot, at true scale: 17 in square on a field drawn at 1 px = 1.2 in, so the chassis is 14.2 px. Same conventions
// as ftcpprobot.ts: 1 unit = 1 world px, origin at the chassis centre on the floor, +x = front, +y up, +z = the robot's right.
// A clear acrylic box (teal lettering, small yellow ducks and a cobblestone strip on its sides) with mecanum wheels inside. On the front an
// intake arm pivots down to take pixels in and up to drive; a roller with yellow fingers pulls them in, and a ramp inside carries them back
// to the bucket. At the back a slide of three stages leans back 30 degrees, parallel to the backdrop; at its top an arm swings through 30
// degrees, and on the arm a turret (up to 60 degrees each way) carries the bucket, a closed box with a slit down its middle that holds two pixels one above the other, with a lock
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
  arm: number; // the outtake arm: CS.arm.fold = folded forward and down, 0 = swung back, up and over the slide, at the deposit position
  bucket: number; // the bucket's own turn: 0 = lying flat inside the robot, 1 = hanging parallel to the backdrop (60 degrees on)
  turret: number; // the turret: 0 = the bucket straight, positive = swung to the robot's right (radians)
  gate: number; // the lock: 0 = its knob is in the lower pixel's hole, holding the pixels, 1 = drawn back
  yellow: number; // the yellow pixel: < 0 not on the robot, 0..1 on its way in over the floor and up the ramp, 1 = in the bucket
  white: number; // the white one, the same
  yellowLow: number; // 0 = the yellow pixel in the bucket's upper place, 1 = slid down to the lower one
}

const WAIT: CSPose = { ...CS_WAIT };

/** The path a pixel takes in, in the robot's frame (x, y): lying on the floor ahead, in through the intake, up the ramp, and into the bucket. */
const FLOOR_Y = 0.34; // the centre of a pixel on the floor sheet
const IN = { a: [CS.half + CS.ahead, FLOOR_Y], b: [CS.half - 1.7, 1.1], c: [3.4, 2.3] } as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/** A centred box inside a rotating group (the plain `box` sits on its y). */
function part(g: Group, w: number, h: number, d: number, color: string, x: number, y: number, z: number): Mesh {
  const m = box(w, h, d, color, x, y - h / 2, z);
  g.add(m);
  return m;
}

/** The lettering, three small ducks and the cobblestone strip (jittered cells in yellow and teal, the same on every load), on a transparent ground. */
function sideTexture() {
  const W = 56;
  const H = 24;
  const [c, ctx] = canvasOf(W, H);
  // the lettering and the ducks float on the clear plate, so everything but them stays transparent
  pixelText(ctx, "6417", 2, 3, 2, TEAL);
  pixelText(ctx, "BLU", 36, 3, 1, TEAL);
  pixelText(ctx, "CRU", 36, 9, 1, TEAL);
  ctx.fillStyle = YELLOW;
  for (const dx of [3, 14, 25]) {
    // a small duck: the bitmap sampled every sixth texel
    DUCK.forEach((row, y) => {
      if (y % 6 !== 2) return;
      for (let x = 0; x < row.length; x += 6) if (row[x] === "#") ctx.fillRect(dx + x / 6, 11 + (y - 2) / 6, 1, 1);
    });
  }
  // the cobblestone strip along the bottom: cells of yellow and teal and gaps between them
  let seed = 6417;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let x = 0; x < W; ) {
    const w = 2 + Math.floor(rnd() * 3);
    ctx.fillStyle = rnd() < 0.55 ? YELLOW : TEAL;
    ctx.fillRect(x, H - 4 + Math.floor(rnd() * 2), w, 3);
    x += w + 1;
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

/** A mecanum wheel with its axle along z: black body, grey hub. */
function wheel(x: number, z: number): Group {
  const g = new Group();
  const body = cyl(1.65, 1.65, 1.3, "#17171c", 0, 0, 0, 12);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hub = cyl(0.8, 0.8, 1.5, SILVER, 0, 0, 0, 8);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
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
  for (const sx of [-4.6, 4.2]) for (const sz of [-5.1, 5.1]) g.add(wheel(sx, sz));
  const clear = new MeshLambertMaterial({ color: "#cfe9f2", transparent: true, opacity: 0.28, depthWrite: false });
  const inner = new MeshLambertMaterial({ color: "#b9dbe6", transparent: true, opacity: 0.45, depthWrite: false });
  const sideTex = sideTexture();
  const IN_Z = 3.9; // the inner plates stand this far either side of the middle, just inside the wheels
  const IN_H = 5.6;
  for (const s of [-1, 1]) {
    g.add(mesh(new BoxGeometry(2 * HALF, H - 0.3, 0.25), clear, 0, 0.3 + (H - 0.3) / 2, s * (HALF - 0.125))); // the outer plate
    const vinyl = new Mesh(new PlaneGeometry(2 * HALF - 1, ((2 * HALF - 1) * 24) / 56), new MeshBasicMaterial({ map: sideTex, transparent: true, depthWrite: false }));
    vinyl.position.set(0, 0.3 + (H - 0.3) / 2, s * (HALF + 0.02));
    if (s < 0) vinyl.rotation.y = Math.PI;
    g.add(vinyl);
    part(g, 2 * HALF, 0.3, 0.45, STEEL, 0, H, s * (HALF - 0.22)); // the rim along the top of each outer plate
    g.add(mesh(new BoxGeometry(12.4, IN_H - 0.3, 0.25), inner, -0.4, 0.3 + (IN_H - 0.3) / 2, s * IN_Z)); // the inner plate
    part(g, 12.4, 0.3, 0.45, STEEL, -0.4, IN_H, s * IN_Z); // with its rim
    for (const rx of [-5.2, -2.6, 0, 2.6, 5.2]) part(g, 0.3, 0.3, HALF - 0.25 - IN_Z, STEEL, rx, IN_H - 0.15, s * ((HALF - 0.25 + IN_Z) / 2)); // rods across the pod
    // in each pod, between the wheels: a deck over the motors, with the electronics on it
    part(g, 4.8, 0.25, HALF - 0.25 - IN_Z - 0.3, "#2a2d36", -0.2, 3.6, s * ((HALF - 0.25 + IN_Z) / 2));
    for (const mx of [-1.3, 0.9]) {
      const motor = cyl(0.7, 0.7, 1.7, "#2a2d36", mx, 0, s * 5.2, 10);
      motor.rotation.x = Math.PI / 2;
      motor.position.set(mx, 2.1, s * 5.2);
      g.add(motor);
      part(g, 0.3, 1.4, 1, "#3a3d48", mx + 0.9, 2.4, s * 5.2);
    }
  }
  g.add(mesh(new BoxGeometry(0.25, H - 0.3, 2 * HALF), clear, HALF - 0.125, 0.3 + (H - 0.3) / 2, 0)); // the front
  g.add(box(0.5, 0.3, 2 * HALF, STEEL, HALF - 0.25, H - 0.15, 0)); // its rim
  // the electronics on the decks: the battery on the left, the control and expansion hubs on the right, wires across the ramp between them
  part(g, 3.2, 1.7, 1.9, PANEL, -0.4, 4.6, -5.6);
  part(g, 2.0, 0.12, 0.8, YELLOW, -0.4, 5.5, -5.6); // its strap
  part(g, 0.6, 0.5, 0.5, RED, 1.4, 4.1, -5.6); // the connector
  part(g, 3.0, 0.5, 2.0, BLACK, -0.4, 3.95, 5.6); // the control hub
  part(g, 2.6, 0.08, 1.2, "#4a4d58", -0.4, 4.23, 5.6); // its label
  part(g, 3.0, 0.5, 2.0, "#1b1d24", -0.4, 4.5, 5.6); // the expansion hub stacked on it
  part(g, 0.6, 0.35, 0.5, TEAL, 1.3, 4.9, 5.6); // a power switch
  for (const wx of [-3.2, -2.4]) part(g, 0.14, 0.14, 2 * IN_Z + 0.6, BLACK, wx, 1.5, 0); // black wires and servo leads across, under the bucket

  // ---- the ramp: a plate from the intake's mouth up to the bucket, with rows of yellow fingers across it
  const ramp = new Group();
  ramp.position.set(IN.b[0], IN.b[1] - 0.45, 0);
  const rampLen = Math.hypot(IN.c[0] - IN.b[0], IN.c[1] - IN.b[1]);
  ramp.rotation.z = -Math.atan2(IN.c[1] - IN.b[1], IN.b[0] - IN.c[0]); // the ramp rises towards the back
  part(ramp, rampLen + 0.4, 0.25, 6.6, BLUE, -rampLen / 2, 0, 0); // the ramp is blue
  for (const s of [-1, 1]) part(ramp, rampLen + 0.4, 0.7, 0.25, BLUE, -rampLen / 2, 0.45, s * 3.2); // with a low wall down each side
  for (let i = 1; i < 4; i++) for (const z of [-2.4, -0.8, 0.8, 2.4]) part(ramp, 0.2, 0.7, 0.35, YELLOW, -(rampLen * i) / 4, 0.45, z);
  g.add(ramp);

  // ---- the intake arm: pivots about an axle across the front, two perforated side arms and between them the roller with five curved fingers
  const PIVOT = { x: HALF - 1.5, y: 6.2 };
  const L = 5.8;
  const intake = new Group();
  intake.position.set(PIVOT.x, PIVOT.y, 0);
  g.add(intake);
  const holes = new MeshBasicMaterial({ map: perforated(), transparent: true, side: DoubleSide, alphaTest: 0.5 });
  for (const s of [-1, 1]) {
    const arm = new Mesh(new PlaneGeometry(L, (L * 8) / 40), holes);
    arm.position.set(L / 2, 0, s * 4.6);
    intake.add(arm);
    part(intake, L, 0.4, 0.3, BLUE, L / 2, 0.9, s * 4.6); // the edges that stiffen it
    part(intake, L, 0.4, 0.3, BLUE, L / 2, -0.9, s * 4.6);
  }
  const axle = cyl(0.35, 0.35, 10.4, STEEL, 0, 0, 0, 8);
  axle.rotation.x = Math.PI / 2;
  axle.position.set(0, 0, 0);
  intake.add(axle);
  const motor = cyl(0.8, 0.8, 1.6, GOLD, 0, 0, 0, 10); // the gold motor, on the outside of one arm at the pivot
  motor.rotation.x = Math.PI / 2;
  motor.position.set(0.6, 0.2, 5.8);
  intake.add(motor);
  const roller = new Group();
  roller.position.set(L, 0, 0);
  intake.add(roller);
  const drum = cyl(0.7, 0.7, 8.6, TEAL, 0, 0, 0, 10);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, 0, 0);
  roller.add(drum);
  for (let k = 0; k < 5; k++) {
    const finger = new Group();
    finger.rotation.z = (k * 2 * Math.PI) / 5;
    part(finger, 1.1, 0.35, 8.2, YELLOW, 1.1, 0, 0); // a finger reaches out along the roller's whole length, curling over at its tip
    part(finger, 0.4, 0.8, 8.2, YELLOW, 1.55, -0.25, 0);
    roller.add(finger);
  }
  for (const s of [-1, 1]) part(intake, L - 1, 0.12, 0.12, BLACK, L / 2, 0.2, s * 2.2); // the black cords across the arms
  // the lower bar: five yellow fingers on a fixed bar low at the front, curling up, under the roller
  for (let k = -2; k <= 2; k++) {
    part(g, 2.4, 0.3, 0.45, YELLOW, HALF + 1, 0.4, k * 1.8);
    part(g, 0.4, 1.1, 0.45, YELLOW, HALF + 2.1, 0.8, k * 1.8);
  }
  part(g, 0.5, 0.5, 10, BLUE, HALF - 0.1, 0.5, 0);

  // ---- the slide: three stages, a pair of rails each, leaning back at CS.lean; the foot of the lowest is at CS.slide
  const slide = new Group();
  slide.position.set(CS.slide.x, CS.slide.y, 0);
  slide.rotation.z = CS.lean; // its local y runs up the slide, its local -x towards the backdrop
  g.add(slide);
  const stages: Group[] = [];
  const shades = [STEEL, SILVER, "#e2e5ec"];
  for (let k = 0; k < 3; k++) {
    const stage = new Group();
    for (const s of [-1, 1]) {
      part(stage, 1.2 - 0.3 * k, CS.slide.len, 1 - 0.1 * k, shades[k], 0.3 * k, CS.slide.len / 2, s * CS.slide.rails);
      part(stage, 0.15, CS.slide.len - 0.6, 1.1 - 0.1 * k, "#6d717e", 0.3 * k + 0.5 - 0.15 * k, CS.slide.len / 2, s * CS.slide.rails); // a dark runner down its face
    }
    if (k === 0) part(stage, 0.6, 0.5, 2 * CS.slide.rails, "#6d717e", 0, 0.5, 0); // a cross-piece tying the pair at the foot (the arm and the bucket pass between the rails)
    slide.add(stage);
    stages.push(stage);
  }
  g.add(box(2.6, 0.4, 2 * CS.slide.rails + 1.4, PANEL, CS.slide.x - 0.4, 0.9, 0)); // the slide's foot plate on the chassis

  // ---- the arm on the top of the slide: its frame has local y up the bucket and -x out towards the backdrop
  const arm = new Group();
  g.add(arm);
  const lx = -CS.arm.out; // the link from the hinge to the turret's axis, a printed bar
  const ly = CS.arm.along;
  const link = part(arm, Math.hypot(lx, ly) + 0.6, 0.6, 3, BLUE, lx / 2, ly / 2, 0);
  link.rotation.z = Math.atan2(ly, lx);
  const servo = cyl(0.9, 0.9, 3.4, BLACK, 0, 0, 0, 10); // the arm's servo, on its hinge
  servo.rotation.x = Math.PI / 2;
  servo.position.set(0, 0, 0);
  arm.add(servo);
  const disc = cyl(1.3, 1.3, 0.35, BLUE, 0, 0, 0, 16); // the sprung wiring holder, a blue disc on the hinge's side
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0.3, 0.7, 1.85);
  arm.add(disc);

  // ---- the turret turns the bucket about the axis out of the arm's end (local x); the bucket hangs below it, a back plate with side rails,
  // a closed box with a slit down its middle, room for two pixels one above the other, and a lock
  const wrist = new Group(); // the bucket turns about the arm's end, through 60 degrees in all, whatever the arm is doing
  wrist.position.set(-CS.arm.out, CS.arm.along, 0);
  arm.add(wrist);
  const turret = new Group();
  wrist.add(turret);
  const turretServo = cyl(1.2, 1.2, 0.8, BLACK, 0, 0, 0, 14);
  turretServo.rotation.z = Math.PI / 2;
  turretServo.position.set(0.2, 0, 0);
  turret.add(turretServo); // (the turret's own servo stays put)
  const top = CS.bucket.top;
  const bottom = CS.bucket.low + PIXEL_SIZE.corner / 2 + 0.3;
  const len = top + bottom;
  const mid = (top - bottom) / 2;
  part(turret, 0.35, len, 3.9, BLUE, 0.55, mid, 0); // the back plate
  for (const s of [-1, 1]) {
    part(turret, 1.2, len, 0.35, BLUE, 0, mid, s * 1.95); // the sides
    part(turret, 0.3, len, 1.6, BLUE, -0.5, mid, s * 1.15); // the front, in two halves with a slit between them down the middle
  }
  part(turret, 1.2, 0.35, 3.9, BLUE, 0, top - 0.17, 0); // the end over the upper pixel
  part(turret, 1.2, 0.35, 3.9, BLUE, 0, -bottom + 0.17, 0); // and the one under the lower, so the box is closed all round
  // the lock: a small servo on the front with a knob that goes through the slit into the hole of the lower pixel and holds it by its centre
  const gate = new Group();
  gate.position.set(-0.55, -CS.bucket.low, 0);
  const knob = cyl(0.3, 0.3, 1.2, STEEL, 0, 0, 0, 8);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.55, 0, 0);
  gate.add(knob);
  part(gate, 0.7, 1.1, 1.6, BLACK, -0.35, 0, 0); // the lock's body
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

  const upper = csPixel(0, CS.arm.fold, 0, CS.bucket.high, 0); // where the places are when the bucket is at rest, flat inside the robot
  const lower = csPixel(0, CS.arm.fold, 0, CS.bucket.low, 0);

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
    // the intake: up (25 degrees above level) to down (47 below, the roller's fingers at the floor)
    intake.rotation.z = lerp((25 * Math.PI) / 180, (-47 * Math.PI) / 180, p.intake);
    roller.rotation.z = -p.spin;
    const e = Math.min(CS.slide.travel, Math.max(0, p.slide));
    stages.forEach((st, k) => (st.position.y = (k * e) / 3));
    const a = csArm(e, p.arm);
    arm.position.set(a.hinge[0], a.hinge[1], 0);
    arm.rotation.z = CS.lean - p.arm;
    wrist.rotation.z = csWrist(p.arm, p.bucket);
    turret.rotation.x = -p.turret;
    gate.position.x = -0.55 - 1 * p.gate; // drawn back off the pixel's hole
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
  markMoving(g, intake, roller, ...stages, arm, wrist, turret, gate, inside.y, inside.w, held.y, held.w);
  return g;
}
