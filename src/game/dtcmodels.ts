import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { markMoving } from "./bake";
import { DRONE, SPOT, dtcScan } from "./dtcflight";
import type { CasualtyState, FlightPose, MedicPose, SpotPose } from "./dtcflight";
import { box, cyl, mesh, toon } from "./models";
import type { AnimCtx } from "./models";

// Models for the DARPA Triage Challenge area (see dtc.ts): the wrecked airliner and what fell from it, the casualties,
// the drone and the Spot robot that look for them. Same conventions as models.ts: 1 unit = 1 world px, origin at the
// footprint centre on the ground, +x = front. Anything that moves animates itself from `userData`, or is moved by dtcflight.ts.

const WHITE = "#e9ecf2";
const GREY = "#aeb4c0";
const DARK = "#2a2d36";
const BLUE = "#2f4a8a";
const BLUE_DK = "#243a6e";
const YELLOW = "#f2c230";
const LIME = "#3dff8a";
const GLASS = "#1b2a4a"; // cockpit glass
const TIP_GREEN = "#00a846"; // darker than the lime of the detection, so that it shows over the white fuselage

const R = 10; // the airliner's radius
const tagGrey = new Color("#9aa0ab");
const TAGS: Record<string, string> = { g: "#2fc25b", y: "#f2c230", r: "#e03131", k: "#16161d" };

const UP = new Vector3(0, 1, 0);

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/** A cylinder lying along x. With `rotation.z = +90 deg` the top of the cylinder ends up at -x; `front` puts the narrow end at +x instead. */
function tube(rTop: number, rBottom: number, len: number, color: string, x = 0, y = 0, z = 0, seg = 20, front = false): Mesh {
  const m = mesh(new CylinderGeometry(rTop, rBottom, len, seg), toon(color), x, y, z);
  m.rotation.z = front ? -Math.PI / 2 : Math.PI / 2;
  return m;
}

/** The torn end of a fuselage section at `x` (facing `dir`, -1 west / +1 east): a dark opening, seats showing, and ragged skin round the rim. */
function brokenEnd(parent: Group, x: number, dir: 1 | -1, r: number, y: number) {
  parent.add(tube(r - 0.7, r - 0.7, 0.8, DARK, x + dir * 0.2, y, 0));
  // two rows of seats seen in the opening
  for (const [dy, dz] of [
    [-3, -4],
    [-3, 4],
    [2, -5],
    [2, 5],
  ])
    parent.add(box(1.8, 3.2, 3.4, BLUE, x + dir * 0.9, y + dy - 1.6, dz));
  // ragged skin: panels standing out round the rim, turned this way and that
  const teeth = [0.3, 0.95, 1.6, 2.15, 2.8, 3.55, 4.2, 5.0, 5.6];
  teeth.forEach((a, i) => {
    const len = 2 + (i % 3) * 1.2;
    const m = box(len, 2.8, 0.7, i % 2 ? WHITE : GREY, x + dir * (len / 2 - 0.2), 0, 0);
    m.position.set(x + dir * (len / 2 - 0.2), y + Math.sin(a) * (r - 0.5), Math.cos(a) * (r - 0.5));
    m.rotation.x = a + Math.PI / 2;
    m.rotation.y = dir * (0.15 + 0.07 * i);
    parent.add(m);
  });
}

/** A row of cabin windows along a fuselage, on both sides, `up` above its axis. */
function windows(parent: Group, from: number, to: number, step: number, y: number, r: number, up = 4) {
  const dz = Math.sqrt(Math.max(0, r * r - up * up)) + 0.1;
  for (let x = from; x <= to; x += step)
    for (const side of [-1, 1]) parent.add(box(1.8, 2, 0.7, DARK, x, y + up - 1, side * dz));
}

/**
 * A flat plate with the outline `points` (x forward, z across: its shape seen from above), `thick` thick, its bottom at y = 0.
 * Wings and tailplanes are these, so that they are swept and tapered the way they look from the camera.
 */
