import { CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { box } from "./models";
import type { AnimCtx } from "./models";

// Models for the contact area: three small plaques on posts, each carrying one mark (email, LinkedIn, GitHub).
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground.

const CREAM = "#f4ecd8";
const PAPER_EDGE = "#cfbf9b";
const BROWN = "#8a5a35";
const POST = "#6b4226";

type Mark = "email" | "linkedin" | "github";

/** One plaque's face: a cream square with its mark drawn large in brown. */
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

function easeInOut(k: number) {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

/**
 * Three plaques in a row on short posts, leaning back toward the viewer. Still at rest; on hover they tip up a little
 * more, one after another, so the group seems to nod hello. `w` is the footprint width the group is spread across.
 */
export function plaquesModel(w: number): Group {
  const g = new Group();
  const marks: Mark[] = ["email", "linkedin", "github"];
  const POST_H = 28;
  const BOARD = 32;
  const gap = Math.min(40, (w - BOARD) / 2);
  const REST = (40 * Math.PI) / 180;
  const EXTRA = (14 * Math.PI) / 180;

  const boards: Group[] = [];
  marks.forEach((mark, i) => {
    const x = (i - 1) * gap;
    g.add(box(2.6, POST_H, 2.6, POST, x, 0, 0));
    g.add(box(8, 1.4, 5, POST, x, 0, 0)); // a small foot

    const pivot = new Group();
    pivot.position.set(x, POST_H - 2, 0);
    pivot.rotation.x = -REST;
    pivot.add(box(BOARD, BOARD, 2.2, CREAM, 0, 0, 0)); // the board
    pivot.add(box(BOARD + 1.4, 1.6, 2.6, PAPER_EDGE, 0, 0, 0)); // a lower rim
    const face = new Mesh(new PlaneGeometry(BOARD - 3, BOARD - 3), new MeshBasicMaterial({ map: markTexture(mark) }));
    face.position.set(0, BOARD / 2, 1.2);
    pivot.add(face);
    g.add(pivot);
    boards.push(pivot);
  });

  g.userData.animate = ({ hover }: AnimCtx) => {
    boards.forEach((b, i) => {
      // the wave: each board starts a little after the one before it
      const a = easeInOut((hover - i * 0.14) / 0.72);
      b.rotation.x = -(REST + a * EXTRA);
    });
  };
  return g;
}
