import { BoxGeometry, CanvasTexture, ExtrudeGeometry, Group, LinearFilter, Mesh, Shape } from "three";
import type { Material } from "three";
import { drawIcon } from "./marks";
import type { IconId } from "./marks";
import { box, mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { SLAB } from "./name";

// The link slabs: three low slabs side by side below the name, a link each. Each is its own model (and its own zone), so that
// hovering or pressing one is exactly one plate. A slab is a low dark brown wedge, 10 tall at the back, with a large cream plate
// carrying the link's icon, standing in a bezel. The plate is dimmed at rest and brightens as it is hovered, and rises a little out
// of its bezel. The slab is low, so that its shadow (which runs north about 1.3 px for every px of height) stays short, and
// its top leans only a little, so the plate is seen at nearly its true size. Same conventions as models.ts: 1 unit = 1 world px,
// origin at the middle of the footprint on the ground, +z = south (the front, toward the camera).

const BROWN = "#3b2a20"; // the site's dark brown
const CREAM = "#efe6d0";

const D = SLAB.depth;
const H = SLAB.height;
const FH = SLAB.frontHeight;
const SLOPE = Math.atan2(D, H - FH); // the top's lean, as the angle its frame is turned from the vertical
const SL = Math.hypot(D, H - FH); // the sloped top's length

const PLATE_W = 42;
const PLATE_H = 27;
const REST = 0.72; // how bright the plate is at rest (1 = full cream)
const RISE = 2.5; // how far the plate rises out of its bezel on hover
const PLATE_Z = 0.8; // where it sits at rest, above the top
const BEZEL = 2; // how far the bezel stands above the top

/** A plate: cream, with its icon large in the site's dark brown and a thin inner border. */
function plateTexture(id: IconId): CanvasTexture {
  const w = 168;
  const h = 108;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = "#cdbf9d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, w - 12, h - 12, 6);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle = BROWN;
  drawIcon(ctx, id, w / 2, h / 2, 2.7);
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.anisotropy = 8;
  return t;
}

/**
 * One link slab: a low dark brown wedge with a cream plate in a bezel on its top. When its zone is hovered the plate brightens from a
 * dimmed cream to full cream and rises a little out of the bezel. Nothing flips or opens.
 */
export function linkSlab(id: IconId): Group {
  const g = new Group();
  const w = SLAB.w;

  // the body: a side profile, extruded across the slab's width
  const profile = new Shape();
  profile.moveTo(D / 2, 0);
  profile.lineTo(D / 2, FH);
  profile.lineTo(-D / 2, H);
  profile.lineTo(-D / 2, 0);
  const geo = new ExtrudeGeometry(profile, { depth: w, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); // the profile's width becomes z, its extrusion runs along -x
  geo.translate(w / 2, 0, 0);
  g.add(mesh(geo, toon(BROWN)));
  g.add(box(w + 1.2, 1.2, D + 1.2, "#2a1c12", 0, 0, 0)); // a dark footing, a little proud of the body

  // the sloped top, as a frame: x across, y up the slope, z out of it
  const face = new Group();
  face.position.set(0, FH, D / 2);
  face.rotation.x = -SLOPE;
  g.add(face);

  const midY = SL / 2;
  // the bezel: a dark rim round the plate, standing a little above it at rest. (box() puts the bottom of a box at y, so in this frame
  // each strip runs along the slope from y, and stands out of the top from z = 0 up to BEZEL, centred on BEZEL / 2.)
  const rim = "#2a1c12";
  const gap = 0.8; // between the plate and the rim
  const t = 1.6; // the rim's width
  const outerW = PLATE_W + 2 * (gap + t);
  const outerH = PLATE_H + 2 * (gap + t);
  const y0 = midY - outerH / 2;
  face.add(box(outerW, t, BEZEL, rim, 0, y0 + outerH - t, BEZEL / 2)); // the strip toward the back
  face.add(box(outerW, t, BEZEL, rim, 0, y0, BEZEL / 2)); // the strip toward the front
  for (const side of [-1, 1]) face.add(box(t, outerH, BEZEL, rim, (side * (outerW - t)) / 2, y0, BEZEL / 2));
  face.add(mesh(new BoxGeometry(PLATE_W + 2 * gap, PLATE_H + 2 * gap, 0.4), toon("#1c130c"), 0, midY, 0.2)); // the floor of the bezel

  // the plate
  const edge = toon("#2f2218");
  const front = toon("#ffffff").clone(); // (its own: its brightness changes)
  front.map = plateTexture(id);
  const mats: Material[] = [edge, edge, edge, edge, front, edge];
  const plate = new Mesh(new BoxGeometry(PLATE_W, PLATE_H, 1.2), mats);
  plate.position.set(0, midY, PLATE_Z);
  plate.castShadow = true;
  plate.receiveShadow = true;
  face.add(plate);

  g.userData.animate = ({ hover }: AnimCtx) => {
    plate.position.z = PLATE_Z + RISE * hover; // out of the bezel
    front.color.setScalar(REST + (1 - REST) * hover); // dimmed at rest, full cream when hovered
  };
  front.color.setScalar(REST);
  return g;
}
