import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Texture,
  Vector3,
} from "three";
import type { Object3D } from "three";
import type { Footprint, Prop } from "./scenes";
import type { Zone, ZonePhoto } from "./world";
import { box, mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { ImageCache } from "./photocache";

// Models for the photography area: an Olympus OM-1 and a light table. The table shows the photos a page at a time: six
// frames of film laid out on it (two strips of two landscape photos, and one strip of two portrait ones). The camera is
// the remote control: the advance lever and the rewind knob flip to the next or previous page (or, zoomed in, photo), and
// the shutter button zooms the view into the selected photo or back out to the page.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground, +x = forward.

const SILVER = "#c3c7cf";
const SILVER_DARK = "#9ea3ad";
const BLACK = "#1b1c20";
// The rewind knob, the advance lever and the shutter button are silver (red) like the rest, but each has a colour of its
// own (a shade off): the materials are shared by colour, and these are tinted when the pointer is over them.
const KNOB_COLOR = "#9ea3ae";
const LEVER_ARM = "#c3c7d0";
const LEVER_TIP = "#9ea3af";
const SHUTTER_COLOR = "#c0392c";

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

/** The remainder of a / n that is never negative. */
const wrap = (a: number, n: number) => ((a % n) + n) % n;

// ---------------------------------------------------------------- pages

// A page is a fixed set of slots: slots 0..3 are the landscape ones (two strips of two: slots 0 and 1 on the back strip,
// 2 and 3 on the front one, each left to right) and slots 4 and 5 the portrait ones (one strip of two, top to bottom).
export const LANDSCAPE_SLOTS = 4;
export const PORTRAIT_SLOTS = 2;
export const PAGE_SLOTS = LANDSCAPE_SLOTS + PORTRAIT_SLOTS;

export interface PageLayout {
  /** For each page, the photo in each of its slots (an index into the photos), or -1 for an empty slot. */
  pages: number[][];
  /** For each photo, the page it is on and the slot it is in. */
  pageOf: number[];
  slotOf: number[];
}

/**
 * Splits the photos (given by their width over height) into pages, in gallery order: a landscape photo takes the next free
 * landscape slot and a portrait one the next portrait slot, and a page ends when the next photo's kind has no free slot.
 * So every page is a run of the gallery in order, and a page can have an empty slot. Works for any number of photos.
 */
export function buildPages(aspects: number[]): PageLayout {
  const pages: number[][] = [];
  const pageOf: number[] = [];
  const slotOf: number[] = [];
  let cur: number[] = new Array(PAGE_SLOTS).fill(-1);
  let landscape = 0;
  let portrait = 0;
  aspects.forEach((a, i) => {
    const isPortrait = a < 1;
    if (isPortrait ? portrait >= PORTRAIT_SLOTS : landscape >= LANDSCAPE_SLOTS) {
      pages.push(cur);
      cur = new Array(PAGE_SLOTS).fill(-1);
      landscape = 0;
      portrait = 0;
    }
    const slot = isPortrait ? LANDSCAPE_SLOTS + portrait++ : landscape++;
    cur[slot] = i;
    pageOf[i] = pages.length;
    slotOf[i] = slot;
  });
  if (aspects.length) pages.push(cur);
  return { pages, pageOf, slotOf };
}

// ---------------------------------------------------------------- the film winder

// A stroke is the time before the next one can start (clicks wait in a short queue), so these are kept short.
const STROKE_OUT = 0.2; // the lever sweeps out to its advanced place; the page (or photo) changes meanwhile
const STROKE_HOLD = 0.27; // ...holds there a moment...
const STROKE_END = 0.5; // ...and eases back to rest
const KNOB_TURN = 0.45; // the rewind knob makes one full turn in this long when the film goes back
const AUTO_EVERY = 7; // seconds of quiet on the map before the lever gives a stroke by itself, for life

/** Which control on the camera the pointer is over, so it can light up. */
export type FilmHint = "lever" | "rewind" | "shutter";

/** What the table is showing: the whole page of photos, or the view zoomed into one photo. */
export type FilmMode = "page" | "photo";

/**
 * What the camera, the light table and the page share. `frame` is the selected photo (the outlined one on the page, the one
 * the view is zoomed into). A stroke of the lever or the knob moves on one page (page view) or one photo (photo view), in
 * gallery order, wrapping at the ends. The camera reads `lever` and `knob` to place its controls; the table reads `page`,
 * `index` and `mode`. `step(t)` moves it on and is safe to call from both models every frame.
 */
export class FilmRig {
  /** The selected photo, an index into the photos (use `index`, which is always in range). */
  frame = 0;
  /** The page of photos, or zoomed into one of them. */
  mode: FilmMode = "page";
  /** Seconds into the current stroke, or null while it is at rest. */
  phase: number | null = null;
  /** Which way the current (or last) stroke goes: 1 to the next page or photo, -1 to the previous one. */
  dir: 1 | -1 = 1;
  /** The control under the pointer, set from outside, for the camera to light up. */
  hint: FilmHint | null = null;
  /** The photo under the pointer on the page, set from outside, for the table to outline. */
  hoverIndex: number | null = null;
  /** The camera's controls in the scene, for the page to hang labels on (set by the camera model). */
  anchors: { rewind?: Object3D; lever?: Object3D; shutter?: Object3D } = {};
  /** The four world-space corners of photo `index` on the table, for the view to frame (set by the table model). */
  photoCorners?: (index: number) => Vector3[];
  /** Whether the lever may give a stroke by itself when nobody has used it for a while (the map: yes; open: no). */
  idleAllowed = true;
  /** Called when the selected photo changes, with its index. */
  onFrame?: (index: number) => void;
  readonly layout: PageLayout;
  private queued: (1 | -1)[] = []; // strokes asked for (a click) that have not started yet
  private committed = false; // this stroke has already moved on
  private decorative = false; // this stroke is just the lever idling: it does not change anything
  private idleSince = 0; // scene time the last stroke ended
  private lastT = 0;
  private steppedAt = NaN;

  /** `aspects` is the width over height of every photo, in gallery order. */
  constructor(readonly aspects: number[] = []) {
    this.layout = buildPages(aspects);
  }

  get count(): number {
    return this.aspects.length;
  }

  /** The selected photo, wrapped into range (0 with no photos). */
  get index(): number {
    return this.count ? wrap(this.frame, this.count) : 0;
  }

  /** The page the selected photo is on. */
  get page(): number {
    return this.count ? this.layout.pageOf[this.index] : 0;
  }

  get pageCount(): number {
    return this.layout.pages.length;
  }

  /** The photo in a slot of the page the selected photo is on, or -1. */
  photoAt(slot: number): number {
    return this.layout.pages[this.page]?.[slot] ?? -1;
  }

  /** Zooms the view into photo `i`. */
  zoomIn(i: number) {
    if (!this.count) return;
    this.frame = wrap(i, this.count);
    this.mode = "photo";
    this.onFrame?.(this.index);
  }

  zoomOut() {
    this.mode = "page";
  }

  /** The shutter: zoom into the selected photo, or back out to the page. */
  toggleZoom() {
    if (!this.count) return;
    this.mode = this.mode === "photo" ? "page" : "photo";
  }

  /**
   * Ask for a stroke: 1 (the default) goes to the next page (or photo, zoomed in), -1 to the previous one. A click in
   * the middle of one waits for it to finish, then strokes. Asking for more than two at once drops the rest.
   */
  queue(direction: 1 | -1 = 1) {
    if (this.queued.length < 2) this.queued.push(direction);
  }

  /** How far the advance lever is toward its advanced place: 0 parked .. 1 out to the side of the body. */
  get lever(): number {
    const k = this.phase;
    if (k === null || this.dir < 0) return 0;
    if (k < STROKE_OUT) return ease(k / STROKE_OUT);
    if (k < STROKE_HOLD) return 1;
    if (k < STROKE_END) return 1 - ease((k - STROKE_HOLD) / (STROKE_END - STROKE_HOLD));
    return 0;
  }

  /** How far round the rewind knob has turned in a backward stroke: 0 at rest .. 1 a whole turn (the same look as 0). */
  get knob(): number {
    const k = this.phase;
    if (k === null || this.dir > 0) return 0;
    return ease(k / KNOB_TURN);
  }

  step(t: number) {
    if (t <= 0) {
      // reduced motion: the scene clock is held at 0, so nothing moves; a click just changes the page (this branch is
      // idempotent on its own, since each call drains the queue)
      for (let d = this.queued.shift(); d !== undefined; d = this.queued.shift()) {
        this.dir = d;
        this.decorative = false;
        this.advance();
      }
      return;
    }
    if (t === this.steppedAt) return;
    this.steppedAt = t;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;

    if (this.phase === null) {
      const asked = this.queued.shift();
      if (asked === undefined && (!this.idleAllowed || t - this.idleSince < AUTO_EVERY)) return;
      this.decorative = asked === undefined;
      this.dir = asked ?? 1;
      this.phase = 0;
    } else {
      this.phase += dt;
    }

    if (!this.committed && this.phase >= STROKE_OUT) {
      this.committed = true;
      if (!this.decorative) this.advance();
    }
    if (this.phase >= STROKE_END) {
      this.phase = null;
      this.committed = false;
      this.decorative = false;
      this.idleSince = t;
    }
  }

  /** One page on (or back) in page view, one photo in photo view; the first photo of the page it lands on is selected. */
  private advance() {
    if (!this.count) return;
    if (this.mode === "photo") {
      this.frame = wrap(this.frame + this.dir, this.count);
    } else {
      const p = wrap(this.page + this.dir, this.pageCount);
      this.frame = Math.min(...this.layout.pages[p].filter((i) => i >= 0));
    }
    this.onFrame?.(this.index);
  }
}

const rigs = new WeakMap<Zone, FilmRig>();

/** The film winder for a gallery zone (the camera and the light table of one world share it). */
export function filmRig(zone: Zone): FilmRig {
  let rig = rigs.get(zone);
  if (!rig) rigs.set(zone, (rig = new FilmRig((zone.photos ?? []).map((p) => p.aspect))));
  return rig;
}

// ---------------------------------------------------------------- the camera

/**
 * Olympus OM-1 (the 1970s film SLR): black leatherette body, silver top plate with a prism hump, a lens with a
 * shutter-speed ring, a rewind knob, a shutter button and a film advance lever. Lens toward +x.
 * Footprint is about 32 deep (x) by 46 wide (z).
 */
function omCameraModel(rig: FilmRig): Group {
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

  // top controls: rewind knob (viewer's right), shutter button and the advance lever (viewer's left)
  // Each is a group tagged with a `part`, so a click knows which control it landed on, with an invisible, wider pad round
  // it (the knob and the button are small) to make it easier to hit.
  const pad = (r: number, h: number) =>
    new Mesh(new CylinderGeometry(r, r, h, 16), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  // The knob winds the film back, so it turns when the page goes back. A dark bar across its top shows the turn.
  const KNOB_X = bx - 2;
  const KNOB_Z = -17;
  const knob = new Group();
  knob.position.set(KNOB_X, 25.4, KNOB_Z);
  knob.userData.part = "rewind";
  knob.add(mesh(new CylinderGeometry(3.4, 3.4, 2.6, 16), toon(KNOB_COLOR), 0, 0, 0));
  knob.add(box(1, 0.4, 5.8, "#15161a", 0, 1.2, 0));
  const knobPad = pad(7, 6);
  knobPad.position.y = 0.6;
  knob.add(knobPad);
  g.add(knob);
  // a ring on the plate round the knob: there once the project is open (it is a button), bold under the pointer
  const ringMat = new MeshBasicMaterial({ color: "#ff7a1a", transparent: true, opacity: 0, depthWrite: false });
  const ring = new Mesh(new RingGeometry(4.9, 6.6, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(KNOB_X, 24.15, KNOB_Z);
  ring.renderOrder = 8;
  ring.userData.noPick = true; // decoration: the knob's hit pad is the thing to click
  g.add(ring);
  // the shutter button zooms the view into the selected photo, or back out to the page
  const shutter = new Group();
  shutter.position.set(bx - 2, 24.8, 11);
  shutter.userData.part = "shutter";
  shutter.add(mesh(new CylinderGeometry(1.4, 1.4, 1.6, 10), toon(SHUTTER_COLOR), 0, 0, 0));
  const shutterPad = pad(3.4, 5);
  shutterPad.position.y = 0.6;
  shutter.add(shutterPad);
  g.add(shutter);
  const lever = new Group();
  lever.position.set(bx - 2, 24.2, 15.5); // pivot on the top plate; at rest it is parked across the middle of the plate
  lever.rotation.y = -2.1;
  lever.userData.part = "lever";
  lever.add(box(2.2, 0.7, 11, LEVER_ARM, 0, 0, 5.5));
  lever.add(box(3.2, 1.3, 3.4, LEVER_TIP, 0, -0.1, 11));
  lever.add(mesh(new CylinderGeometry(1.5, 1.5, 1.2, 10), toon(LEVER_TIP), 0, -0.2, 0));
  g.add(lever);
  rig.anchors = { rewind: knob, lever, shutter };

  // The controls light up amber when the pointer is over them (the whole camera body counts as the lever: it goes to the
  // next page too). Their colours are their own, so tinting them does not touch the other silver parts.
  const AMBER = new Color("#ffb020");
  const tint = [
    { mat: toon(KNOB_COLOR), base: new Color(KNOB_COLOR), glow: 0, hint: "rewind" as const },
    { mat: toon(LEVER_ARM), base: new Color(LEVER_ARM), glow: 0, hint: "lever" as const },
    { mat: toon(LEVER_TIP), base: new Color(LEVER_TIP), glow: 0, hint: "lever" as const },
    { mat: toon(SHUTTER_COLOR), base: new Color(SHUTTER_COLOR), glow: 0, hint: "shutter" as const },
  ];
  let rewindGlow = 0; // how lit the knob's ring is, eased
  let lastT = 0;
  g.userData.animate = ({ t, hover, focus }: AnimCtx) => {
    // On the map the lever gives a stroke now and then, for life; once the project is open it moves only when used.
    rig.idleAllowed = focus < 0.5;
    // Going to the next page (clicked): from its parked place in the middle the lever sweeps away from the lens, out to
    // the side of the body (the advanced place), holds a moment, then eases back to where it started. Going back, the
    // lever stays put and the rewind knob makes a full turn instead.
    rig.step(t);
    lever.rotation.y = -2.1 * (1 - rig.lever);
    knob.rotation.y = -Math.PI * 2 * rig.knob;
    const k = 1 - Math.exp(-Math.max(0, t - lastT) * 14);
    lastT = t;
    rewindGlow += ((rig.hint === "rewind" ? 1 : 0) - rewindGlow) * k;
    ringMat.opacity = focus * (0.3 + 0.7 * rewindGlow);
    for (const c of tint) {
      c.glow += ((rig.hint === c.hint ? 1 : 0) - c.glow) * k;
      c.mat.color.copy(c.base).lerp(AMBER, c.glow);
    }
    // a soft sweep of light across the glass when the box is hovered
    (glint.material as MeshBasicMaterial).opacity = hover * (0.4 + 0.3 * Math.sin(t * 1.7));
    glint.position.z = -1.5 + Math.sin(t * 1.1) * 2.5;
  };
  return g;
}

// ---------------------------------------------------------------- the light table's film

// Film is laid out in its own pixels, then scaled to fit the plate. A strip is one continuous piece of film: a band along
// each long edge carrying sprocket holes at a constant pitch (so the holes run unbroken past the frames and the gaps
// between them), the photo windows in a row between the bands, and each frame's number printed in the band beside it. A
// landscape strip runs left to right; the portrait strip is the same film turned on its side, holes down its left and right.
const WIN_LONG = 1100; // the long side of a photo's window
const WIN_SHORT = 825; // the short side (4:3)
const BAND = 90; // film base along each long edge, carrying the holes (and the number)
const GAP = 80; // plain film between frames, and at each end of the strip
const HOLE_PITCH = 72;
const HOLE_LEN = 34; // along the strip
const HOLE_WID = 26; // across it
const HOLE_INSET = 14; // from the strip's edge
const STRIP_LEN = 2 * WIN_LONG + 3 * GAP;
const STRIP_WID = WIN_SHORT + 2 * BAND;
// The film's own canvas (holes, numbers) is small, and so are the black-and-white copy and the haze: the photos
// themselves are never drawn into a canvas for the lit view, they go on as textures at their own resolution.
// The film base (holes, windows) is painted once and is seen at its edges when a landscape photo is framed, so it is
// sharper than the copies; the frame numbers are separate little canvases, so a page change repaints almost nothing.
const BASE_SCALE = 0.8;
const BW_SCALE = 0.5;
const HAZE_SCALE = 1 / 8;
const NUM_SCALE = 2; // pixels per film pixel of a frame number's canvas
const NUM_H = 48; // the number's box (film px): wide enough for three digits, and tall enough for them

/** A photo's window on a strip, in the strip's own film pixels. */
interface Cell {
  slot: number;
  wx: number;
  wy: number;
  ww: number;
  wh: number;
}

/** Where a photo of this aspect goes in a window: the whole photo, centred (a squarer photo is narrower than the window). */
function fitInWindow(cell: Cell, aspect: number) {
  const wide = aspect >= cell.ww / cell.wh;
  const w = wide ? cell.ww : cell.wh * aspect;
  const h = wide ? cell.ww / aspect : cell.wh;
  return { x: cell.wx + (cell.ww - w) / 2, y: cell.wy + (cell.wh - h) / 2, w, h };
}

/** A strip of film of two photos: the canvases and layers that show it. */
interface Strip {
  cells: Cell[];
  landscape: boolean;
  w: number; // film px
  h: number;
  base: HTMLCanvasElement; // the film itself: the base, the windows and the holes (cut through), painted once
  bw: HTMLCanvasElement; // the unlit look: all of it, photos included, in black and white
  haze: HTMLCanvasElement; // a small, blurry copy of the photos for the glow
  tex: { base: CanvasTexture; bw: CanvasTexture; haze: CanvasTexture };
  mats: { base: MeshBasicMaterial; bw: MeshBasicMaterial; haze: MeshBasicMaterial };
  meshes: { base: Mesh; bw: Mesh; haze: Mesh };
}

/** One photo on the table: an unlit plane showing the image itself, as it was shot. */
interface PhotoPlane {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  ready: boolean; // it has an image to show
  src: string | null; // what it was last given to show
  amt: number; // 0..1: how far it has come in (a photo that changes while looking at one fades in over the old one)
  // The photo that was here before, held under the new one while it fades in (so a page change is a crossfade, not a dip).
  ghost: Mesh;
  ghostMat: MeshBasicMaterial;
  ghostSrc: string | null;
  ghostA: number; // 0..1
  ghostT: number; // seconds since it was put there
}

/** A frame number: a little canvas of its own, so changing page repaints a few hundred pixels, not the film. */
interface NumberPlate {
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  mat: MeshBasicMaterial;
  mesh: Mesh;
}

/**
 * The light table: a low dark frame with a frosted plate and, on it, a page of photos on film. Off (the map, not hovered)
 * the plate is dull and the photos are black and white; hovering switches the light on, the photos turn to colour and glow
 * through the film with a haze. Opened, that light is off the photos for good: they are shown as they were shot, with no
 * haze, no glow and nothing under or over them. A click on a photo, or the camera's controls, zoom the view into it.
 */
function lightTableModel(w: number, d: number, zone: Zone | undefined, rig: FilmRig): Group {
  const g = new Group();
  const TOP = 5; // thickness of the table top
  const TILT = (10 * Math.PI) / 180; // propped up at the back so it faces the viewer a little
  const PIVOT = 28; // height of the top's centre above the floor
  const top = new Group();
  top.position.y = PIVOT;
  top.rotation.x = TILT; // positive raises the north (back) edge
  g.add(top);
  // four legs: each reaches up to the underside of the tilted top, so the back ones are taller
  const legMat = "#8a8f9a";
  const lxs = [-(w / 2 - 4), w / 2 - 4];
  const lzs = [-(d / 2 - 4), d / 2 - 4];
  for (const lx of lxs) {
    for (const lz of lzs) {
      const h = PIVOT - lz * Math.sin(TILT) + 0.5;
      g.add(box(3, h, 3, legMat, lx, 0, lz));
    }
  }
  for (const lx of lxs) g.add(box(1.6, 1.6, d - 8, legMat, lx, 9, 0)); // side rails
  g.add(box(w - 8, 1.6, 1.6, legMat, 0, 9, d / 2 - 4)); // front rail
  g.add(box(w - 8, 1.6, 1.6, legMat, 0, 9, -(d / 2 - 4))); // back rail
  top.add(box(w, TOP, d, "#2b2d33", 0, 0, 0));
  // The lip is a raised rim round the edge, standing 0.3 above the top. Nothing here shares a height with anything else
  // (two faces at the same height fight over every pixel and flicker): the plate and each layer on it are 0.3 apart.
  const RIM = 0.8;
  const rimY = TOP - 0.8;
  const rimH = 1.1;
  for (const z of [-d / 2, d / 2]) top.add(box(w + RIM, rimH, RIM, "#4a4d57", 0, rimY, z));
  for (const x of [-w / 2, w / 2]) top.add(box(RIM, rimH, d - RIM, "#4a4d57", x, rimY, 0));
  const Y_PLATE = TOP + 0.5;
  const Y_BW = TOP + 0.8;
  const Y_BASE = TOP + 1.1;
  const Y_NUM = TOP + 1.2;
  const Y_GHOST = TOP + 1.3;
  const Y_PHOTO = TOP + 1.4;
  const Y_HAZE = TOP + 1.7;
  const Y_SLOT = TOP + 2.0;
  const Y_MARK = TOP + 2.3;
  const plateMat = new MeshBasicMaterial({ color: "#6f7176" });
  const plate = new Mesh(new PlaneGeometry(w - 10, d - 10), plateMat);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = Y_PLATE;
  top.add(plate);

  // ---- the photos: plain data, loaded for the page that is showing (and the next)
  const photos: ZonePhoto[] = zone?.photos ?? [];
  const count = photos.length;
  const images = new ImageCache(PAGE_SLOTS * 2 + 2);

  // ---- layout on the plate: the two landscape strips on the left (back and front), the portrait strip at the right end.
  // One film scale for all of it, picked so the biggest fits.
  const plateW = w - 10;
  const plateD = d - 10;
  const EDGE = 4;
  const GAP_X = 5;
  const GAP_Z = 4;
  const s = Math.min(
    (plateW - EDGE * 2 - GAP_X) / (STRIP_LEN + STRIP_WID),
    (plateD - EDGE * 2 - GAP_Z) / (2 * STRIP_WID),
    (plateD - EDGE * 2) / STRIP_LEN
  );
  const totalW = (STRIP_LEN + STRIP_WID) * s + GAP_X;
  const x0 = -totalW / 2;
  const rowX = x0 + (STRIP_LEN * s) / 2;
  const colX = x0 + STRIP_LEN * s + GAP_X + (STRIP_WID * s) / 2;
  const rowZ = [-(STRIP_WID * s + GAP_Z) / 2, (STRIP_WID * s + GAP_Z) / 2];

  const mkCanvas = (cw: number, ch: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(cw));
    c.height = Math.max(2, Math.round(ch));
    return c;
  };
  /** A canvas as a texture that stays clean when it is drawn small (mipmaps) and when it is looked at slantwise. */
  const canvasTexture = (c: HTMLCanvasElement, mips: boolean) => {
    const t = new CanvasTexture(c);
    t.generateMipmaps = mips;
    t.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = mips ? 8 : 1;
    return t;
  };

  /** Where each slot's photo window is on the plate (table-local centre and size), for outlines, picking and framing. */
  const slotRect: { x: number; z: number; w: number; h: number }[] = new Array(PAGE_SLOTS);
  const cellOf: Cell[] = new Array(PAGE_SLOTS);
  // each frame's number sits in the film's band beside its window: its box in the strip's film pixels, and on the plate
  const numBox: { fx: number; fy: number; fw: number; x: number; z: number }[] = new Array(PAGE_SLOTS);

  const strips: Strip[] = [];
  const addStrip = (slots: number[], landscape: boolean, cx: number, cz: number) => {
    const sw = landscape ? STRIP_LEN : STRIP_WID;
    const sh = landscape ? STRIP_WID : STRIP_LEN;
    const cells: Cell[] = slots.map((slot, c) => {
      const along = GAP + c * (WIN_LONG + GAP);
      const cell: Cell = landscape
        ? { slot, wx: along, wy: BAND, ww: WIN_LONG, wh: WIN_SHORT }
        : { slot, wx: BAND, wy: along, ww: WIN_SHORT, wh: WIN_LONG };
      cellOf[slot] = cell;
      slotRect[slot] = {
        x: cx + (cell.wx + cell.ww / 2 - sw / 2) * s,
        z: cz + (cell.wy + cell.wh / 2 - sh / 2) * s,
        w: cell.ww * s,
        h: cell.wh * s,
      };
      // the number: along the top band at the window's left end, or in the right band at the window's top end
      const fx = landscape ? cell.wx : cell.wx + cell.ww + 10;
      const fy = landscape ? BAND - 18 - 34 : cell.wy + 2;
      const fw = landscape ? 100 : BAND - 20;
      numBox[slot] = { fx, fy, fw, x: cx + (fx + fw / 2 - sw / 2) * s, z: cz + (fy + NUM_H / 2 - sh / 2) * s };
      return cell;
    });
    const base = mkCanvas(sw * BASE_SCALE, sh * BASE_SCALE);
    const bw = mkCanvas(sw * BW_SCALE, sh * BW_SCALE);
    const haze = mkCanvas(sw * HAZE_SCALE, sh * HAZE_SCALE);
    const tex = { base: canvasTexture(base, true), bw: canvasTexture(bw, true), haze: canvasTexture(haze, false) };
    const mats = {
      bw: new MeshBasicMaterial({ color: "#8c8c8c", map: tex.bw, transparent: true, depthWrite: false }),
      base: new MeshBasicMaterial({ color: "#ffffff", map: tex.base, transparent: true, depthWrite: false }),
      haze: new MeshBasicMaterial({
        color: "#ffffff",
        map: tex.haze,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    };
    const plane = (mat: MeshBasicMaterial, y: number, order: number, grow = 1) => {
      const m = new Mesh(new PlaneGeometry(sw * s * grow, sh * s * grow), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, y, cz);
      m.renderOrder = order;
      top.add(m);
      return m;
    };
    const meshes = { bw: plane(mats.bw, Y_BW, 3), base: plane(mats.base, Y_BASE, 4), haze: plane(mats.haze, Y_HAZE, 6, 1.04) };
    meshes.bw.userData.part = "film"; // part of the table: a click on the film between photos does nothing
    meshes.base.userData.part = "film";
    meshes.haze.userData.noPick = true; // it spills past the film, and is not a thing to click
    const st: Strip = { cells, landscape, w: sw, h: sh, base, bw, haze, tex, mats, meshes };
    strips.push(st);
    paintBase(st); // the film does not change with the page
  };
  addStrip([0, 1], true, rowX, rowZ[0]);
  addStrip([2, 3], true, rowX, rowZ[1]);
  addStrip([4, 5], false, colX, 0);

  // ---- the photos themselves: one unlit plane per slot, each showing its image at the image's own resolution
  const photoPlanes: PhotoPlane[] = [];
  for (let slot = 0; slot < PAGE_SLOTS; slot++) {
    const mat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
    const m = new Mesh(new PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(slotRect[slot].x, Y_PHOTO, slotRect[slot].z);
    m.renderOrder = 5;
    m.visible = false;
    m.userData.noPick = true; // the slot's own plane is what a click lands on
    top.add(m);
    // the photo that was here before: just under this one, so a new photo fades in over it
    const ghostMat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
    const ghost = new Mesh(new PlaneGeometry(1, 1), ghostMat);
    ghost.rotation.x = -Math.PI / 2;
    ghost.position.set(slotRect[slot].x, Y_GHOST, slotRect[slot].z);
    ghost.renderOrder = 4.5;
    ghost.visible = false;
    ghost.userData.noPick = true;
    top.add(ghost);
    photoPlanes.push({ mesh: m, mat, ready: false, src: null, amt: 1, ghost, ghostMat, ghostSrc: null, ghostA: 0, ghostT: 0 });
  }
  // the frame numbers, each on a little canvas of its own
  const numberPlates: NumberPlate[] = [];
  for (let slot = 0; slot < PAGE_SLOTS; slot++) {
    const b = numBox[slot];
    const canvas = mkCanvas(b.fw * NUM_SCALE, NUM_H * NUM_SCALE);
    const tex = canvasTexture(canvas, false);
    tex.anisotropy = 4;
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const m = new Mesh(new PlaneGeometry(b.fw * s, NUM_H * s), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(b.x, Y_NUM, b.z);
    m.renderOrder = 4.2;
    m.visible = false;
    m.userData.part = "film";
    top.add(m);
    numberPlates.push({ canvas, tex, mat, mesh: m });
  }
  // textures for the images on the page (and the next): made when an image has arrived, let go of when no longer near
  const textures = new Map<string, Texture>();
  const textureFor = (src: string, im: HTMLImageElement) => {
    let t = textures.get(src);
    if (!t) {
      t = new Texture(im);
      t.generateMipmaps = true;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.anisotropy = 8;
      t.needsUpdate = true;
      textures.set(src, t);
    }
    return t;
  };

  // ---- one pickable plane per photo window; also what the view frames when zoomed into a photo there
  const slotMeshes: Mesh[] = [];
  for (let slot = 0; slot < PAGE_SLOTS; slot++) {
    const r = slotRect[slot];
    const m = new Mesh(
      new PlaneGeometry(r.w, r.h),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(r.x, Y_SLOT, r.z);
    m.renderOrder = 7;
    m.userData.part = "slot";
    m.userData.slot = slot;
    top.add(m);
    slotMeshes.push(m);
  }
  /**
   * The four world-space corners of what the view frames for photo `index`: the photo itself, and for a landscape one the
   * whole height of the film too, so the strip's edges (and the holes) are in view above and below it. Centred on the photo.
   */
  rig.photoCorners = (index) => {
    const slot = rig.layout.slotOf[index];
    const m = slotMeshes[slot];
    const cell = cellOf[slot];
    const f = fitInWindow(cell, rig.aspects[index] ?? 4 / 3);
    m.updateWorldMatrix(true, false);
    const hw = (f.w * s) / 2;
    const hh = cell.ww > cell.wh ? (cell.wh / 2 + BAND) * s : (f.h * s) / 2;
    return [
      new Vector3(-hw, -hh, 0).applyMatrix4(m.matrixWorld),
      new Vector3(hw, -hh, 0).applyMatrix4(m.matrixWorld),
      new Vector3(hw, hh, 0).applyMatrix4(m.matrixWorld),
      new Vector3(-hw, hh, 0).applyMatrix4(m.matrixWorld),
    ];
  };

  // ---- painting a page
  let shownPage = -1;
  let dirty = true; // the page needs painting (it changed, or an image on it has arrived)
  const markDirty = () => {
    dirty = true;
  };

  /** The film itself: dark base, black photo windows and the sprocket holes cut through, all continuous. Painted once. */
  function paintBase(st: Strip) {
    const ctx = st.base.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, st.base.width, st.base.height);
    ctx.setTransform(BASE_SCALE, 0, 0, BASE_SCALE, 0, 0);
    ctx.fillStyle = "#14110e";
    ctx.fillRect(0, 0, st.w, st.h);
    ctx.fillStyle = "#0b0a09";
    for (const c of st.cells) ctx.fillRect(c.wx, c.wy, c.ww, c.wh);
    // sprocket holes: the same pitch the whole length of the strip, so they run on unbroken through the gaps
    if (st.landscape) {
      for (let x = 40; x < st.w - 40; x += HOLE_PITCH) {
        ctx.clearRect(x, HOLE_INSET, HOLE_LEN, HOLE_WID);
        ctx.clearRect(x, st.h - HOLE_INSET - HOLE_WID, HOLE_LEN, HOLE_WID);
      }
    } else {
      for (let y = 40; y < st.h - 40; y += HOLE_PITCH) {
        ctx.clearRect(HOLE_INSET, y, HOLE_WID, HOLE_LEN);
        ctx.clearRect(st.w - HOLE_INSET - HOLE_WID, y, HOLE_WID, HOLE_LEN);
      }
    }
    st.tex.base.needsUpdate = true;
  }

  /** The unlit look (black and white) and the haze, drawn from the images that have arrived. */
  function paintCopies(st: Strip, page: number) {
    const bctx = st.bw.getContext("2d", { willReadFrequently: true })!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.clearRect(0, 0, st.bw.width, st.bw.height);
    bctx.drawImage(st.base, 0, 0, st.bw.width, st.bw.height); // (no numbers on it: the map's look, where they are too small to read)
    const hctx = st.haze.getContext("2d")!;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    hctx.globalCompositeOperation = "source-over";
    hctx.globalAlpha = 1;
    hctx.clearRect(0, 0, st.haze.width, st.haze.height);
    for (const pass of [0, 1]) {
      hctx.globalCompositeOperation = pass ? "lighter" : "source-over";
      hctx.globalAlpha = pass ? 0.3 : 1; // the second time over brightens it, for the glow
      for (const c of st.cells) {
        const i = rig.layout.pages[page]?.[c.slot] ?? -1;
        if (i < 0) continue;
        const im = images.get(photos[i].src, markDirty);
        if (!im || !im.naturalWidth) continue;
        const f = fitInWindow(c, photos[i].aspect);
        if (!pass) bctx.drawImage(im, f.x * BW_SCALE, f.y * BW_SCALE, f.w * BW_SCALE, f.h * BW_SCALE);
        hctx.drawImage(im, f.x * HAZE_SCALE, f.y * HAZE_SCALE, f.w * HAZE_SCALE, f.h * HAZE_SCALE);
      }
    }
    hctx.globalCompositeOperation = "source-over";
    hctx.globalAlpha = 1;
    const img = bctx.getImageData(0, 0, st.bw.width, st.bw.height);
    const px = img.data;
    for (let k = 0; k < px.length; k += 4) {
      const l = Math.min(255, (0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]) * 1.05);
      px[k] = px[k + 1] = px[k + 2] = l;
    }
    bctx.putImageData(img, 0, 0);
    st.tex.bw.needsUpdate = true;
    st.tex.haze.needsUpdate = true;
  }

  /** Lets go of the textures of photos that are neither on this page, nor the next, nor still fading out. */
  function pruneTextures(page: number) {
    const keep = new Set<string>();
    for (const p of [...(rig.layout.pages[page] ?? []), ...(rig.layout.pages[page + 1] ?? [])]) {
      if (p >= 0) keep.add(photos[p].src);
    }
    for (const pl of photoPlanes) if (pl.ghostA > 0 && pl.ghostSrc) keep.add(pl.ghostSrc);
    for (const [src, t] of textures) {
      if (!keep.has(src)) {
        t.dispose();
        textures.delete(src);
      }
    }
  }

  /**
   * Puts each photo of the page on its plane (those whose image has arrived), sized to the photo. `soft` is for a page that
   * changes while the view is looking at a photo: the photo that was in a slot is kept under the new one, which fades in over
   * it, so there is no moment with an empty table. Otherwise the swap is hidden by the page's own dip.
   */
  function placePhotos(page: number, soft: boolean) {
    for (let slot = 0; slot < PAGE_SLOTS; slot++) {
      const i = rig.layout.pages[page]?.[slot] ?? -1;
      const plane = photoPlanes[slot];
      // a photo that is not on the page has nothing to click
      slotMeshes[slot].userData.noPick = i < 0;
      const src = i < 0 ? null : photos[i].src;
      const changed = plane.src !== src;
      const wasShowing = plane.ready;
      if (!soft) plane.ghostA = 0;
      if (changed && soft && wasShowing && plane.mat.map) {
        // keep what is there now under the new photo
        plane.ghostMat.map = plane.mat.map;
        plane.ghostMat.needsUpdate = true;
        plane.ghost.scale.copy(plane.mesh.scale);
        plane.ghostSrc = plane.src;
        plane.ghostA = 1;
        plane.ghostT = 0;
      }
      plane.src = src;
      plane.ready = false;
      if (i < 0) {
        plane.mat.map = null;
        continue;
      }
      const im = images.get(src!, markDirty);
      if (!im || !im.naturalWidth) {
        plane.mat.map = null;
        continue;
      }
      const f = fitInWindow(cellOf[slot], photos[i].aspect);
      plane.mat.map = textureFor(src!, im);
      plane.mat.needsUpdate = true;
      plane.mesh.scale.set(f.w * s, f.h * s, 1);
      plane.ready = true;
      if (changed || !wasShowing) plane.amt = soft ? 0 : 1;
    }
    pruneTextures(page);
  }

  /** Prints each frame's number (only that: no title, no place) on its little canvas. */
  function paintNumbers(page: number) {
    for (let slot = 0; slot < PAGE_SLOTS; slot++) {
      const i = rig.layout.pages[page]?.[slot] ?? -1;
      const pl = numberPlates[slot];
      const ctx = pl.canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pl.canvas.width, pl.canvas.height);
      if (i >= 0) {
        ctx.setTransform(NUM_SCALE, 0, 0, NUM_SCALE, 0, 0);
        ctx.font = "600 34px system-ui, sans-serif";
        ctx.fillStyle = "#e8a33d";
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.fillText(String(i + 1), 0, 34);
      }
      pl.tex.needsUpdate = true;
    }
  }

  // The black and white copy and the haze are for the map (and the page view as the project opens), never for looking at a
  // photo, so they are not repainted while the view is on one: they are brought up to date, a strip a frame, once it is not.
  const staleCopies = new Set<Strip>();

  function paintPage(page: number, soft: boolean) {
    paintNumbers(page);
    placePhotos(page, soft);
    for (const st of strips) staleCopies.add(st);
    // the next page is the likely next thing: start its images loading
    for (const i of rig.layout.pages[page + 1] ?? []) if (i >= 0) images.get(photos[i].src);
  }

  // ---- outlines: the selected photo, and the one under the pointer
  const makeOutline = (color: string) => {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const bars = [0, 1, 2, 3].map(() => {
      const m = new Mesh(new PlaneGeometry(1, 1), mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 8;
      m.userData.noPick = true;
      top.add(m);
      return m;
    });
    /** Puts the outline round a rectangle centred at (cx, cz), `fw` x `fh`. */
    const place = (cx: number, cz: number, fw: number, fh: number) => {
      const t = 0.6;
      bars[0].scale.set(fw, t, 1);
      bars[0].position.set(cx, Y_MARK, cz - fh / 2);
      bars[1].scale.set(fw, t, 1);
      bars[1].position.set(cx, Y_MARK, cz + fh / 2);
      bars[2].scale.set(t, fh, 1);
      bars[2].position.set(cx - fw / 2, Y_MARK, cz);
      bars[3].scale.set(t, fh, 1);
      bars[3].position.set(cx + fw / 2, Y_MARK, cz);
    };
    return { mat, place };
  };
  const selected = makeOutline("#ffd27a");
  const hovered = makeOutline("#fff6dc");
  const outlineSlot = (o: ReturnType<typeof makeOutline>, slot: number) => {
    const r = slotRect[slot];
    o.place(r.x, r.z, r.w + 1.4, r.h + 1.4);
  };

  const off = new Color("#6f7176");
  const on = new Color("#e8e0c8");
  let lastT = 0;
  let fade = 0; // 0..1: the page's film, dipping out and back in when it is changed
  let selAmt = 0;
  g.userData.animate = ({ t, hover, focus }: AnimCtx) => {
    rig.step(t);
    const instant = t <= 0; // reduced motion: the scene clock is held, so ease nothing
    const dt = Math.max(0, t - lastT);
    lastT = t;
    const k = instant ? 1 : 1 - Math.exp(-dt * 10);

    // A different page. Looking at the page, the film dips out, is repainted with the new page's photos, and comes back.
    // Looking at a photo there is no dip (the view is panning to the next photo, and an empty table would flash across
    // it): the new photos take the place of the old ones, each fading in over the one it replaces.
    const looking = rig.mode === "photo";
    const wantPage = rig.page;
    if (wantPage !== shownPage) {
      if (looking && shownPage >= 0) {
        shownPage = wantPage;
        dirty = true;
      } else {
        fade += (0 - fade) * (instant ? 1 : 1 - Math.exp(-dt * 24));
        if (fade < 0.05 || shownPage < 0) {
          shownPage = wantPage;
          dirty = true;
        }
      }
    } else {
      fade += (1 - fade) * k;
      if (1 - fade < 0.003) fade = 1;
    }
    if (dirty && shownPage >= 0) {
      paintPage(shownPage, looking);
      dirty = false;
    }
    // the map's copies of the page, brought up to date a strip a frame when not looking at a photo
    if (!looking && staleCopies.size) {
      const st = staleCopies.values().next().value as Strip;
      staleCopies.delete(st);
      paintCopies(st, shownPage);
    }

    // The light. On the map the table is lit by hovering it; once the project is open it is lit, and stays on, and the
    // photos are shown plainly: the colour is the images' own, with no black and white under them, and no haze.
    const h = Math.min(1, Math.max(0, hover));
    const lit = Math.max(h, focus);
    const breath = 1 + Math.sin(t * 1.4) * 0.06 * h;
    plateMat.color.copy(off).lerp(on, h);
    const hazeClear = rig.mode === "photo" ? 0 : 1 - ease(focus);
    for (const st of strips) {
      st.mats.bw.color.setScalar(0.55 + 0.4 * h);
      st.mats.bw.opacity = (1 - lit) * fade;
      st.meshes.bw.visible = st.mats.bw.opacity > 0.004;
      st.mats.base.opacity = lit * fade;
      st.meshes.base.visible = st.mats.base.opacity > 0.004;
      // the haze is for the map: gone once the project opens, and never there while looking at one photo
      st.mats.haze.opacity = h * 0.42 * breath * hazeClear * fade;
      st.meshes.haze.visible = st.mats.haze.opacity > 0.004;
    }
    const ka = instant ? 1 : 1 - Math.exp(-dt * 11);
    for (const p of photoPlanes) {
      p.amt += (1 - p.amt) * ka;
      if (1 - p.amt < 0.01) p.amt = 1;
      p.mat.opacity = lit * fade * p.amt;
      p.mesh.visible = p.ready && p.mat.opacity > 0.004;
      // the photo that was here is held opaque under the new one until it is in, then goes (a photo whose image has not
      // arrived yet is not waited for: the old one fades out)
      if (p.ghostA > 0) {
        p.ghostT += dt;
        if (p.ready) {
          if (p.amt >= 1) p.ghostA = 0;
        } else {
          p.ghostA = Math.max(0, p.ghostA - (instant ? 1 : dt * 3));
        }
        if (p.ghostT > 1.5) p.ghostA = 0;
        if (p.ghostA <= 0.004) {
          p.ghostA = 0;
          p.ghostSrc = null;
          p.ghostMat.map = null;
          p.ghostMat.needsUpdate = true;
          pruneTextures(shownPage);
        }
      }
      p.ghostMat.opacity = lit * fade * p.ghostA;
      p.ghost.visible = p.ghostA > 0 && p.ghostMat.opacity > 0.004;
    }
    for (const n of numberPlates) {
      n.mat.opacity = lit * fade;
      n.mesh.visible = n.mat.opacity > 0.004;
    }

    // outlines: the selected photo (while looking at the page), and the one under the pointer when the project is open
    const cur = rig.index;
    const onPage = count > 0 && rig.layout.pageOf[cur] === shownPage;
    selAmt += ((rig.mode === "page" ? 1 : 0) - selAmt) * k;
    selected.mat.opacity = onPage ? (0.3 + 0.65 * lit) * selAmt * fade : 0;
    if (onPage) outlineSlot(selected, rig.layout.slotOf[cur]);
    const over = rig.hoverIndex;
    const overOn = over !== null && rig.layout.pageOf[over] === shownPage;
    hovered.mat.opacity = overOn && rig.mode === "page" ? 0.95 * focus * fade : 0;
    if (overOn) outlineSlot(hovered, rig.layout.slotOf[over!]);
  };
  return g;
}

// ---------------------------------------------------------------- the desk mat

/**
 * The dark mat everything stands on, as a flat sheet just above the ground so it can be stretched over the grown
 * table when the project is open (a decal baked into the ground could not). It sits below the shadow catcher and the
 * leaf shade, so shadows and dapple still fall over it, and it does not rise with the other props on hover.
 */
function deskMatModel(w: number, d: number): Group {
  const g = new Group();
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(d));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#2f2d2c";
  ctx.fillRect(0, 0, c.width, c.height);
  // a little speckle, the same few colours as before
  const speckle = ["#3a3735", "#262423"];
  for (let i = 0; i < c.width * c.height * 0.05; i++) {
    const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    const h2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
    ctx.fillStyle = speckle[i % speckle.length];
    ctx.fillRect(Math.floor((h - Math.floor(h)) * c.width), Math.floor((h2 - Math.floor(h2)) * c.height), 1, 1);
  }
  ctx.strokeStyle = "#16161d";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  const sheet = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ map: tex }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0.03;
  g.add(sheet);
  g.userData.flat = true;
  return g;
}

// ---------------------------------------------------------------- dispatch

/** Builds a model for a photography-area prop id, or null when the id is not one of ours. */
export function sceneryModel(id: string, footprint: Footprint | undefined, _prop: Prop, zones: Zone[]): Group | null {
  const w = footprint?.kind === "rect" ? footprint.w : 0;
  const d = footprint?.kind === "rect" ? footprint.h : 0;
  const zone = zones.find((z) => z.kind === "gallery");
  const rig = zone ? filmRig(zone) : new FilmRig();
  switch (id) {
    case "omcamera":
      return omCameraModel(rig);
    case "lighttable":
      return lightTableModel(w, d, zone, rig);
    case "deskmat":
      return deskMatModel(w, d);
  }
  return null;
}
