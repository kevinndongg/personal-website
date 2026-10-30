import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { FLOOR } from "./ftc";
import { PLACE_AXIS, PP, PP_HEIGHT, TAKEN, ftcField, poleTop, submersibleSamples } from "./ftcfield";
import { robotModel } from "./ftcrobot";
import { ppCone, ppRobotModel } from "./ftcpprobot";
import { centred, pixelText } from "./ftctext";
import { box, canvasOf, cyl, fillRect, mesh, nearestTexture, toon } from "./models";
import type { AnimCtx } from "./models";

// Models for the FTC area (see ftc.ts): the field's wall and the elements of each season, the duck in its chair, the
// driver station and the pit crew's things. Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint
// centre on the ground, +x = front. Anything that moves animates itself from `userData.animate`.

const STEEL = "#aeb4c0";
const DARK = "#3d4048";
const BLACK = "#1b1b22";
const GOLD = "#f2c230";
const RED = "#d8322c";
const BLUE = "#2f74e0";
const POLE = "#e8c24a";
const PIXEL = { y: "#f2c230", p: "#8a4fd0", w: "#f4f4f4", g: "#3fae5a" };

const X_AXIS = new Vector3(1, 0, 0);

/** A thin square bar between two points. */
function strut(a: [number, number, number], b: [number, number, number], thick: number, color: string): Mesh {
  const from = new Vector3(...a);
  const dir = new Vector3(...b).sub(from);
  const len = dir.length();
  const m = mesh(new BoxGeometry(len, thick, thick), toon(color));
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(X_AXIS, dir.normalize());
  return m;
}

/** A flat picture facing +z (towards the camera), unlit so its pixels stay as drawn. */
function picture(w: number, h: number, canvas: HTMLCanvasElement, twoSided = false): { plane: Mesh; tex: CanvasTexture } {
  const tex = nearestTexture(canvas);
  const plane = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, side: twoSided ? DoubleSide : undefined }));
  return { plane, tex };
}

// ---------------------------------------------------------------- the field

/** How high the floor sheet lies above the ground: over all of the ground's layers (shadow catcher 0.05, leaf shade 0.08, hover glow 0.12). */
const SHEET_Y = 0.13;

/**
 * The field's floor: foam tiles and the tape between the wedges, as a flat sheet just above
 * the ground, on a thin slab that only shows once the floor has risen. It lies over the ground's shadow catcher and leaf
 * shade, so it brings its own (`liftOverlay`): the ground's would flicker against it as it passes their height on the way
 * up and down. It is not flagged `flat`, so it lifts with the rest of the field when hovered.
 */
function floorModel(): Group {
  const g = new Group();
  const { size, tiles, tape } = FLOOR;
  const S = 2; // texels per px
  const [c, ctx] = canvasOf(size * S, size * S);
  ctx.scale(S, S);
  const t = size / tiles;
  for (let j = 0; j < tiles; j++) for (let i = 0; i < tiles; i++) fillRect(ctx, i * t, j * t, t, t, (i + j) & 1 ? "#8a8f9d" : "#7f8492");
  for (let k = 1; k < tiles; k++) {
    fillRect(ctx, Math.round(k * t), 0, 1, size, "#4d515e"); // the seams between tiles
    fillRect(ctx, 0, Math.round(k * t), size, 1, "#4d515e");
  }
  const h = size / 2; // the data is relative to the centre, the canvas to its corner
  ctx.strokeStyle = "#f4f4f4";
  ctx.lineWidth = 1;
  for (const line of tape) {
    ctx.beginPath();
    line.forEach((p, i) => (i ? ctx.lineTo(p.x + h, p.y + h) : ctx.moveTo(p.x + h, p.y + h)));
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  const sheet = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ map: tex }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = SHEET_Y;
  g.add(sheet);
  g.add(box(size, 3, size, "#6d717e", 0, SHEET_Y - 0.02 - 3, 0)); // its top just under the sheet
  g.userData.liftOverlay = { w: size, d: size, y: SHEET_Y }; // see Renderer3D.addLiftOverlay
  return g;
}

/** One run of the field's wall: a pale rail with a darker cap. */
function wallModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 5, d, "#cfd4de", 0, 0, 0));
  g.add(box(w + 0.4, 1, d + 0.4, "#8b909a", 0, 5, 0));
  return g;
}

// ---- Power Play: a cup or pole standing on a base plate; a scored cone is dropped over the pole and rests on the floor

const DOWN = new Vector3(0, -1, 0);

/**
 * A junction. The pole can wear a cone from the start (`scoredCone`), and for the two the robot scores on (`placedIndex`, an
 * index into `ftcField.placed`) a red cone is let go above it and slides down: the cone is shown narrow end down, leaning as the
 * claw held it and straightening as it falls on to the cone already there. It shrinks away once the robot has driven off.
 */