function planform(points: [number, number][], thick: number, color: string): Mesh {
  const geo = new ExtrudeGeometry(new Shape(points.map(([x, z]) => new Vector2(x, z))), { depth: thick, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // the outline's y becomes z, and the plate hangs down from y = 0
  geo.translate(0, thick, 0);
  return mesh(geo, toon(color));
}

/** One half of a swept wing, root at z = 0 (a pixel inside the body) out to `span` on `side` (+1 south, -1 north); `lead` is the root's front edge. */
function wingOutline(side: 1 | -1, span: number, lead: number, rootChord: number, sweep: number, tipChord: number): [number, number][] {
  return [
    [lead, -side],
    [lead - sweep, side * span],
    [lead - sweep - tipChord, side * span],
    [lead - rootChord, -side],
  ];
}

// The nose is the front half of a sphere reshaped into an airliner's nose: it tapers to a small rounded tip over NOSE_LEN, following the curve
// (x / NOSE_LEN) ^ NOSE_P + (r / R) ^ NOSE_P = 1 (a power of 2 would be an ellipse, a blunt dome; lower is pointier), and droops, the tip
// sitting NOSE_DROOP below the fuselage's axis. Anything drawn on the nose is made from the same sphere and run through the same reshaping,
// so that it follows the skin exactly.
const NOSE_LEN = 1.9 * R;
const NOSE_P = 1.5;
const NOSE_DROOP = 0.22 * R;

/** Where a point of the unit sphere (its front half) goes on the nose, `off` px out from the skin. Relative to the nose's base, on the axis. */
function noseVertex(ux: number, uy: number, uz: number, off: number): [number, number, number] {
  const front = Math.max(0, ux);
  const x = NOSE_LEN * Math.pow(front, 2 / NOSE_P);
  const r = R * Math.pow(Math.max(0, 1 - front * front), 1 / NOSE_P);
  const rho = Math.hypot(uy, uz);
  const k = rho > 1e-6 ? (r + off) / rho : 0;
  const t = x / NOSE_LEN;
  return [x + off * 0.6, uy * k - NOSE_DROOP * t * t, uz * k];
}

function reshapeNose<G extends SphereGeometry>(geo: G, off = 0): G {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = noseVertex(pos.getX(i) / R, pos.getY(i) / R, pos.getZ(i) / R, off);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Cockpit glass is painted on the nose: patches of the same sphere, reshaped with it and a hair proud of it, so that they lie right on the
// skin and follow its curve, with no thickness. The sphere has its poles up, so a patch is a range of angles from the top (theta, which sets the
// height: 0 is straight up) and of angles round it (phi, which sets where along the nose and which side); the bars between the panes are
// the skin left bare between two patches. `from` and `to` are degrees round from the front of the nose, on `side` (+1 south, -1 north).
const glassMat = new MeshBasicMaterial({ color: GLASS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
function nosePane(parent: Group, base: number, y0: number, side: 1 | -1, from: number, to: number, top: number, bottom: number): void {
  const deg = Math.PI / 180;
  const front = Math.PI; // phi of the front of the nose (the sphere's +x)
  const phiStart = side > 0 ? front - to * deg : front + from * deg;
  const geo = new SphereGeometry(R, Math.max(4, Math.round((to - from) / 2)), 10, phiStart, (to - from) * deg, top * deg, (bottom - top) * deg);
  const patch = new Mesh(reshapeNose(geo, 0.18), glassMat);
  patch.position.set(base, y0, 0);
  parent.add(patch);
}

/** The front of the airliner: rounded nose and cockpit glass, the north wing (an engine torn off it), the stub of the south one, the torn end to the west. Length 62 (the nose reaches 19 further). */
export function fuselageModel(): Group {
  const L = 62;
  const y0 = R - 0.5;
  const g = new Group();
  g.add(tube(R, R, L, WHITE, 0, y0, 0, 22));
  // the nose: an ogive that tapers to a small rounded tip and droops, white to the end
  g.add(mesh(reshapeNose(new SphereGeometry(R, 44, 30, Math.PI / 2, Math.PI)), toon(WHITE), L / 2, y0, 0));
  // the cockpit, as on a 737: one dark band round the nose, with a continuous top edge and a continuous bottom edge. Two windshield panes
  // face forward with a thin post between them, and behind them each side has a sliding window and a fixed one, each pair separated by a
  // bar of bare skin of the same width
  for (const side of [-1, 1] as const) {
    nosePane(g, L / 2, y0, side, 3, 28, 40, 62); // the windshield pane (the post is the 6 degrees between the two)
    nosePane(g, L / 2, y0, side, 32, 52, 40, 62); // the sliding window
    nosePane(g, L / 2, y0, side, 56, 74, 40, 62); // the fixed one
  }
  for (const side of [-1, 1]) g.add(box(L - 2, 1.8, 0.8, BLUE, 0, y0 - 2.5 - 0.9, side * (R - 0.2))); // the cheat line
  windows(g, -24, 22, 6, y0, R);
  brokenEnd(g, -L / 2, -1, R, y0);

  // the wings, low on the body, swept back. The north one is whole but for its engine (a stub of the pylon is left) and droops to the
  // ground; the south one broke off a few pixels out (the loose wing lies beyond it).
  for (const [side, span] of [
    [-1, 21],
    [1, 10],
  ] as const) {
    const wing = new Group();
    wing.position.set(8, 2.6, side * (R - 2.5));
    if (side < 0) wing.rotation.x = -0.1;
    wing.add(planform(wingOutline(side, span, 6, 17, 15, 5), 1.6, WHITE));
    if (side < 0) {
      wing.add(planform(wingOutline(side, span - 1, -7, 4, 4.4, 2.6), 0.5, "#cfd4de").translateY(1.5)); // the flaps' lighter band along the back
      wing.add(box(3.4, 2.4, 2.6, GREY, -1.2, -2.4, side * 9)); // where the engine was
    } else {
      wing.add(box(2.4, 1.2, 2, WHITE, -2, 0.2, side * 10.6)); // torn edge
    }
    g.add(wing);
  }
  g.add(box(L, 1.4, 6, "#c4c9d3", 0, -0.5, 0)); // the belly, a little darker than the sides
  return g;
}

/** The tail: the rear of the fuselage, upright, the fin leaning a little, the broken end to the east. Length 40. */
export function tailModel(): Group {
  const L = 40;
  const g = new Group();
  const shell = new Group();
  shell.position.y = R - 0.5;
  shell.rotation.x = 0.12; // upright but for a slight lean toward the camera: a fin standing up shows its broad face, and every airliner's tail looks like that
  g.add(shell);
  const TIP = 3.5; // the radius at the tail's tip
  shell.add(tube(TIP, R, L, WHITE, 0, 0, 0, 22));
  shell.add(tube(TIP + 0.3, TIP + 0.3, 2.2, "#c4c9d3", -L / 2 - 0.3, 0, 0, 12)); // the cone at the tail's tip
  // the fin: swept back from the top of the tail
  const fin = new Mesh(
    new ExtrudeGeometry(
      new Shape(
        [
          [6, 0],
          [-4, 21],
          [-9, 21],
          [-10, 0],
        ].map(([x, y]) => new Vector2(x, y))
      ),
      { depth: 1.4, bevelEnabled: false }
    ),
    toon("#d8322c")
  );
  fin.geometry.translate(0, 0, -0.7);
  fin.position.set(-L / 2 + 11, 3.2, 0);
  fin.castShadow = true;
  shell.add(fin);
  // the tailplane: two swept halves
  for (const side of [-1, 1] as const) {
    const half = planform(wingOutline(side, 13, 0, 9, 8, 4), 0.9, WHITE);
    half.position.set(-L / 2 + 9, -0.3, 0);
    shell.add(half);
  }
  // windows and the cheat line follow the skin, which narrows toward the tip
  const skin = (x: number) => TIP + ((R - TIP) * (x + L / 2)) / L;
  for (let x = -2; x <= 16; x += 6)
    for (const side of [-1, 1]) {
      shell.add(box(1.8, 2, 0.7, DARK, x, 2, side * (Math.sqrt(skin(x) ** 2 - 3 ** 2) + 0.1)));
      shell.add(box(6.4, 1.6, 0.8, BLUE, x, -3.8, side * (Math.sqrt(skin(x) ** 2 - 3 ** 2) - 0.1)));
    }
  brokenEnd(shell, L / 2, 1, R, 0);
  return g;
}

/** The wing that came off the south side: swept, lying with its torn root on the ground and its engine propping it up. Span along z (root at -z), 28 long. */
export function wingModel(): Group {
  const g = new Group();
  const wing = new Group();
  wing.position.y = 5.5;
  wing.rotation.x = -0.3; // the root rests on the ground, the engine holds the rest up
  const half = new Group();
  half.position.z = -14;
  half.add(planform(wingOutline(1, 28, 9, 18, 18, 6), 1.6, WHITE));
  half.add(planform(wingOutline(1, 27, -5, 4, 7.4, 2.6), 0.5, "#cfd4de").translateY(1.5)); // the flaps' lighter band along the back
  for (const [x, z] of [
    [8, 0.5],
    [4, 0.5],
    [-2, 0.5],
  ])
    half.add(box(3, 1.2, 1.6, "#cfd4de", x, 0.2, z)); // jagged at the torn root
  wing.add(half);
  g.add(wing);
  // the engine under it, out in front of the leading edge
  g.add(tube(2.9, 3.1, 9, GREY, -3, 3.3, 6, 14));
  g.add(tube(2.7, 2.7, 0.8, DARK, 1.6, 3.3, 6, 14));
  return g;
}

/** An engine torn off and lying on its side, with the fan at its front. */
export function engineModel(): Group {
  const g = new Group();
  const body = new Group();
  body.position.y = 3.8;
  body.rotation.z = 0.12;
  body.add(tube(3.8, 4.1, 11, WHITE, 0, 0, 0, 14));
  body.add(tube(3.2, 3.2, 1, DARK, 5.6, 0, 0, 14)); // the intake
  body.add(box(0.4, 5.6, 0.7, GREY, 6.2, 0, 0)); // fan blades
  body.add(box(0.4, 0.7, 5.6, GREY, 6.2, 0, 0));
  body.add(tube(3.4, 3.6, 3, "#4a4d57", -5.8, 0, 0, 14)); // the burnt rear
  g.add(body);
  return g;
}

/** Flames and a column of smoke where the engine burns (the smoke rises, spreads and thins, over and over). */
export function fireModel(): Group {
  const g = new Group();
  const flames = [
    { x: -1.2, z: 0.6, r: 2.2, h: 7, color: "#ff7a1a", ph: 0 },
    { x: 1.4, z: -0.8, r: 1.8, h: 9, color: "#ffb02e", ph: 1.7 },
    { x: 0.2, z: 1.4, r: 1.4, h: 5.5, color: "#ffd84a", ph: 3.1 },
  ].map((f) => {
    const m = new Mesh(new ConeGeometry(f.r, f.h, 7), new MeshBasicMaterial({ color: f.color }));
    m.position.set(f.x, f.h / 2 + 6.5, f.z);
    g.add(m);
    return { m, ...f };
  });
  const puffs = Array.from({ length: 6 }, (_, i) => {
    const m = new Mesh(new SphereGeometry(2.6, 8, 6), new MeshBasicMaterial({ color: "#5d6068", transparent: true, opacity: 0, depthWrite: false }));
    g.add(m);
    return { m, ph: i / 6 };
  });
  const place = (t: number) => {
    for (const f of flames) {
      const k = 1 + 0.22 * Math.sin(t * 9 + f.ph) + 0.1 * Math.sin(t * 17 + f.ph * 2);
      f.m.scale.set(1 - 0.08 * (k - 1), k, 1 - 0.08 * (k - 1));
      f.m.position.y = (f.h * k) / 2 + 6.5;
    }
    for (const p of puffs) {
      const u = (t * 0.16 + p.ph) % 1;
      p.m.position.set(u * 7 + Math.sin(u * 6 + p.ph * 9) * 1.5, 13 + u * 36, Math.cos(u * 5 + p.ph * 7) * 1.5);
      p.m.scale.setScalar(0.7 + u * 2.3);
      (p.m.material as MeshBasicMaterial).opacity = Math.min(1, u * 6) * (1 - u) * 0.62;
    }
  };
  place(0);
  g.userData.animate = ({ t }: AnimCtx) => {
    if (t > 0) place(t);
  };
  markMoving(g, ...flames.map((f) => f.m), ...puffs.map((p) => p.m));
  return g;
}

/** Loose wreckage: a torn panel, a row of seats, a suitcase, a wheel. */
export function debrisModel(key: string): Group {
  const g = new Group();
  const [kind, variant = "0"] = key.split("-");
  if (kind === "panel") {
    const colors = [WHITE, GREY, "#d8dbe2"];
    const c = colors[Number(variant) % colors.length];
    g.add(box(7, 0.6, 4.6, c, 0, 0, 0));
    g.add(box(2.6, 0.6, 2.2, c, 3.2, 0.3, -1.8)); // a torn corner, lifted
  } else if (kind === "seat") {
    g.add(box(6, 1.6, 4, BLUE, 0, 0, 0));
    g.add(box(1.2, 4.2, 4, BLUE_DK, -2.4, 1.6, 0));
    g.add(box(6, 1.6, 0.8, "#4a4d57", 0, 1.6, 2.2)); // the arm rest
  } else if (kind === "case") {
    const colors: Record<string, string> = { r: "#d8322c", b: "#2f74e0", g: "#7a5a3a" };
    g.add(box(5, 3.2, 3.2, colors[variant] ?? colors.g, 0, 0, 0));
    g.add(box(1.8, 0.5, 0.7, "#16161d", 0, 3.2, 0));
  } else if (kind === "wheel") {
    const tyre = cyl(3.4, 3.4, 2.4, "#1a1a20", 0, 0, 0, 14);
    tyre.rotation.x = Math.PI / 2;
    tyre.position.y = 3.4;
    g.add(tyre);
    const hub = cyl(1.6, 1.6, 2.7, GREY, 0, 0, 0, 10);
    hub.rotation.x = Math.PI / 2;
    hub.position.y = 3.4;
    g.add(hub);
  }
  return g;
}

// ---------------------------------------------------------------- the casualties

const SHIRTS = ["#d8322c", "#2f74e0", "#f4f4f4", "#3fae5a", "#8a4fd0", "#e8873c"];
const SKINS = ["#e8b890", "#c98f68", "#8d5a3b", "#f0c8a0"];
const BREATH: Record<string, number> = { g: 1.9, y: 2.6, r: 5.2, k: 0 }; // radians a second: the casualty's breathing rate (the dead do not)

const limeMat = new MeshBasicMaterial({ color: LIME });

/**
 * A casualty lying on the ground, head to +x. `key` is the triage colour (g, y, r, k) and a number for what they wear and how they lie.
 * Their vest starts grey (nobody has looked at them yet); when the drone's or the robot's sensor is on them a lime box flashes round
 * them, and the vest takes the triage colour.
 */
export function casualtyModel(key: string): Group {
  const tag = key[0] in TAGS ? key[0] : "g";
  const v = Number(key.slice(1)) || 0;
  const shirt = SHIRTS[(v * 2 + "gyrk".indexOf(tag)) % SHIRTS.length];
  const skin = SKINS[(v + "gyrk".indexOf(tag)) % SKINS.length];
  const g = new Group();

  for (const z of [-1.1, 1.1]) g.add(box(4.8, 1.6, 1.5, "#2a3a6a", -4.9, 0, z));
  g.add(box(5, 2.6, 4.4, shirt, 0, 0, 0));
  const head = new Group();
  head.add(box(3, 2.8, 3, skin, 0, 0, 0));
  head.add(box(3.2, 0.7, 3.2, v % 2 ? "#2a2d38" : "#6a4a2a", 0, 2.6, 0));
  head.position.set(4.1, 0, 0);
  g.add(head);
  g.add(box(4, 1.2, 1.2, shirt, -0.2, 0.3, -2.9)); // the arm that lies at their side

  const waving = tag === "g" && v === 1; // a green casualty (walking wounded) waves to be seen
  const arm = new Group();
  arm.position.set(1.8, 0.9, 2.9);
  arm.add(box(4, 1.2, 1.2, shirt, -2, -0.6, 0));
  if (waving) arm.add(box(1.4, 1.2, 1.2, skin, 0.8, -0.6, 0));
  arm.rotation.z = waving ? -1.35 : 0;
  g.add(arm);

  // the vest on the chest: grey until they are seen
  const vestMat = new MeshBasicMaterial({ color: tagGrey.clone() });
  const vest = new Mesh(new BoxGeometry(4.6, 0.5, 4), vestMat);
  vest.position.set(0, 2.85, 0);
  g.add(vest);

  // the detection: corner brackets round the body, flat on the ground
  const bbox = new Group();
  const hx = 8.4;
  const hz = 6.2;
  const arm4 = 3.6; // how far each bracket runs along the box's sides
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = -0.8 + sx * hx;
      const cz = sz * hz;
      bbox.add(new Mesh(new BoxGeometry(arm4, 0.4, 0.9), limeMat).translateX(cx - (sx * arm4) / 2 + sx * 0.45).translateZ(cz).translateY(0.3));
      bbox.add(new Mesh(new BoxGeometry(0.9, 0.4, arm4), limeMat).translateX(cx).translateZ(cz - (sz * arm4) / 2 + sz * 0.45).translateY(0.3));
    }
  bbox.visible = false;
  g.add(bbox);

  // a ping on the ground round a casualty who has been found and is waiting for a medic: a ring in their colour that swells and fades
  const pingMat = new MeshBasicMaterial({ color: TAGS[tag], transparent: true, opacity: 0, depthWrite: false });
  const ping = new Mesh(new RingGeometry(5.2, 6.4, 24), pingMat);
  ping.rotation.x = -Math.PI / 2;
  ping.position.y = 0.25;
  ping.visible = false;
  g.add(ping);

  const tagColor = new Color(TAGS[tag]);
  const rate = BREATH[tag];
  const apply = (seen: number, boxAmt: number, t: number, pinging: boolean) => {
    vestMat.color.copy(tagGrey).lerp(tagColor, seen);
    vest.position.y = 2.85 + (rate ? 0.2 * Math.sin(t * rate + v) : 0);
    bbox.visible = boxAmt > 0.03;
    bbox.scale.set(1 + (1 - boxAmt) * 0.7, 1, 1 + (1 - boxAmt) * 0.7);
    ping.visible = pinging;
    if (pinging) {
      const k = (t * 0.8 + v * 0.3) % 1;
      ping.scale.setScalar(0.8 + 1.1 * k);
      pingMat.opacity = 0.85 * (1 - k);
    }
    if (waving) arm.rotation.z = -1.3 + 0.45 * Math.sin(t * 5);
  };
  apply(0, 0, 0, false);

  // What the others know of them (see `dtcScan.casualties`): found by the drone or the robot, then waiting for a medic, who kneels by them
  // and so they are helped. When the drone or the robot comes to look at them again, they are due another visit.
  let state: CasualtyState | null = null;
  let seen = 0;
  let boxAmt = 0;
  let wasHit = false;
  let last = -1;
  g.userData.animate = ({ t }: AnimCtx) => {
    if (t <= 0) {
      apply(1, 0, 0, false); // reduced motion: everybody is tagged, and nothing flashes
      return;
    }
    if (!state) {
      state = { x: g.position.x, z: g.position.z, tag, found: false, claimed: false, helped: false, helpedAt: 0 };
      dtcScan.casualties.set(`${Math.round(state.x)},${Math.round(state.z)}`, state);
    }
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const near = (s: { on: boolean; x: number; z: number }, r: number) => s.on && Math.hypot(s.x - g.position.x, s.z - g.position.z) < r;
    const hit = near(dtcScan.drone, DRONE.hit) || near(dtcScan.spot, SPOT.hit);
    if (hit && !wasHit) {
      if (!state.found) state.found = true;
      else if (state.helped) state.helped = state.claimed = false; // looked at again: a medic is due back
    }
    wasHit = hit;
    seen += ((state.found ? 1 : 0) - seen) * (1 - Math.exp(-dt * (state.found ? 7 : 2.2)));
    boxAmt += ((hit ? 1 : 0) - boxAmt) * (1 - Math.exp(-dt * 10));
    apply(seen < 0.01 ? 0 : seen, boxAmt, t, state.found && !state.helped && seen > 0.9);
  };
  markMoving(g, vest, bbox, arm, ping);
  return g;
}

// ---------------------------------------------------------------- the medics

/**
 * A medic, white helmet with a red cross, red pack on the back, facing +x. `attachMedic` moves it and calls `userData.pose` with the
 * stride and how far it has knelt (`kneel`, 0 .. 1) to treat someone: it puts its bag down beside it and works with both hands.
 */
export function medicModel(): Group {
  const SCRUBS = "#2f7fd0";
  const RED = "#d8322c";
  const g = new Group();
  const figure = new Group(); // everything but the placement, so that the stride's bob and the kneel can move it
  g.add(figure);
  const limb = (z: number, y: number, len: number, color: string, w: number) => {
    const pivot = new Group(); // rotation.z swings it forward (+x)
    pivot.position.set(0, y, z);
    pivot.add(box(w, len, w, color, 0, -len, 0));
    figure.add(pivot);
    return pivot;
  };
  const legL = limb(-1.1, 4.5, 4.5, "#1f2a4a", 1.5);
  const legR = limb(1.1, 4.5, 4.5, "#1f2a4a", 1.5);
  const armL = limb(-2.7, 9.2, 4, SCRUBS, 1.1);
  const armR = limb(2.7, 9.2, 4, SCRUBS, 1.1);
  figure.add(box(2.6, 5, 4.4, SCRUBS, 0, 4.5, 0));
  figure.add(box(1.8, 3.6, 3.6, RED, -2.2, 5, 0)); // the pack on the back
  figure.add(box(3.2, 3, 3.2, "#e8b890", 0, 9.5, 0));
  figure.add(box(3.6, 1.3, 3.6, "#f4f4f4", 0, 12, 0)); // the helmet, with a red cross on top
  figure.add(box(2.6, 0.2, 0.8, RED, 0, 13.3, 0));
  figure.add(box(0.8, 0.2, 2.6, RED, 0, 13.3, 0));
  figure.add(box(1.6, 0.4, 3.2, "#f4f4f4", 2.4, 12, 0)); // brim: shows which way it faces

  const bag = new Group(); // set down beside the casualty while it works
  bag.position.set(0.5, 0, 5.6);
  bag.add(box(4.2, 2.4, 5.4, RED, 0, 0, 0));
  bag.add(box(2.4, 0.2, 0.7, "#f4f4f4", 0, 2.4, 0));
  bag.add(box(0.7, 0.2, 2.4, "#f4f4f4", 0, 2.4, 0));
  bag.visible = false;
  g.add(bag);

  g.userData.pose = ({ phase, swing, kneel, t }: MedicPose) => {
    const step = Math.sin(phase) * 0.6 * swing * (1 - kneel);
    legL.rotation.z = step + kneel * 1.0;
    legR.rotation.z = -step - kneel * 0.35;
    figure.position.y = 0.05 + Math.abs(Math.sin(phase)) * 0.25 * swing - kneel * 2.8;
    figure.rotation.z = -kneel * 0.42; // leans in over the casualty
    const press = Math.sin(t * 7) * 0.18; // the hands working
    armL.rotation.z = -step * 1.3 + kneel * (1.15 + press);
    armR.rotation.z = step * 1.3 + kneel * (1.15 - press);
    bag.visible = kneel > 0.4;
  };
  g.userData.pose({ phase: 0, swing: 0, kneel: 0, t: 0 });
  markMoving(g, figure, legL, legR, armL, armR, bag);
  return g;
}

// ---------------------------------------------------------------- the drone

/** The survey drone: four rotors, a camera under it, and (when it flies) the cone of what the camera sees. See `attachFlight`. */
export function droneModel(): Group {
  const g = new Group();
  const rig = new Group(); // everything that flies, lifted as one
  g.add(rig);

  // skids, body, a top plate, indicator lights, the camera
  for (const z of [-2.2, 2.2]) rig.add(box(6.4, 0.5, 0.6, "#1b1b22", 0, 0, z));
  rig.add(box(5.4, 2, 5.4, "#2c2f38", 0, 0.8, 0));
  rig.add(box(3.6, 0.6, 3.6, YELLOW, 0, 2.8, 0)); // (not white: it flies over the white fuselage)
  rig.add(box(0.8, 0.7, 0.8, LIME, 2.5, 1.8, 0)); // front light
  rig.add(box(0.8, 0.7, 0.8, "#ff3b30", -2.5, 1.8, 0)); // rear light
  rig.add(mesh(new SphereGeometry(1.3, 10, 8), toon("#16161d"), 1.4, 0.4, 0));
  const lensMat = new MeshBasicMaterial({ color: "#7fe8ff" }); // lights up lime while it is locked on
  const lens = new Mesh(new BoxGeometry(0.5, 0.8, 0.8), lensMat);
  lens.position.set(2.55, 0.8, 0);
  rig.add(lens);
  // the arms and the rotors at their ends
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const arm = box(15, 0.7, 0.9, "#3d4048", 0, 1.4, 0);
    arm.rotation.y = rot;
    rig.add(arm);
  }
  const pivots: Group[] = [];
  const discs: MeshBasicMaterial[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(sx * 5.3, 2.4, sz * 5.3);
      rig.add(box(1.6, 1.2, 1.6, "#1b1b22", sx * 5.3, 1, sz * 5.3));
      pivot.add(box(7, 0.2, 0.7, "#1b1b22", 0, 0, 0)); // dark blades, deep green at the tips, so they show over the white fuselage
      for (const end of [-1, 1]) pivot.add(box(1.8, 0.25, 1.2, TIP_GREEN, end * 2.8, 0, 0));
      const mat = new MeshBasicMaterial({ color: "#16161d", transparent: true, opacity: 0.1, depthWrite: false });
      const disc = new Mesh(new CylinderGeometry(3.6, 3.6, 0.1, 14), mat);
      pivot.add(disc);
      rig.add(pivot);
      pivots.push(pivot);
      discs.push(mat);
    }

  // the lock-on: while it looks at a casualty, a narrow beam of light runs from its camera down to them (no shadows: it is light)
  const beamMat = new MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
  const beam = new Mesh(new CylinderGeometry(0.35, 1.7, 1, 12, 1, true), beamMat); // narrow end up, at the camera
  beam.visible = false;
  g.add(beam);
  const lime = new Color(LIME);
  const lensOff = new Color("#7fe8ff");
  const camera = new Vector3(1.4, 0, 0);
  const target = new Vector3();
  const along = new Vector3();

  let spin = 0;
  const flight = ({ alt, focus, power, dt, t, aim }: FlightPose) => {
    rig.position.y = alt + (alt > 1 ? 0.6 * Math.sin(t * 2.4) : 0);
    spin += dt * power * 70;
    pivots.forEach((p, i) => (p.rotation.y = spin * (i % 3 === 0 ? 1 : -1) + i));
    for (const m of discs) m.opacity = 0.08 + 0.22 * power;
    const k = smooth((focus - 0.6) / 0.4); // locked on only once it is nearly over them
    lensMat.color.copy(lensOff).lerp(lime, k);
    beam.visible = k > 0.02;
    if (beam.visible) {
      camera.y = rig.position.y + 0.4;
      target.set(aim.dx, 0.4, aim.dz);
      along.subVectors(camera, target); // from the casualty up to the camera
      const len = along.length();
      beam.position.copy(target).addScaledVector(along, 0.5);
      beam.scale.set(1, len, 1);
      beam.quaternion.setFromUnitVectors(UP, along.divideScalar(len));
      beamMat.opacity = 0.3 * k * (0.8 + 0.2 * Math.sin(t * 38));
    }
  };
  g.userData.setFlight = flight;
  flight({ alt: 0, lift: 0, focus: 0, power: 0, dt: 0, t: 0, aim: { dx: 0, dz: 0 } });
  markMoving(g, rig, beam, ...pivots);
  return g;
}

// ---------------------------------------------------------------- the robot

/**
 * A Spot-like legged robot, yellow with a black head, a sensor mast on its back, facing +x. `attachPatrol` moves it and calls
 * `userData.pose` with the stride and how far the mast is up and sweeping.
 */
export function spotModel(): Group {
  const BLACK = "#1b1b22";
  const g = new Group();
  const figure = new Group(); // everything but the placement, so that the stride's bob can lift it
  g.add(figure);
  figure.add(box(11, 3.4, 5.2, YELLOW, 0, 3.7, 0));
  figure.add(box(9, 0.8, 4.6, BLACK, 0, 3.3, 0)); // the belly
  figure.add(box(2.6, 2.6, 4.4, BLACK, 6.3, 4, 0)); // the head
  for (const z of [-1.2, 1.2]) figure.add(box(0.4, 0.9, 0.9, "#7fe8ff", 7.65, 4.6, z)); // its eyes
  figure.add(box(4.6, 0.8, 3.2, "#3d4048", -1.4, 7.1, 0)); // the payload's base plate

  const mast = new Group(); // rises and sweeps while it scans
  mast.position.set(-1.4, 7.9, 0);
  mast.add(box(1.4, 2.2, 1.4, BLACK, 0, 0, 0));
  mast.add(box(2.6, 1.7, 2.6, "#3d4048", 0, 2.2, 0));
  mast.add(box(0.5, 0.9, 0.9, "#7fe8ff", 1.4, 2.7, 0)); // its lens
  figure.add(mast);

  const legs = [] as { hip: Group; knee: Group; off: number }[];
  for (const sx of [1, -1])
    for (const sz of [1, -1]) {
      const hip = new Group();
      hip.position.set(sx * 4.2, 5.2, sz * 2.9);
      hip.add(box(1.3, 2.9, 1.3, YELLOW, 0, -2.9, 0));
      const knee = new Group();
      knee.position.set(0, -2.9, 0);
      knee.add(box(1, 3.1, 1, BLACK, 0, -3.1, 0));
      hip.add(knee);
      figure.add(hip);
      legs.push({ hip, knee, off: sx * sz > 0 ? 0 : Math.PI }); // diagonal pairs step together
    }

  g.userData.pose = ({ phase, swing, scan, t }: SpotPose) => {
    for (const { hip, knee, off } of legs) {
      hip.rotation.z = 0.55 + 0.42 * swing * Math.sin(phase + off);
      knee.rotation.z = -1.1 - 0.5 * swing * Math.max(0, Math.cos(phase + off));
    }
    figure.position.y = 0.05 + 0.25 * swing * Math.abs(Math.sin(phase));
    mast.position.y = 7.9 + 2.2 * scan;
    mast.rotation.y = scan * 1.1 * Math.sin(t * 2.6);
  };
  g.userData.pose({ phase: 0, swing: 0, scan: 0, t: 0 });
  markMoving(g, figure, mast, ...legs.flatMap((l) => [l.hip, l.knee]));
  return g;
}

/** Builds the model for a DARPA Triage Challenge area prop id, or null when the id is not one of ours. */
export function dtcModel(id: string): Group | null {
  if (!id.startsWith("dtc-")) return null;
  const key = id.slice(4);
  if (key.startsWith("casualty-")) return casualtyModel(key.slice(9));
  if (key.startsWith("debris-")) return debrisModel(key.slice(7));
  switch (key) {
    case "fuselage":
      return fuselageModel();
    case "tail":
      return tailModel();
    case "wing":
      return wingModel();
    case "engine":
      return engineModel();
    case "fire":
      return fireModel();
    case "drone":
      return droneModel();
    case "spot":
      return spotModel();
    case "medic":
      return medicModel();
  }
  throw new Error(`Unknown DTC model: ${id}`);
}
