import { CanvasTexture, ExtrudeGeometry, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, BoxGeometry, Shape } from "three";
import type { Material } from "three";
import { drawIcon } from "./marks";
import type { IconId } from "./marks";
import { box, mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { MODULE } from "./name";

// The mailbox: one cluster unit of three modules standing side by side, a link each. Each module is its own model (and its own
// zone), so that hovering or pressing one is exactly one door.
//
// The camera looks down at about 58 degrees, so a vertical face is squashed to about half its height and an icon on it would be
// tiny. So the front of each module slopes back, like a sorting desk: it is nearly face-on to the camera, and its door
// shows its icon at close to its true size. Same conventions as models.ts: 1 unit = 1 world px, origin at the middle of
// the footprint on the ground, +z = south (the front, toward the camera).

const BROWN = "#3b2a20"; // the site's dark brown
const CREAM = "#efe6d0";

const D = MODULE.depth;
const H = MODULE.height;
const FH = MODULE.frontHeight;
const SLOPE = Math.atan2(D, H - FH); // how far the front leans back from the vertical
const SL = Math.hypot(D, H - FH); // the sloped front's length

const DOOR_W = 40;
const DOOR_H = 30;

/** A door: cream, with its icon large in the site's dark brown, a thin inner border and a knob. */
function doorTexture(id: IconId): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 150;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.roundRect(0, 0, 200, 150, 14);
  ctx.fill();
  ctx.strokeStyle = "#cdbf9d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 8, 184, 134, 9);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle = BROWN;
  drawIcon(ctx, id, 100, 70, 2.5);
  ctx.fillStyle = "#b08d57"; // a brass knob, low on the right
  ctx.beginPath();
  ctx.arc(172, 124, 7, 0, 6.283);
  ctx.fill();
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.anisotropy = 8;
  return t;
}

/** The letter inside: a cream envelope with a flap. */
function letterTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 84;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f6efdd";
  ctx.fillRect(0, 0, 128, 84);
  ctx.strokeStyle = "#b9ab8c";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 80);
  ctx.beginPath();
  ctx.moveTo(4, 6);
  ctx.lineTo(64, 46);
  ctx.lineTo(124, 6);
  ctx.stroke();
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  return t;
}

const ease = (a: number) => a + 0.12 * Math.sin(Math.PI * a); // a little overshoot

/**
 * One mailbox module for a link: a dark brown body with a sloped front, and on it a recessed slot with a cream door carrying the
 * link's icon. When the module's zone is hovered the door swings open from its top hinge and the letter inside tips toward you.
 */
export function mailModule(id: IconId): Group {
  const g = new Group();
  const w = MODULE.w;

  // the body: a side profile, extruded across the module's width
  const profile = new Shape();
  profile.moveTo(D / 2, 0);
  profile.lineTo(D / 2, FH);
  profile.lineTo(-D / 2, H);
  profile.lineTo(-D / 2, 0);
  const geo = new ExtrudeGeometry(profile, { depth: w, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); // the profile's width becomes z, its extrusion runs along -x
  geo.translate(w / 2, 0, 0);
  g.add(mesh(geo, toon(BROWN)));
  g.add(box(w + 1.2, 1.6, D + 1.2, "#2a1c12", 0, 0, 0)); // a dark footing, a little proud of the body

  // the sloped front, as a frame: x across, y up the slope, z out of it
  const face = new Group();
  face.position.set(0, FH, D / 2);
  face.rotation.x = -SLOPE;
  g.add(face);

  const midY = SL / 2;
  face.add(mesh(new BoxGeometry(DOOR_W + 6, DOOR_H + 4, 0.8), toon("#1c130c"), 0, midY, 0.4)); // the recess

  const letter = new Mesh(new PlaneGeometry(32, 21), new MeshBasicMaterial({ map: letterTexture() }));
  letter.position.set(0, midY - 2, 0.7);
  letter.castShadow = false;
  face.add(letter);

  // the door, hinged along its top edge
  const pivot = new Group();
  pivot.position.set(0, midY + DOOR_H / 2, 1);
  const edge = toon("#2f2218");
  const front = toon("#ffffff").clone();
  front.map = doorTexture(id);
  const mats: Material[] = [edge, edge, edge, edge, front, edge];
  const door = new Mesh(new BoxGeometry(DOOR_W, DOOR_H, 1.2), mats);
  door.position.set(0, -DOOR_H / 2, 0.2);
  door.castShadow = true;
  door.receiveShadow = true;
  pivot.add(door);
  face.add(pivot);

  g.userData.animate = ({ hover }: AnimCtx) => {
    const a = ease(hover);
    pivot.rotation.x = -a * 1.2; // the bottom edge swings out toward the viewer
    letter.position.z = 0.7 + a * 6;
    letter.rotation.x = a * 0.3;
  };
  return g;
}
