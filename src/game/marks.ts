import { IN_BOX, IN_PATH } from "./namepath";

// The three link marks, drawn with canvas 2D: an envelope, the LinkedIn badge with its "in", and the code brackets </>.

export type IconId = "email" | "linkedin" | "github";
export const ICON_IDS: IconId[] = ["email", "linkedin", "github"];

let inPath: Path2D | undefined;

/**
 * One icon around (cx, cy), about 36 units across (scaled by `s`), drawn with the context's current fill and stroke styles.
 * The "in" comes from the font's own outline, so nothing waits on a web font.
 */
export function drawIcon(ctx: CanvasRenderingContext2D, id: IconId, cx: number, cy: number, s = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const line = (width: number, ...pts: [number, number][]) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  if (id === "email") {
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.roundRect(-18, -13, 36, 26, 4);
    ctx.stroke();
    line(3.4, [-9, -5], [0, 4], [9, -5]);
  } else if (id === "linkedin") {
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.roundRect(-16, -16, 32, 32, 8);
    ctx.stroke();
    inPath ??= new Path2D(IN_PATH);
    const k = 15 / (IN_BOX.y1 - IN_BOX.y0);
    ctx.scale(k, -k);
    ctx.translate(-(IN_BOX.x0 + IN_BOX.x1) / 2, -(IN_BOX.y0 + IN_BOX.y1) / 2);
    ctx.fill(inPath);
  } else {
    line(3.6, [-7.5, -7], [-15, 0], [-7.5, 7]);
    line(3.6, [7.5, -7], [15, 0], [7.5, 7]);
    line(3.4, [3.5, -9], [-3.5, 9]);
  }
  ctx.restore();
}
