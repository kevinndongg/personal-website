import { CanvasTexture, Color, DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { BUTTON_SIZE } from "./name";

// Models for the contact buttons: rounded squares lying on the ground, each carrying one mark (email, LinkedIn, GitHub).
// At rest they are the site's own dark brown, so they sit quietly beside the name, and they light up when hovered.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground.

/** A colour of the site's theme (src/styles/global.css), so that the scene stays in step with it. */
function themeColor(name: string, fallback: string): Color {
  const value = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(value || fallback);
}

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

const SIZE = BUTTON_SIZE;
const PLATE_H = 4; // the plate the cap sits in
const CAP_H = 4; // the cap, standing proud of the plate
const CAP = SIZE - 8;

/**
 * One rounded-square button lying on the ground. Hovering its zone raises the whole model (the zone does that) and, here,
 * lights it: the cap warms up to the accent brown and the mark glows.
 */
export function buttonModel(mark: Mark): Group {
  const rest = themeColor("--color-text", "#3b2a20"); // the dark brown, for the plate and the cap alike
  const capLit = themeColor("--color-accent", "#8a5a35");
  const markRest = themeColor("--color-text-muted", "#7a6552");
  const markLit = themeColor("--color-bg", "#f5f1ea");

  const g = new Group();
  g.add(mesh(new RoundedBoxGeometry(SIZE, PLATE_H, SIZE, 3, 12), toon(rest.getStyle()), 0, PLATE_H / 2, 0));

  const capMat = toon(rest.getStyle()).clone(); // (its own: the shared one is for every other model of that colour)
  g.add(mesh(new RoundedBoxGeometry(CAP, CAP_H, CAP, 3, 10), capMat, 0, PLATE_H + CAP_H / 2, 0));

  // the mark, flat on the cap's top, reading upright from the south
  const markMat = new MeshBasicMaterial({ map: markTexture(mark), alphaTest: 0.35, side: DoubleSide });
  const face = new Mesh(new PlaneGeometry(CAP * 0.78, CAP * 0.78), markMat);
  face.rotation.x = -Math.PI / 2;
  face.position.set(0, PLATE_H + CAP_H + 0.05, 0);
  g.add(face);

  g.userData.animate = ({ hover }: AnimCtx) => {
    capMat.color.lerpColors(rest, capLit, hover);
    markMat.color.lerpColors(markRest, markLit, hover);
  };
  return g;
}