function ppJunction(level: "g" | "l" | "m" | "h", scoredCone?: string, placedIndex?: number): Group {
  const g = new Group();
  g.add(cyl(2.2, 2.4, 1, DARK, 0, 0, 0, 10));
  if (level === "g") {
    g.add(cyl(2.3, 2.3, 3, POLE, 0, 1, 0, 10)); // a ground junction is just a short cup
    g.add(cyl(1.5, 1.5, 0.2, BLACK, 0, 4, 0, 10));
  } else {
    const h = PP_HEIGHT[level];
    g.add(cyl(0.95, 0.95, h, POLE, 0, 1, 0, 8));
    g.add(cyl(1.7, 1.7, 0.9, DARK, 0, 1 + h, 0, 8));
  }
  // the cone stands round the foot of the pole, the pole coming out through its tip
  if (scoredCone) g.add(ppCone(scoredCone, 0, 1, 0));

  if (placedIndex !== undefined && (level === "m" || level === "h")) {
    const rest = 1 + PP.coneH; // its narrow end comes to rest on top of the cone that is already there
    const start = poleTop(level) + PP.above; // and is let go with its tip just over the pole's cap
    const pivot = new Group(); // at the cone's narrow end, so that is where it straightens from
    const cone = ppCone(RED, 0, 0, 0);
    cone.rotation.x = Math.PI; // upside down: the tip at the pivot, the wide end up
    cone.position.y = PP.coneH;
    pivot.add(cone);
    pivot.visible = false;
    g.add(pivot);
    const lean = new Vector3(...PLACE_AXIS).normalize(); // base to tip, as it is let go
    const dir = new Vector3();
    g.userData.animate = () => {
      const p = ftcField.placed[placedIndex];
      pivot.visible = p > 0.001 && p < 1.999;
      if (!pivot.visible) return;
      const fall = Math.min(1, p);
      pivot.position.y = start - (start - rest) * fall * fall; // it speeds up as it falls
      const straight = fall * fall * (3 - 2 * fall);
      dir.copy(lean).lerp(DOWN, straight).normalize(); // narrow end first, which for the upside down cone is its own -y
      pivot.quaternion.setFromUnitVectors(DOWN, dir);
      pivot.scale.setScalar(Math.max(0.001, p > 1 ? 2 - p : 1));
    };
  }
  return g;
}

/** Cones nested one inside the next, each `pitch` higher than the last, so only their base rings show. */
function coneStack(color: string, n = 3, pitch = 1.2): Group {
  const g = new Group();
  for (let i = 0; i < n; i++) g.add(ppCone(color, 0, i * pitch, 0));
  return g;
}

/** The red stack on the north wall: three cones, the top one the robot takes (`ftcField.cone[0]`) and a new one grows back on the stack. */
function ppStack(): Group {
  const g = coneStack(RED, 2);
  const top = ppCone(RED, 0, PP.stackTop, 0);
  g.add(top);
  g.userData.animate = () => {
    const p = ftcField.cone[0];
    top.visible = p > 0.02;
    top.scale.setScalar(Math.max(0.001, p)); // it shrinks into the stack, not into its own middle
  };
  return g;
}

/** The human player's cone, standing on the floor against the west wall (`ftcField.cone[1]`): taken, then a fresh one appears. */
function ppHumanCone(): Group {
  const g = new Group();
  const cone = ppCone(RED, 0, 0, 0);
  g.add(cone);
  g.userData.animate = () => {
    const p = ftcField.cone[1];
    cone.visible = p > 0.02;
    cone.scale.setScalar(Math.max(0.001, p));
  };
  return g;
}

/** A neat stack of hexagonal pixels lying flat on one another. */
function pixelStack(color: string, n = 8): Group {
  const g = new Group();
  for (let i = 0; i < n; i++) g.add(cyl(2.6, 2.6, 0.9, color, 0, i * 0.9, 0, 6));
  return g;
}

/** Samples piled log-cabin style: two side by side in each layer, every layer turned across the one below. */
function samplePile(color: string, layers = 6): Group {
  const g = new Group();
  for (let l = 0; l < layers; l++)
    for (const s of [-1, 1]) {
      const along = l % 2 === 0;
      g.add(box(along ? 3.8 : 1.6, 1.6, along ? 1.6 : 3.8, color, along ? 0 : s * 0.85, l * 1.6, along ? s * 0.85 : 0));
    }
  return g;
}

// ---- Center Stage: the backdrop, the truss, the drone and the pixels

