import { AdditiveBlending, CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { AnimCtx } from "./models";
import { NAME, NAME_H, NAME_SCALE } from "./name";
import { NAME_BOX, NAME_PATH } from "./namepath";

// The light on the ground under the name when it is hovered: a soft warm halo that follows the letters' own shape (not a
// rectangle), added to the ground, like the halo under the formula car when it is hovered. It is a flat plane of its own in the
// name's zone, so the hover lift that raises the letters does not raise it. The letters lift on top of it and cover its middle, so
// what shows is the light spilling out round and between them. Same conventions as models.ts: 1 unit = 1 world px, origin at the
// middle of the name's footprint on the ground (the letters' model has the same origin).

const WARM = "255,217,166"; // the car's halo colour
const PAD = 44; // map px of glow beyond the name's footprint, on every side
const RES = 2; // texture px per map px
const STRENGTH = 0.55; // opacity at full hover; it breathes a little round this (see below)
const HEIGHT = 0.2; // above the ground's shadow and leaf layers, which lie a few hundredths up

/**
 * The glow, drawn once from the name's baked outline: its silhouette blurred twice (a tight halo and a wide one), and a faint, wide,
 * soft pool of light behind them. The blur is done with a shadow of the shape drawn off the canvas, which every browser does.
 */
function glowTexture(): CanvasTexture {
  const W = Math.round((NAME.letters + 2 * PAD) * RES);
  const H = Math.round((NAME_H + 2 * PAD) * RES);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // a faint pool of light under the whole name
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, H / W);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
  pool.addColorStop(0, `rgba(${WARM},0.14)`);
  pool.addColorStop(1, `rgba(${WARM},0)`);
  ctx.fillStyle = pool;
  ctx.fillRect(-W / 2, -W / 2, W, W);
  ctx.restore();

  // the halos: the silhouette, drawn a canvas-width off to the left, with its shadow (blurred) landing back in place
  const path = new Path2D(NAME_PATH);
  const halo = (blur: number, alpha: number) => {
    ctx.save();
    ctx.shadowColor = `rgba(${WARM},${alpha})`;
    ctx.shadowBlur = blur * RES;
    ctx.shadowOffsetX = W;
    ctx.translate(-W + W / 2, (PAD + NAME_BOX.y1 * NAME_SCALE) * RES); // (the shapes are y-up, with the baseline at y = 0)
    ctx.scale(NAME_SCALE * RES, -NAME_SCALE * RES);
    ctx.translate(-(NAME_BOX.x0 + NAME_BOX.x1) / 2, 0);
    ctx.fillStyle = "#000";
    ctx.fill(path);
    ctx.restore();
  };
  halo(22, 0.55); // wide and soft
  halo(22, 0.55);
  halo(8, 0.9); // tight, bright round the edges

  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export function nameGlowModel(): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({
    map: glowTexture(),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glow = new Mesh(new PlaneGeometry(NAME.letters + 2 * PAD, NAME_H + 2 * PAD), mat);
  glow.rotation.x = -Math.PI / 2; // lie flat, reading upright from the south
  glow.position.y = HEIGHT;
  glow.renderOrder = 1;
  glow.castShadow = false;
  glow.userData.noPick = true; // (never something to click: the letters' own zone is the click area)
  glow.visible = false;
  g.add(glow);
  g.userData.flat = true; // a light on the ground does not rise with the letters

  g.userData.animate = ({ hover, t }: AnimCtx) => {
    mat.opacity = hover * (STRENGTH + 0.15 * Math.sin(t * 4)); // a gentle breath, so that it reads as live (steady when motion is reduced: t is 0)
    glow.visible = hover > 0.001;
  };
  return g;
}
