import { CanvasTexture, Color, ExtrudeGeometry, Group, LinearFilter, Mesh, PlaneGeometry, Shape } from "three";
import type { BufferGeometry } from "three";
import { mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { BUTTON_SIZE } from "./name";
import { LETTERS } from "./namemodel";

// Models for the contact buttons: small rounded squares lying on the ground, shaped like the LinkedIn badge, each carrying
// one mark (email, LinkedIn, GitHub). Cream, the colour of the name, with the mark in the site's dark brown; hovered, they
// light up. Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground.

/** A colour of the site's theme (src/styles/global.css), so that the scene stays in step with it. */
function themeColor(name: string, fallback: string): Color {
  const value = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(value || fallback);
}

type Mark = "email" | "linkedin" | "github";

/** One button's mark, drawn in white on a transparent square (the material tints it, and the button shows through). */
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
const RADIUS = 10.5; // about a fifth of the side, like the corners of the LinkedIn badge
const BODY_H = 5; // the straight sides
const BEVEL = 1.2; // the top edge is eased over by this much

/** A rounded square, `side` wide, centred on the origin. */
function roundedSquare(side: number, r: number): Shape {
  const h = side / 2;
  const s = new Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(h, h - r);
  s.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-h + r, h);
  s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-h, -h + r);
  s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** A rounded slab lying on the ground, rising from y = 0 by `depth` (plus `bevel` over its top edge, which grows it by that much all round). */
function slab(side: number, r: number, depth: number, bevel: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(roundedSquare(side - 2 * bevel, r - bevel), {
    depth,
    curveSegments: 16,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  geometry.rotateX(-Math.PI / 2); // lie down, rising from the ground
  geometry.translate(0, bevel, 0); // (the bevel reaches that far below the face the extrusion starts from)
  return geometry;
}

/**
 * One small rounded-square button lying on the ground: a cream slab (the name's colour) with straight sides and an eased top
 * edge, and the mark on it in the site's dark brown. Hovering its zone raises the whole model (the zone does that) and, here,
 * lights it up from the name's cream to the theme's.
 */
export function buttonModel(mark: Mark): Group {
  const brown = themeColor("--color-text", "#3b2a20");
  const rest = new Color(LETTERS); // the same cream as the name
  const lit = themeColor("--color-bg", "#f5f1ea");

  const g = new Group();
  const bodyMat = toon(rest.getStyle()).clone(); // (its own: it changes colour)
  g.add(mesh(slab(SIZE, RADIUS, BODY_H, BEVEL), bodyMat));

  // The mark is lit like the slab is (the same kind of material), and flat on top like the name's letters.
  const top = BODY_H + 2 * BEVEL;
  const markMat = toon(brown.getStyle()).clone();
  markMat.map = markTexture(mark);
  markMat.alphaTest = 0.35;
  const face = new Mesh(new PlaneGeometry(SIZE * 0.62, SIZE * 0.62), markMat);
  face.rotation.x = -Math.PI / 2;
  face.position.set(0, top + 0.05, 0);
  g.add(face);

  g.userData.animate = ({ hover }: AnimCtx) => {
    bodyMat.color.lerpColors(rest, lit, hover);
  };
  return g;
}
