import { CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { BUTTON_SIZE } from "./name";

// Models for the contact buttons: round discs lying on the ground like pressure plates, each carrying one mark (email,
// LinkedIn, GitHub). Dark at rest, so they sit quietly beside the name, and they light up when hovered.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground.

const RIM = "#2a2521"; // the plate the disc sits in
const CAP_REST = new Color("#35302b");
const CAP_LIT = new Color("#5b4a3a");
const MARK_REST = new Color("#7d705e"); // the mark, dim
const MARK_LIT = new Color("#fff1d0"); // ... and lit, like a backlit switch

type Mark = "email" | "linkedin" | "github";

/** One button's mark, drawn in white on a transparent square (the material tints it, and the cap shows through). */
function markTexture(mark: Mark): CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";

  if (mark === "email") {
    // an envelope: a rounded outline with a V flap
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.roundRect(48, 76, 160, 108, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(52, 84);
    ctx.lineTo(128, 142);
    ctx.lineTo(204, 84);
    ctx.stroke();
  } else if (mark === "linkedin") {
    // the "in" badge: a solid rounded square with the letters knocked out
    ctx.beginPath();
    ctx.roundRect(50, 50, 156, 156, 30);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.font = "bold 104px 'Figtree', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("in", 128, 168);
  } else {
    // code brackets and a slash: </>
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(90, 82);
    ctx.lineTo(42, 128);
    ctx.lineTo(90, 174);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(166, 82);
    ctx.lineTo(214, 128);
    ctx.lineTo(166, 174);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(148, 66);
    ctx.lineTo(108, 190);
    ctx.stroke();
  }

  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const R = BUTTON_SIZE / 2;
const RIM_H = 4; // the plate the disc sits in
const CAP_H = 4; // the disc, standing proud of the plate
const CAP_R = R - 5;
const SEGMENTS = 48;

/**
 * One round button lying on the ground. Hovering its zone raises the whole model (the zone does that) and, here, lights
 * it: the cap warms up and the mark glows.
 */
export function buttonModel(mark: Mark): Group {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(R, R, RIM_H, SEGMENTS), toon(RIM), 0, RIM_H / 2, 0));

  const capMat = toon("#35302b").clone(); // (its own: the shared one is for every other model of that colour)
  g.add(mesh(new CylinderGeometry(CAP_R, CAP_R, CAP_H, SEGMENTS), capMat, 0, RIM_H + CAP_H / 2, 0));

  // the mark, flat on the cap's top, reading upright from the south
  const markMat = new MeshBasicMaterial({ map: markTexture(mark), alphaTest: 0.35, side: DoubleSide });
  const face = new Mesh(new PlaneGeometry(CAP_R * 1.5, CAP_R * 1.5), markMat);
  face.rotation.x = -Math.PI / 2;
  face.position.set(0, RIM_H + CAP_H + 0.05, 0);
  g.add(face);

  g.userData.animate = ({ hover }: AnimCtx) => {
    capMat.color.lerpColors(CAP_REST, CAP_LIT, hover);
    markMat.color.lerpColors(MARK_REST, MARK_LIT, hover);
  };
  return g;
}
