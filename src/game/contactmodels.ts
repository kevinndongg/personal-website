import { CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mesh, toon } from "./models";
import { BUTTON_SIZE } from "./name";

// Models for the contact area: big square buttons lying on the ground, each carrying one mark (email, LinkedIn, GitHub).
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground.

const CREAM = "#f4ecd8";
const PAPER_EDGE = "#cfbf9b";
const BROWN = "#8a5a35";
const HOUSING = "#6b4226";

type Mark = "email" | "linkedin" | "github";

/** One button's face: a cream square with its mark drawn large in brown. */
function markTexture(mark: Mark): CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, S - 10, S - 10);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = BROWN;
  ctx.fillStyle = BROWN;

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
    ctx.fillStyle = CREAM;
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
const HOUSING_H = 4; // the dark housing the button sits in
const CAP_H = 4; // the button's cap, standing proud of the housing

/**
 * One big square button lying on the ground, with its mark on the cap. It is still: hovering it is hovering its zone, which
 * makes the whole model rise.
 */
export function buttonModel(mark: Mark): Group {
  const g = new Group();
  g.add(mesh(new RoundedBoxGeometry(SIZE, HOUSING_H, SIZE, 2, 2.5), toon(HOUSING), 0, HOUSING_H / 2, 0));
  g.add(mesh(new RoundedBoxGeometry(SIZE - 6, CAP_H, SIZE - 6, 2, 2), toon(CREAM), 0, HOUSING_H + CAP_H / 2, 0));
  // the mark, flat on the cap's top, reading upright from the south
  const face = new Mesh(new PlaneGeometry(SIZE - 10, SIZE - 10), new MeshBasicMaterial({ map: markTexture(mark) }));
  face.rotation.x = -Math.PI / 2;
  face.position.set(0, HOUSING_H + CAP_H + 0.05, 0);
  g.add(face);
  return g;
}