/** The mosaic on the face of the backdrop: a lattice of pixels, some in place, the rest empty. */
function backdropTexture(w: number, len: number): CanvasTexture {
  const W = Math.round(w * 2);
  const H = Math.round(len * 2);
  const [c, ctx] = canvasOf(W, H);
  fillRect(ctx, 0, 0, W, H, "#2b2e38");
  const palette = [PIXEL.y, PIXEL.p, PIXEL.w, PIXEL.g, "#3a3e4a", "#3a3e4a"];
  const cols = Math.floor((W - 7) / 6);
  const rows = Math.floor((H - 5) / 5);
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const x = 4 + q * 6 + (r % 2) * 3;
      const y = 3 + r * 5;
      ctx.fillStyle = palette[(q * 7 + r * 13 + ((q * r) % 5)) % palette.length];
      ctx.fillRect(x + 1, y, 2, 4); // a hexagon, as much as four texels allow
      ctx.fillRect(x, y + 1, 4, 2);
    }
  return nearestTexture(c);
}

function backdropModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 1.5, d, DARK, 0, 0, 0)); // the platform
  const len = 14; // a narrow board, taller than it is wide
  const tilt = 1.08; // 62 degrees: the top leans back to the wall
  const board = new Group();
  board.position.set(0, 1.5 + (len * Math.sin(tilt)) / 2, 0);
  board.rotation.x = tilt;
  board.add(box(w - 2, 0.8, len, "#1b1d26", 0, -0.4, 0));
  const face = new Mesh(new PlaneGeometry(w - 2.6, len - 0.8), new MeshBasicMaterial({ map: backdropTexture(w - 2.6, len - 0.8) }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.45;
  board.add(face);
  g.add(board);
  for (const sx of [-1, 1]) g.add(box(1, 10, 1, STEEL, sx * (w / 2 - 2.5), 1.5, -3.2)); // props behind
  return g;
}

/**
 * The truss: a triangular rig, two A-frames joined by a bar along the apex, and a gold bar on each sloping side
 * about 60% of the way up for the robots to hang from. The triangle is 12 wide at its base and 22 high; the rig is 20 long (z).
 */
function trussModel(): Group {
  const g = new Group();
  const R = 8.5; // the A-frames stand this far either side of the middle
  const BASE = 5.5; // half the width of the triangle at the floor
  const TOP = 21.4; // the apex bar's centre
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) {
      g.add(box(2, 0.6, 2, DARK, sx * BASE, 0, s * R)); // feet
      g.add(strut([sx * BASE, 0.9, s * R], [0, TOP, s * R], 0.8, STEEL)); // the two legs of the A-frame
    }
    g.add(box(2 * BASE, 0.8, 0.8, STEEL, 0, 0.6, s * R)); // the tie across its base
  }
  g.add(box(1.2, 1.2, 2 * R + 1.4, STEEL, 0, TOP - 0.6, 0)); // the bar along the top
  for (const sx of [-1, 1]) g.add(box(0.8, 0.8, 2 * R, STEEL, sx * BASE, 0.6, 0)); // runners along the base
  // the hang bars: 60% up, which on a leg is 40% of the way in from the foot
  const hangY = 22 * 0.6;
  const hangX = BASE * 0.4;
  for (const sx of [-1, 1]) g.add(box(0.9, 0.9, 2 * R + 1, GOLD, sx * hangX, hangY - 0.45, 0));
  return g;
}

/** A paper-plane drone, nose up on its launcher. */
function droneModel(): Group {
  const g = new Group();
  g.add(box(3, 0.6, 3, DARK, 0, 0, 0));
  g.add(cyl(0.5, 0.5, 3.4, STEEL, 0, 0.6, 0, 6));
  const plane = new Group();
  plane.position.set(0, 4.4, 0);
  plane.rotation.z = 0.18;
  plane.add(box(8, 0.5, 1.6, "#f4f4f4", 0, 0, 0)); // body
  for (const s of [-1, 1]) {
    const wing = box(3.8, 0.3, 3.4, "#f4f4f4", 0.6, 0.2, s * 2.2);
    wing.rotation.y = -s * 0.55;
    plane.add(wing);
  }
  plane.add(box(1.2, 2, 0.3, RED, -3.4, 0.5, 0)); // tail fin
  g.add(plane);
  return g;
}

/** A hexagonal pixel, two stacked and a little askew. */
function pixelModel(color: string): Group {
  const g = new Group();
  g.add(cyl(2.6, 2.6, 0.9, color, 0, 0, 0, 6));
  const top = cyl(2.6, 2.6, 0.9, color, 0.4, 0.9, 0.2, 6);
  top.rotation.y = 0.5;
  g.add(top);
  return g;
}

// ---- Into the Deep: the submersible, the baskets and the samples

/**
 * The submersible: an open box of four posts and two rectangles of rails, a gold bar at the back and a silver one at the
 * front, standing on a dark floor that is covered in samples of all three colours lying every which way. Two of the samples
 * are the ones the robot takes: they shrink away when it picks them up and grow back in the same place once it has gone
 * (`ftcField.sample`, written by robotcycle.ts).
 */
