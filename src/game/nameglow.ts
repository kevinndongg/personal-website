import { AdditiveBlending, CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import type { AnimCtx } from "./models";
import { NAME, NAME_H } from "./name";

// The light on the ground under the name when it is hovered: one soft warm pool of light over the whole name, an oval that fades
// out at its edge (no letter shapes, no rectangle), added to the ground, like the halo under the formula car when it is hovered.
// It is a flat plane of its own in the name's zone, so the hover lift that raises the letters does not raise it. The letters lift
// on top of it, so the light shows round and between them. Same conventions as models.ts: 1 unit = 1 world px, origin at the middle
// of the name's footprint on the ground (the letters' model has the same origin).

const WARM = "255,217,166"; // the car's halo colour
const PAD_X = 45; // map px of glow beyond the name's footprint, to the left and right
const PAD_Y = 30; // ... and to the north and south (the name is low and wide, so this is what makes the pool look round and not squashed)
const RES = 2; // texture px per map px
const STRENGTH = 0.5; // opacity at full hover: steady, with no pulse
const PEAK = 0.4; // the light's alpha at the middle of the pool (the car's is 1)
const HEIGHT = 0.2; // above the ground's shadow and leaf layers, which lie a few hundredths up

/**
 * An oval of warm light, brightest in the middle and fading to nothing at its edge. It is kept well under the car's halo (which peaks
 * at 1): the letters are beige, so a stronger light would bring the ground near the middle up to their own colour and lose them.
 */
function poolTexture(): CanvasTexture {
  const W = Math.round((NAME.letters + 2 * PAD_X) * RES);
  const H = Math.round((NAME_H + 2 * PAD_Y) * RES);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, H / W); // a circle, squashed into an oval that fills the canvas
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, W / 2);
  fade.addColorStop(0, `rgba(${WARM},${PEAK})`);
  fade.addColorStop(0.55, `rgba(${WARM},${PEAK * 0.6})`);
  fade.addColorStop(1, `rgba(${WARM},0)`);
  ctx.fillStyle = fade;
  ctx.fillRect(-W / 2, -W / 2, W, W);
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export function nameGlowModel(): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({
    map: poolTexture(),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glow = new Mesh(new PlaneGeometry(NAME.letters + 2 * PAD_X, NAME_H + 2 * PAD_Y), mat);
  glow.rotation.x = -Math.PI / 2; // lie flat, reading upright from the south
  glow.position.y = HEIGHT;
  glow.renderOrder = 1;
  glow.castShadow = false;
  glow.userData.noPick = true; // (never something to click: the letters' own zone is the click area)
  glow.visible = false;
  g.add(glow);
  g.userData.flat = true; // a light on the ground does not rise with the letters

  g.userData.animate = ({ hover }: AnimCtx) => {
    mat.opacity = hover * STRENGTH; // it comes up and goes down with the hover (already eased), and is steady in between
    glow.visible = hover > 0.001;
  };
  return g;
}
