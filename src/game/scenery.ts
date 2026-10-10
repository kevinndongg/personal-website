import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";
import type { Footprint, Prop } from "./scenes";
import type { Zone } from "./world";
import { box, mesh, toon } from "./models";
import type { AnimCtx } from "./models";

// Models for the photography area: an Olympus OM-1 and a light table holding two strips of film.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground, +x = forward.

const SILVER = "#c3c7cf";
const SILVER_DARK = "#9ea3ad";
const BLACK = "#1b1c20";

/** A cylinder whose axis points along +x (forward), centred at (x, y, z). */
function axle(r: number, len: number, color: string, x: number, y: number, z: number, seg = 24): Mesh {
  const m = mesh(new CylinderGeometry(r, r, len, seg), toon(color), x, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

function ease(k: number) {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

// ---------------------------------------------------------------- the camera

/**
 * Olympus OM-1 (the 1970s film SLR): black leatherette body, silver top plate with a prism hump, a lens with a
 * shutter-speed ring, a rewind knob and a film advance lever that swings every few seconds. Lens toward +x.
 * Footprint is about 32 deep (x) by 46 wide (z).
 */
function omCameraModel(): Group {
  const g = new Group();
  const bx = -6; // body centre along x; the lens sticks out in front of it
  g.add(box(16.4, 1.6, 44.4, SILVER_DARK, bx, 0, 0)); // bottom plate
  g.add(box(16, 17.4, 44, BLACK, bx, 1.6, 0)); // leatherette body
  g.add(box(16.4, 5, 44.4, SILVER, bx, 19, 0)); // top plate
  g.add(box(14, 5.4, 13.6, SILVER, bx, 24, 0)); // prism hump
  g.add(box(0.5, 1.8, 9, "#15161a", bx + 7.1, 25.6, 0)); // name plate on the prism
  g.add(box(0.3, 10, 38, "#26272c", bx + 8.1, 5, 0)); // textured front panel
  for (const z of [-22.6, 22.6]) g.add(box(2.2, 2.4, 1.2, SILVER_DARK, bx, 20, z)); // strap lugs

  // lens
  const y = 12;
  g.add(axle(11, 1.6, SILVER, 2.8, y, 0)); // mount ring
  g.add(axle(10.2, 3, "#2a2b30", 5.1, y, 0)); // shutter-speed ring
  for (const x of [4.2, 5.1, 6]) g.add(axle(10.5, 0.45, SILVER_DARK, x, y, 0, 24)); // its silver ridges
  g.add(axle(9, 9, BLACK, 10.9, y, 0)); // barrel
  g.add(axle(9.7, 5, "#26272c", 10.5, y, 0)); // focus ring
  g.add(axle(9.3, 1.2, SILVER, 15.6, y, 0)); // chrome front rim
  g.add(axle(7, 0.5, "#1d3550", 16.35, y, 0)); // front glass
  const glint = new Mesh(
    new PlaneGeometry(3.4, 11),
    new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending })
  );
  glint.rotation.y = Math.PI / 2;
  glint.rotation.order = "YXZ";
  glint.position.set(16.7, y + 1, -1.5);
  g.add(glint);

  // top controls: rewind knob (viewer's right), shutter release and the advance lever (viewer's left)
  g.add(mesh(new CylinderGeometry(3.4, 3.4, 2.6, 16), toon(SILVER_DARK), bx - 2, 25.4, -17));
  g.add(mesh(new CylinderGeometry(1.4, 1.4, 1.6, 10), toon("#c0392b"), bx - 2, 24.8, 11));
  const lever = new Group();
  lever.position.set(bx - 2, 24.2, 15.5); // pivot on the top plate, resting along the plate and pointing outward (+z)
  lever.add(box(2.2, 0.7, 11, SILVER, 0, 0, 5.5));
  lever.add(box(3.2, 1.3, 3.4, SILVER_DARK, 0, -0.1, 11));
  lever.add(mesh(new CylinderGeometry(1.5, 1.5, 1.2, 10), toon(SILVER_DARK), 0, -0.2, 0));
  g.add(lever);

  g.userData.animate = ({ t, hover }: AnimCtx) => {
    // one stroke every 6 seconds: out and across quickly, a brief hold, then easing back to rest
    const k = t % 6;
    let a = 0;
    if (t > 0) {
      if (k < 0.45) a = ease(k / 0.45) * 2.1;
      else if (k < 0.65) a = 2.1;
      else if (k < 1.3) a = 2.1 * (1 - ease((k - 0.65) / 0.65));
    }
    lever.rotation.y = a;
    // a soft sweep of light across the glass when the box is hovered
    (glint.material as MeshBasicMaterial).opacity = hover * (0.4 + 0.3 * Math.sin(t * 1.7));
    glint.position.z = -1.5 + Math.sin(t * 1.1) * 2.5;
  };
  return g;
}

// ---------------------------------------------------------------- film strips

const FRAME_W = 288;
const FRAME_H = 192;
const GAP = 24;
const BAND = 48; // film base above and below the frames, carrying the sprocket holes
const FRAMES_PER_ROW = 4;
const STRIP_W = FRAMES_PER_ROW * (FRAME_W + GAP) + GAP;
const STRIP_H = FRAME_H + BAND * 2;

/**
 * Three canvases for one strip of film made from up to four photos: the colour print, a black-and-white copy, and a soft
 * blurred bright copy used for the haze. Frames start mid-grey and fill in as the images load.
 */
function stripTextures(urls: string[]) {
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = STRIP_W;
    c.height = STRIP_H;
    return c;
  };
  const color = mk();
  const bw = mk();
  const haze = mk();
  const small = document.createElement("canvas");
  small.width = Math.round(STRIP_W / 8);
  small.height = Math.round(STRIP_H / 8);
  const textures = { color: new CanvasTexture(color), bw: new CanvasTexture(bw), haze: new CanvasTexture(haze) };
  for (const t of Object.values(textures)) {
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
  }
  const images: (HTMLImageElement | null)[] = urls.map(() => null);

  const paint = () => {
    const ctx = color.getContext("2d")!;
    ctx.clearRect(0, 0, STRIP_W, STRIP_H);
    ctx.fillStyle = "#1d1a17";
    ctx.fillRect(0, 0, STRIP_W, STRIP_H);
    urls.forEach((_, i) => {
      const x = GAP + i * (FRAME_W + GAP);
      const im = images[i];
      if (im && im.naturalWidth) {
        // cover-fit the photo into the frame
        const s = Math.max(FRAME_W / im.naturalWidth, FRAME_H / im.naturalHeight);
        const sw = FRAME_W / s;
        const sh = FRAME_H / s;
        ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, BAND, FRAME_W, FRAME_H);
      } else {
        ctx.fillStyle = "#55524d";
        ctx.fillRect(x, BAND, FRAME_W, FRAME_H);
      }
    });
    // sprocket holes are cut right through the film so the table shows through them
    for (let x = 14; x < STRIP_W - 30; x += 54) {
      ctx.clearRect(x, 10, 30, 26);
      ctx.clearRect(x, STRIP_H - 36, 30, 26);
    }
    // black and white copy
    const img = ctx.getImageData(0, 0, STRIP_W, STRIP_H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = Math.min(255, (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 1.05);
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    bw.getContext("2d")!.putImageData(img, 0, 0);
    // haze: shrink then stretch back up (a cheap blur that works without ctx.filter), then brighten
    const sctx = small.getContext("2d")!;
    sctx.clearRect(0, 0, small.width, small.height);
    sctx.drawImage(color, 0, 0, small.width, small.height);
    const hctx = haze.getContext("2d")!;
    hctx.clearRect(0, 0, STRIP_W, STRIP_H);
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(small, 0, 0, STRIP_W, STRIP_H);
    hctx.globalCompositeOperation = "lighter";
    hctx.globalAlpha = 0.3;
    hctx.drawImage(small, 0, 0, STRIP_W, STRIP_H);
    hctx.globalAlpha = 1;
    hctx.globalCompositeOperation = "source-over";
    for (const t of Object.values(textures)) t.needsUpdate = true;
  };

  paint();
  urls.forEach((u, i) => {
    const im = new Image();
    im.onload = () => {
      images[i] = im;
      paint();
    };
    im.src = u;
  });
  return textures;
}

/** A soft radial light (white in the middle, clear at the edge), for the glow and the haze above the table. */
function radialTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/**
 * The light table: a low dark frame with a frosted plate and two strips of film. Off, the plate is dull and the photos are
 * black and white; hovering switches the light on, the photos turn to colour and glow through the film with a haze.
 */
function lightTableModel(w: number, d: number, zone: Zone | undefined): Group {
  const g = new Group();
  const TOP = 7;
  g.add(box(w, TOP, d, "#2b2d33", 0, 0, 0));
  g.add(box(w + 0.8, 0.8, d + 0.8, "#4a4d57", 0, TOP - 0.8, 0)); // lip
  const plateMat = new MeshBasicMaterial({ color: "#6f7176" });
  const plate = new Mesh(new PlaneGeometry(w - 10, d - 10), plateMat);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = TOP + 0.05;
  g.add(plate);

  const urls = zone?.strip?.length ? zone.strip : [];
  const pick = (i: number) => urls[i % Math.max(1, urls.length)] ?? "";
  const rows = [-21, 19];
  const stripLen = w - 12;
  const stripH = (stripLen * STRIP_H) / STRIP_W;
  const bwMats: MeshBasicMaterial[] = [];
  const colorMats: MeshBasicMaterial[] = [];
  const hazeMats: MeshBasicMaterial[] = [];

  rows.forEach((z, row) => {
    const tex = stripTextures(Array.from({ length: FRAMES_PER_ROW }, (_, i) => (urls.length ? pick(row * FRAMES_PER_ROW + i) : "")));
    const layer = (map: CanvasTexture, y: number, scale: number, mat: MeshBasicMaterial, order: number) => {
      mat.map = map;
      mat.transparent = true;
      mat.depthWrite = false;
      const m = new Mesh(new PlaneGeometry(stripLen * scale, stripH * (scale > 1 ? 1.6 : 1)), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, y, z);
      m.renderOrder = order;
      g.add(m);
    };
    const bwMat = new MeshBasicMaterial({ color: "#8c8c8c" });
    const colorMat = new MeshBasicMaterial({ color: "#ffffff", opacity: 0 });
    const hazeMat = new MeshBasicMaterial({ color: "#ffffff", opacity: 0, blending: AdditiveBlending });
    layer(tex.bw, TOP + 0.15, 1, bwMat, 3);
    layer(tex.color, TOP + 0.25, 1, colorMat, 4);
    layer(tex.haze, TOP + 0.4, 1.06, hazeMat, 5);
    bwMats.push(bwMat);
    colorMats.push(colorMat);
    hazeMats.push(hazeMat);
  });

  // warm glow on the plate and a soft bloom above it (both only visible while the light is on)
  const radial = radialTexture();
  const glowMat = new MeshBasicMaterial({
    map: radial,
    color: "#ffe6b0",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const glow = new Mesh(new PlaneGeometry(w + 8, d + 8), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = TOP + 0.3;
  glow.renderOrder = 4;
  g.add(glow);
  const bloomMat = glowMat.clone();
  const bloom = new Mesh(new PlaneGeometry(w + 70, d + 70), bloomMat);
  bloom.rotation.x = -Math.PI / 2;
  bloom.position.y = TOP + 7;
  bloom.renderOrder = 6;
  g.add(bloom);

  const off = new Color("#6f7176");
  const on = new Color("#e8e0c8");
  g.userData.animate = ({ t, hover }: AnimCtx) => {
    const h = Math.min(1, Math.max(0, hover));
    const breath = 1 + Math.sin(t * 1.4) * 0.06 * h;
    plateMat.color.copy(off).lerp(on, h);
    for (const m of bwMats) m.color.setScalar(0.55 + 0.4 * h);
    for (const m of colorMats) m.opacity = h;
    for (const m of hazeMats) m.opacity = h * 0.42 * breath;
    glowMat.opacity = h * 0.22 * breath;
    bloomMat.opacity = h * 0.12 * breath;
  };
  return g;
}

// ---------------------------------------------------------------- dispatch

/** Builds a model for a photography-area prop id, or null when the id is not one of ours. */
export function sceneryModel(id: string, footprint: Footprint | undefined, _prop: Prop, zones: Zone[]): Group | null {
  const w = footprint?.kind === "rect" ? footprint.w : 0;
  const d = footprint?.kind === "rect" ? footprint.h : 0;
  switch (id) {
    case "omcamera":
      return omCameraModel();
    case "lighttable":
      return lightTableModel(w, d, zones.find((z) => z.kind === "gallery"));
  }
  return null;
}