function submersibleModel(w: number, d: number): Group {
  const g = new Group();
  const hx = w / 2 - 1.5;
  const hz = d / 2 - 1.5;
  const TOP = 16.2; // the bottom of the top rails
  g.add(box(w, 1.2, d, DARK, 0, 0, 0)); // the floor

  // the samples, a jittered grid that is the same on every load (and in the scene, which aims the robot at two of them)
  const taken: Mesh[] = [];
  submersibleSamples(w, d).forEach((spot, n) => {
    const s = box(3.8, 1.6, 1.6, spot.color, spot.x, 1.2, spot.z);
    s.rotation.y = spot.yaw;
    g.add(s);
    if (n === TAKEN.left) taken[0] = s;
    if (n === TAKEN.right) taken[1] = s;
  });
  g.userData.animate = () => {
    taken.forEach((s, i) => {
      const p = ftcField.sample[i];
      s.visible = p > 0.02;
      s.scale.setScalar(Math.max(0.001, p));
      s.position.y = 1.2 + 0.8 * p; // it shrinks towards the floor, not towards its own middle
    });
  };

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1.4, TOP + 1 - 1.2, 1.4, STEEL, sx * hx, 1.2, sz * hz)); // posts
  for (const y of [1.2, TOP]) {
    for (const sz of [-1, 1]) g.add(box(2 * hx, 1, 1, STEEL, 0, y, sz * hz)); // rails along the length
    for (const sx of [-1, 1]) g.add(box(1, 1, 2 * hz, STEEL, sx * hx, y, 0)); // and across each end
  }
  // the high bar at the back, the low one at the front: the low one is high enough for the robot's arm to reach in under it
  // with its head folded up (which stands 8.6 px above the floor), as it does to the sample on the south side
  g.add(box(2 * hx, 1, 1, GOLD, 0, 12.5, -hz));
  g.add(box(2 * hx, 1, 1, "#c8ccd6", 0, 9, hz));
  return g;
}

/**
 * A basket stand: a tall grey post with a coloured strip down its back edge, and two clear square buckets (wider at the
 * top) bracketed to its front, one high and one low. Faces +x, the side the buckets are on; the strip is on -x.
 * It always holds a few samples (three in the high bucket, two in the low one, `held`, the first three for the high bucket),
 * and the sample the robot drops lands on top of the high pile (`dropped`, shown by `ftcField.dropped[index]`).
 */
function basketModel(stripe: string, index: number, held: string[], dropped: string): Group {
  const g = new Group();
  // clear plastic: faint enough that the samples inside show in their own colours (and not washed over by it)
  const glass = new MeshLambertMaterial({ color: "#eaf5ff", transparent: true, opacity: 0.16, depthWrite: false });
  g.add(box(6, 0.8, 6, DARK, 0, 0, 0)); // the foot
  g.add(box(1.6, 22, 1.6, STEEL, 0, 0.8, 0));
  g.add(box(0.7, 22, 2.2, stripe, -1.1, 0.8, 0));
  g.add(box(1.8, 0.8, 1.8, DARK, 0, 22.8, 0));
  const bucket = (y: number) => {
    g.add(box(2.4, 0.7, 1.2, DARK, 1.6, y, 0)); // the bracket
    // a square frustum with no top and no bottom (an open bucket, so that you can see down into it): four sides, 5 wide at
    // the bottom and 7 at the top, turned to line up with the axes
    const geo = new CylinderGeometry(4.95, 3.54, 5, 4, 1, true);
    geo.rotateY(Math.PI / 4);
    const b = mesh(geo, glass, 4.4, y + 2.5, 0);
    b.castShadow = false;
    g.add(b);
    g.add(box(5, 0.3, 5, "#8fb3d6", 4.4, y, 0)); // its floor
    // the rim, and the four edges, as thin lines of clear plastic, so the bucket still reads as one
    for (const s of [-1, 1]) {
      g.add(box(7.2, 0.3, 0.3, "#e6f3ff", 4.4, y + 4.85, s * 3.5));
      g.add(box(0.3, 0.3, 7.2, "#e6f3ff", 4.4 + s * 3.5, y + 4.85, 0));
    }
  };
  bucket(15);
  bucket(7.5);

  // what the buckets hold, lying on the floor of each (a bucket's floor is at its `y` plus 0.3)
  const lie = (color: string, y: number, z: number, yaw: number) => {
    const s = box(3.8, 1.6, 1.6, color, 4.4, y, z);
    s.rotation.y = yaw;
    g.add(s);
    return s;
  };
  lie(held[0], 15.3, -0.9, 0.08); // the high bucket: two side by side, one across them, the pile's top a little under the rim
  lie(held[1], 15.3, 0.9, -0.1);
  lie(held[2], 16.9, 0, Math.PI / 2 + 0.1);
  lie(held[3], 7.8, -0.9, 0.05); // the low bucket: two side by side
  lie(held[4], 7.8, 0.9, -0.08);
  // the sample the robot drops in, on top of the high pile: it falls in from just above and shrinks out again when it is taken away
  // (lying across the way the robot's head points, as it was on the scoop, so along the bucket's width)
  const top = lie(dropped, 18.5, 0, Math.PI / 2 + 0.12);
  top.visible = false;
  g.userData.animate = () => {
    const p = ftcField.dropped[index];
    top.visible = p > 0.02;
    top.scale.setScalar(Math.max(0.001, p));
    top.position.y = 18.5 + 0.8 * p + (1 - p) * 3;
  };
  return g;
}

/** Three samples side by side, each a little askew. */
function samplesModel(color: string): Group {
  const g = new Group();
  [-6.5, 0, 6.5].forEach((x, i) => {
    const s = box(3.8, 1.6, 1.6, color, x, 0, (i - 1) * 0.4);
    s.rotation.y = (i - 1) * 0.18;
    g.add(s);
  });
  return g;
}

// ---------------------------------------------------------------- the mascot

/** The team duck in a folding chair, facing +x: a big yellow head with a white tuft, orange bill and feet, a black cape. */
function duckModel(): Group {
  const g = new Group();
  const Y = "#ffd21a";
  const Y2 = "#ffe45c";
  const O = "#ff8a1c";
  const CAPE = "#16161d";
  // the chair
  g.add(box(13, 1.2, 11, "#4a4d57", -1, 6, 0));
  for (const x of [-6.5, 4.5]) for (const z of [-4.5, 4.5]) g.add(box(1, 6, 1, STEEL, x, 0, z));
  g.add(box(1, 8, 11, "#4a4d57", -7.2, 7.2, 0));
  g.add(box(1, 14, 12.4, CAPE, -6, 5, 0)); // the cape hangs down behind it
  // body
  g.add(box(8, 12, 11.5, Y, -1.5, 7.2, 0));
  g.add(box(0.5, 9, 8, Y2, 2.6, 8.2, 0)); // a paler belly
  g.add(box(8.4, 1.4, 11.8, CAPE, -1.5, 18.2, 0)); // the black collar and the bow's two tails
  g.add(box(1, 5, 1.6, CAPE, 2.9, 13.4, 1.8));
  g.add(box(1, 4, 1.6, CAPE, 2.9, 14.2, -1.8));
  g.add(box(0.5, 1.6, 1.6, "#9fd0ff", 2.9, 15.6, -3.2)); // a pin on the chest
  for (const s of [-1, 1]) {
    g.add(box(3.4, 8, 2.2, Y, -1, 9.8, s * 6.9)); // arms, hands resting on the knees
    g.add(box(5, 2.4, 2.2, Y, 1.2, 10.9, s * 6.6));
    g.add(box(7.5, 3.6, 3.6, Y, 5.7, 7.2, s * 2.9)); // thighs along the seat
    g.add(box(3.2, 7.2, 3.6, Y, 8.6, 0, s * 2.9)); // shins
    g.add(box(6.4, 2.2, 4.4, O, 11.6, 0, s * 2.9)); // big flat feet
  }
  // head, on a pivot so it can nod
  const head = new Group();
  head.position.y = 19.2;
  head.add(box(11, 9.5, 12.4, Y, 0.5, 0, 0));
  head.add(box(5.5, 2.4, 5.5, "#f4f4f4", -1.5, 9.5, 0)); // the tuft
  head.add(box(3.4, 1.6, 3.4, "#f4f4f4", -1.2, 11.9, 0.3));
  head.add(box(6, 2.4, 7.6, O, 8.9, 2.2, 0)); // the bill
  head.add(box(4.8, 1.2, 6.4, "#e87510", 8.4, 1, 0));
  const eyes: Mesh[] = [];
  for (const s of [-1, 1]) {
    const eye = box(0.7, 3.6, 3.4, "#2a1d14", 6.05, 4.4, s * 3.3);
    head.add(eye);
    eyes.push(eye);
    head.add(box(0.4, 1.2, 1.2, "#ffffff", 6.5, 6, s * 3.3 + 0.6)); // a glint
  }
  g.add(head);
  g.userData.animate = ({ t, pixel }: AnimCtx) => {
    // a one-pixel nod on every other beat, and a blink every few seconds
    const k = Math.floor(t / 0.8) % 4;
    head.position.y = 19.2 + (k === 1 || k === 2 ? pixel : 0);
    const blink = t % 4.3 < 0.16;
    for (const e of eyes) e.scale.y = blink ? 0.15 : 1;
  };
  return g;
}

// ---------------------------------------------------------------- tables and what is on them

const TABLE_H = 7;

/** A folding table: top, four legs and a skirt hanging along the front (+z). */
function tableModel(g: Group, w: number, d: number, skirt: string) {
  g.add(box(w, 1.2, d, "#4a4d57", 0, TABLE_H - 1.2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1, TABLE_H - 1.2, 1, STEEL, sx * (w / 2 - 1.5), 0, sz * (d / 2 - 1.5)));
  g.add(box(w - 0.4, TABLE_H - 1.4, 0.5, skirt, 0, 0.2, d / 2 - 0.3));
}

/** A gamepad lying on the table, its grips towards +z and its cable out of the back. */
function gamepad(x: number, z: number): Group {
  const p = new Group();
  p.position.set(x, TABLE_H, z);
  p.add(box(5.4, 1.2, 3.2, BLACK, 0, 0, 0));
  for (const s of [-1, 1]) p.add(box(1.8, 1.2, 2.4, BLACK, s * 2.2, 0, 1.8)); // the grips
  for (const s of [-1, 1]) p.add(box(1.8, 0.8, 0.6, "#2b2e38", s * 1.8, 0.5, -1.8)); // the bumpers
  p.add(cyl(0.55, 0.55, 0.5, "#4a4d57", -1.7, 1.2, -0.3, 8)); // the sticks
  p.add(cyl(0.55, 0.55, 0.5, "#4a4d57", 1, 1.2, 0.9, 8));
  p.add(box(1.4, 0.3, 0.45, "#4a4d57", -1, 1.2, 0.9)); // the d-pad
  p.add(box(0.45, 0.3, 1.4, "#4a4d57", -1, 1.2, 0.9));
  p.add(box(0.7, 0.3, 0.7, "#f4f4f4", 0, 1.2, -0.8)); // the guide button
  p.add(box(0.55, 0.35, 0.55, "#3fae5a", 1.9, 1.2, 0.3)); // A, B, X, Y
  p.add(box(0.55, 0.35, 0.55, RED, 2.5, 1.2, -0.3));
  p.add(box(0.55, 0.35, 0.55, BLUE, 1.3, 1.2, -0.3));
  p.add(box(0.55, 0.35, 0.55, GOLD, 1.9, 1.2, -0.9));
  return p;
}

/** The Driver Hub in a stand between two gamepads, cabled to both. */
function stationModel(w: number, d: number): Group {
  const g = new Group();
  tableModel(g, w, d, "#16161d");
  g.add(box(w - 6, 0.5, 0.8, BLUE, 0, 2.2, d / 2 + 0.05)); // a stripe along the skirt
  const [c, ctx] = canvasOf(20, 12);
  fillRect(ctx, 0, 0, 20, 12, "#0b2a4a");
  fillRect(ctx, 0, 0, 20, 2, BLUE);
  fillRect(ctx, 2, 4, 10, 1, "#8fdcff");
  fillRect(ctx, 2, 6, 14, 1, "#5b6b80");
  fillRect(ctx, 2, 8, 8, 1, "#5b6b80");
  fillRect(ctx, 15, 8, 3, 2, "#3fae5a");
  const hub = new Group();
  hub.position.set(0, TABLE_H + 3.4, -0.5);
  hub.rotation.x = -0.3;
  hub.add(box(7, 4.6, 0.8, BLACK, 0, -2.3, 0));
  const { plane } = picture(6.2, 3.8, c);
  plane.position.set(0, 0.1, 0.45);
  hub.add(plane);
  g.add(box(5, 0.8, 3, DARK, 0, TABLE_H, 0.5));
  g.add(hub);
  for (const s of [-1, 1]) {
    g.add(gamepad(s * 12, 2.4));
    g.add(box(0.4, 0.3, 1.3, BLACK, s * 12, TABLE_H, 0.15)); // out of the back of the pad, then across to the hub
    g.add(box(8.5, 0.3, 0.4, BLACK, s * 7.75, TABLE_H, -0.5));
  }
  return g;
}

/** The pit table: a parts tray, a wire spool, and a battery on its charger. The laptop is a prop of its own. */
function pitModel(w: number, d: number): Group {
  const g = new Group();
  tableModel(g, w, d, BLUE);
  g.add(box(10, 1.4, 6, BLUE, 0, TABLE_H, 0.5)); // the parts tray, with a few gears in it
  for (const [x, z] of [[-2.5, 0], [0.5, 1.4], [2.8, -0.4]] as const) g.add(cyl(1.4, 1.4, 0.7, GOLD, x, TABLE_H + 1.4, z + 0.5, 10));
  g.add(cyl(2.2, 2.2, 2, RED, -11, TABLE_H, 0, 10)); // a spool of wire
  g.add(box(8, 2.6, 5, "#4a4d57", 16, TABLE_H, 0)); // the charger, a battery on top of it
  g.add(box(0.6, 0.4, 2, "#4cd964", 18.5, TABLE_H + 2.6, 1.2));
  g.add(box(5.6, 2.4, 2.4, BLACK, 14, TABLE_H + 2.6, -0.6));
  g.add(box(1.2, 1.4, 1.4, "#ff8a1c", 17.2, TABLE_H + 2.9, -0.6));
  return g;
}

/** An open tote with a heap in it: the game pieces of all three seasons. */
function binModel(w: number, d: number): Group {
  const g = new Group();
  const color = "#9aa0ae";
  g.add(box(w, 1, d, color, 0, 0, 0));
  for (const s of [-1, 1]) {
    g.add(box(w, 8, 1, color, 0, 1, s * (d / 2 - 0.5)));
    g.add(box(1, 8, d - 2, color, s * (w / 2 - 0.5), 1, 0));
    g.add(box(6, 1.2, 1.2, "#dbe6f5", 0, 8, s * (d / 2 - 0.5))); // the handles
  }
  g.add(box(w - 3, 4.6, d - 3, "#2b2e38", 0, 1, 0)); // the heap, as far as the rim
  const top = 5.6;
  g.add(ppCone(RED, -7, top, -2, 0.7));
  g.add(ppCone(BLUE, -3.5, top, 2.4, 0.7));
  g.add(cyl(2.2, 2.2, 0.9, PIXEL.y, 1.5, top, -2.4, 6));
  g.add(cyl(2.2, 2.2, 0.9, PIXEL.p, 4.5, top, 2.6, 6));
  g.add(cyl(2.2, 2.2, 0.9, PIXEL.w, 7, top, -1, 6));
  g.add(cyl(2.2, 2.2, 0.9, PIXEL.g, 0.5, top + 0.9, -2.2, 6));
  g.add(box(3.8, 1.6, 1.6, RED, 3, top + 0.9, 0.6));
  g.add(box(3.8, 1.6, 1.6, GOLD, -1, top + 0.9, 2.2));
  return g;
}

// ---------------------------------------------------------------- beside the field

/** The match clock: red and blue scores either side of a countdown, ticking through a match. */
function scoreboardModel(w: number, d: number): Group {
  const g = new Group();
  for (const sx of [-1, 1]) g.add(box(1.2, 8, 1.2, STEEL, sx * (w / 2 - 3), 0, 0));
  g.add(box(w, 14, d / 3, BLACK, 0, 8, 0));
  const [c, ctx] = canvasOf(64, 28);
  const { plane, tex } = picture(w - 2, 12, c);
  plane.position.set(0, 15, d / 6 + 0.1);
  g.add(plane);
  let shown = -1;
  const draw = (sec: number) => {
    const s = sec % 150;
    const left = 150 - s;
    fillRect(ctx, 0, 0, 64, 28, "#0b0d14");
    pixelText(ctx, "RED", 3, 3, 1, RED);
    pixelText(ctx, "BLU", 49, 3, 1, "#5b9bff");
    const two = (n: number) => String(Math.min(99, n)).padStart(2, "0");
    pixelText(ctx, two(3 * Math.floor(s / 9)), 3, 11, 2, RED);
    pixelText(ctx, two(2 * Math.floor(s / 6)), 47, 11, 2, "#5b9bff");
    centred(ctx, 64, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, 11, 2, GOLD);
    fillRect(ctx, 0, 24, 64, 1, "#2b2e38");
    tex.needsUpdate = true;
  };
  draw(0);
  g.userData.animate = ({ t }: AnimCtx) => {
    const sec = Math.floor(t);
    if (sec === shown) return;
    shown = sec;
    draw(sec);
  };
  return g;
}

/** The team banner on a weighted stand: the duck, 6417 and the team's name. */
function bannerModel(): Group {
  const g = new Group();
  g.add(box(10, 1, 6, DARK, 0, 0, 0));
  g.add(cyl(0.55, 0.55, 40, STEEL, 0, 1, -1.5, 8));
  g.add(box(1.2, 1.2, 1.2, GOLD, 0, 41, -1.5));
  g.add(box(18, 0.8, 0.8, STEEL, 0, 38.4, 0));
  const [c, ctx] = canvasOf(32, 56);
  fillRect(ctx, 0, 0, 32, 56, "#2a63c9");
  fillRect(ctx, 0, 0, 32, 1, GOLD);
  fillRect(ctx, 0, 55, 32, 1, GOLD);
  const duck = ["...WWW...", "..YYYYY..", ".YYKYYYY.", ".YYYYYOOO", ".YYYYYOOO", "..YYYYY..", "...YYY..."];
  const ink: Record<string, string> = { W: "#f4f4f4", Y: "#ffd21a", K: BLACK, O: "#ff8a1c" };
  duck.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch !== ".") fillRect(ctx, 7 + i * 2, 2 + j * 2, 2, 2, ink[ch]);
    })
  );
  centred(ctx, 32, "6417", 19, 2, "#f4f4f4");
  centred(ctx, 32, "BLU", 31, 2, GOLD);
  centred(ctx, 32, "CRU", 43, 2, GOLD);
  const cloth = new Group();
  cloth.position.set(0, 24.2, 0);
  const { plane } = picture(16, 28, c, true);
  cloth.add(plane);
  g.add(cloth);
  g.userData.animate = ({ t }: AnimCtx) => {
    // a slight sway, in steps
    cloth.rotation.y = [0, 0.06, 0, -0.06][Math.floor(t * 1.4) % 4];
  };
  return g;
}

/** A low shelf with three trophies on it, gold, silver and bronze. */
function trophiesModel(w: number, d: number): Group {
  const g = new Group();
  g.add(box(w, 1.2, d, "#b08a5a", 0, 4.8, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(1, 4.8, 1, "#7d522f", sx * (w / 2 - 1.5), 0, sz * (d / 2 - 1.5)));
  const trophy = (x: number, h: number, color: string) => {
    g.add(box(3.6, 1, 3.6, DARK, x, 6, 0));
    g.add(cyl(0.5, 0.5, h * 0.4, color, x, 7, 0, 8));
    g.add(cyl(2.4, 1.2, h * 0.5, color, x, 7 + h * 0.4, 0, 10));
    for (const s of [-1, 1]) g.add(box(0.5, h * 0.3, 0.5, color, x + s * 2.6, 7 + h * 0.5, 0));
  };
  trophy(-8, 10, GOLD);
  trophy(0, 8, "#c8ccd6");
  trophy(8, 6, "#c47a3a");
  return g;
}

// ---------------------------------------------------------------- dispatch

/** The model for an FTC-area prop id, or null when the id is not one of ours. */
export function ftcModel(id: string, w: number, d: number): Group | null {
  if (!id.startsWith("ftc-")) return null;
  const key = id.slice(4);
  switch (key) {
    case "floor":
      return floorModel();
    case "robot-itd":
      return robotModel();
    case "robot-pp":
      return ppRobotModel();
    case "wall":
      return wallModel(w, d);
    case "pp-g":
      return ppJunction("g");
    case "pp-l":
      return ppJunction("l");
    case "pp-m-red":
      return ppJunction("m", RED, 1);
    case "pp-h-blue":
      return ppJunction("h", BLUE, 0);
    case "pp-stack":
      return ppStack();
    case "pp-cone":
      return ppHumanCone();
    case "cones-blue":
      return coneStack(BLUE);
    case "backdrop":
      return backdropModel(w, d);
    case "truss":
      return trussModel();
    case "drone":
      return droneModel();
    case "pixel-y":
      return pixelModel(PIXEL.y);
    case "pixel-p":
      return pixelModel(PIXEL.p);
    case "pixel-w":
      return pixelModel(PIXEL.w);
    case "pixel-g":
      return pixelModel(PIXEL.g);
    case "submersible":
      return submersibleModel(w, d);
    case "basket-red":
      return basketModel(RED, 0, [RED, GOLD, RED, GOLD, RED], RED);
    case "basket-blue":
      return basketModel(BLUE, 1, [BLUE, GOLD, BLUE, GOLD, BLUE], GOLD);
    // the stored pieces: stacks of cones and pixels, piles of samples
    case "cone-stack-red":
      return coneStack(RED, 6);
    case "cone-stack-blue":
      return coneStack(BLUE, 6);
    case "pixel-stack-y":
      return pixelStack(PIXEL.y);
    case "pixel-stack-p":
      return pixelStack(PIXEL.p);
    case "pixel-stack-w":
      return pixelStack(PIXEL.w);
    case "pixel-stack-g":
      return pixelStack(PIXEL.g);
    case "sample-pile-red":
      return samplePile(RED);
    case "sample-pile-yellow":
      return samplePile(GOLD);
    case "sample-pile-blue":
      return samplePile(BLUE);
    case "samples-red":
      return samplesModel(RED);
    case "samples-yellow":
      return samplesModel(GOLD);
    case "samples-blue":
      return samplesModel(BLUE);
    case "duck":
      return duckModel();
    case "station":
      return stationModel(w, d);
    case "pit":
      return pitModel(w, d);
    case "bin-pieces":
      return binModel(w, d);
    case "scoreboard":
      return scoreboardModel(w, d);
    case "banner":
      return bannerModel();
    case "trophies":
      return trophiesModel(w, d);
  }
  return null;
}
