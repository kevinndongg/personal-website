import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  RingGeometry,
  Texture,
  Vector3,
} from "three";
import type { Footprint, Prop } from "./scenes";
import type { Zone, ZonePhoto } from "./world";
import { box, cyl, mesh, toon } from "./models";
import type { AnimCtx } from "./models";
import { ImageCache } from "./photocache";
import { plaquesModel } from "./contactmodels";
import { constructionModel } from "./constructionmodels";

// Models for the photography area: an Olympus OM-1 and a light table. The table shows the photos a page at a time: six
// frames of film laid out on it (two strips of two landscape photos, and one strip of two portrait ones). The camera is
// the remote control: the advance lever and the rewind knob flip to the next or previous page (or, zoomed in, photo), and
// the shutter button zooms the view into the photo last looked at (the first of the page, after a flip) or back out.
// Same conventions as models.ts: 1 unit = 1 world px, origin at the footprint centre on the ground, +x = forward.

const SILVER = "#c3c7cf";
const SILVER_DARK = "#9ea3ad";
const BLACK = "#1b1c20";
// The rewind knob, the advance lever and the shutter button are silver (red) like the rest, but each has a colour of its
// own (a shade off): the materials are shared by colour, and these are tinted when the pointer is over them.
const LEATHER = "#6b4425";
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
 * So every page is a run of the gallery in order. The last page is the one the gallery runs out on, so it would be left with
 * empty slots: it takes the nearest earlier photos of the kinds it lacks instead (they are on the page before as well), so
 * it ends on the last photo and is full. (It stays short only if the whole gallery has too few photos of a kind.) A photo
 * on two pages belongs to the first for `pageOf` and `slotOf`. Works for any number of photos.
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

  // the last page: fill what it lacks with the latest earlier photos of that kind, and lay it out in gallery order again
  const lastPage = pages.length - 1;
  if (lastPage >= 0 && pages[lastPage].includes(-1)) {
    const own = pages[lastPage].filter((i) => i >= 0);
    let needLandscape = LANDSCAPE_SLOTS - own.filter((i) => aspects[i] >= 1).length;
    let needPortrait = PORTRAIT_SLOTS - own.filter((i) => aspects[i] < 1).length;
    for (let j = Math.min(...own) - 1; j >= 0 && (needLandscape > 0 || needPortrait > 0); j--) {
      if (aspects[j] < 1 ? needPortrait > 0 : needLandscape > 0) {
        own.push(j);
        if (aspects[j] < 1) needPortrait--;
        else needLandscape--;
      }
    }
    own.sort((a, b) => a - b);
    const filled: number[] = new Array(PAGE_SLOTS).fill(-1);
    let l = 0;
    let p = 0;
    for (const i of own) {
      const slot = aspects[i] < 1 ? LANDSCAPE_SLOTS + p++ : l++;
      filled[slot] = i;
      if (pageOf[i] === lastPage) slotOf[i] = slot; // (the earlier ones keep the place they have on their own page)
    }
    pages[lastPage] = filled;
  }
  return { pages, pageOf, slotOf };
}

// ---------------------------------------------------------------- the film winder

// A stroke is the time before the next one can start (clicks wait in a short queue), so these are kept short.
const STROKE_OUT = 0.2; // the lever sweeps out to its advanced place; the page (or photo) changes meanwhile
const STROKE_HOLD = 0.27; // ...holds there a moment...
const STROKE_END = 0.5; // ...and eases back to rest
const KNOB_TURN = 0.45; // the rewind knob makes one full turn in this long when the film goes back
// The idle pass: when nobody has touched it the lever (or the knob) turns the page by itself, back and forth along the
// roll, for life.
const AUTO_EVERY = 7; // seconds between its strokes on the map...
const TEASE_EVERY = 4; // ...and with the gallery open
const TEASE_FIRST = 1.2; // seconds after the gallery opens (before anything has been used) to its first stroke
const USER_PAUSE = 8; // seconds it leaves the page alone after the viewer's last move
// The lever and the knob breathe (glow up from plain silver and back, in turn) while the gallery is open: how far, at the
// peak of a breath (0 none .. 1 full amber). Strong until the viewer has used anything, and small after.
const BREATH_FIRST = 0.85;
const BREATH_USED = 0.2;
// At the end of the roll the lever is tried and sticks: it gets this far (of its whole sweep) before it hits the stop, and
// rattles there a moment, then is let go. The rewind knob does the same, this far round (of a whole turn), at the start.
const STUCK_LEVER = 0.16;
const STUCK_KNOB = 0.07;
const STUCK_HIT = 0.07; // seconds to reach the stop
const STUCK_LET_GO = 0.3; // seconds into the stroke when it is let go

/** How far a control gets in a stroke that hits the end of the roll: `amount` at the stop, a short rattle, then back. */
function stuck(k: number, amount: number) {
  if (k < STUCK_HIT) return amount * ease(k / STUCK_HIT);
  const r = k - STUCK_HIT;
  const rattle = Math.exp(-r * 22) * Math.sin(r * 70) * 0.18;
  const back = ease((k - STUCK_LET_GO) / (STROKE_END - STUCK_LET_GO));
  return Math.max(0, amount * (1 + rattle) * (1 - back));
}

/** How the table's page is changing: the fade (map), a crossfade (zoomed in on a photo), or a slide (page view, open). */
type PageChange = "dip" | "cross" | "slide";

/** An arrow key, zoomed in: which way to go on the table. */
export type MoveKey = "up" | "down" | "left" | "right";

// Slots: 0 and 1 are the top row, 2 and 3 the bottom row, 4 above 5 is the portrait strip to their right. For each key
// and slot, the slots next to it in that direction (the first one with a photo is where it goes), and, when there is
// none, where it lands on the page it turns to: the same row or column of the next (down, right) or previous (up, left).
const NEIGHBOURS: Record<MoveKey, number[][]> = {
  right: [[1, 4], [4], [3, 5], [5], [], []],
  left: [[], [0], [], [2], [1, 0], [3, 2]],
  down: [[2], [3], [], [], [5], []],
  up: [[], [], [0], [1], [], [4]],
};
const LANDING: Record<MoveKey, number[]> = {
  right: [0, 0, 2, 2, 0, 2],
  left: [4, 4, 5, 5, 4, 5],
  down: [0, 1, 0, 1, 4, 4],
  up: [2, 3, 2, 3, 5, 5],
};

/** Which control on the camera the pointer is over, so it can light up. */
export type FilmHint = "lever" | "rewind" | "shutter";

/** What the table is showing: the whole page of photos, or the view zoomed into one photo. */
export type FilmMode = "page" | "photo";

/**
 * What the camera, the light table and the page share. `frame` is the current photo: the one the view is zoomed into, and,
 * looking at the page, the one the shutter or Enter zooms into (nothing is outlined as selected). A stroke of the lever
 * or the knob moves on one page (page view) or one photo (photo view), in gallery order. It does not wrap: at the last
 * page (or photo) the lever gets stuck, and the same going back at the first. The idle pass goes back and forth along the
 * roll instead, and waits a while after any move of the viewer's. The camera reads `lever` and `knob` to place its controls; the table reads `page`,
 * `index` and `mode`. `step(t)` moves it on and is safe to call from both models every frame.
 */
export class FilmRig {
  /** The current photo, an index into the photos (use `index`, which is always in range). */
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
  /** The four world-space corners of photo `index` on the table, for the view to frame (set by the table model). */
  photoCorners?: (index: number) => Vector3[];
  /** Whether the gallery is open (set by the camera model): the idle pass is quicker then. */
  isOpen = false;
  /**
   * The project is open at the page and the viewer has not used anything yet: the idle pass starts at once (not after
   * the viewer's pause), and the knob and lever glow in turn to say they are there to be pressed. Set from outside (and
   * cleared for good by the first use).
   */
  invite = false;
  /** The viewer has used the gallery this visit (a control, a photo, a key, the wheel or a swipe). Set from outside. */
  used = false;
  private wasInvite = false;
  /** Called when the current photo changes, with its index. */
  onFrame?: (index: number) => void;
  readonly layout: PageLayout;
  private queued: { d: 1 | -1; land?: number }[] = []; // strokes asked for (a click) that have not started yet
  private landing: number | undefined; // where the stroke under way lands (see `advance`)
  private curPage = 0; // the page being shown (see `page`)
  private committed = false; // this stroke has already moved on
  private blocked = false; // this stroke is at the end of the roll: it sticks, and changes nothing
  private auto = false; // this stroke is the idle pass's own
  private autoDir: 1 | -1 = 1; // which way the idle pass is going
  private userAt = -Infinity; // scene time of the viewer's last move
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

  /** The current photo, wrapped into range (0 with no photos). */
  get index(): number {
    return this.count ? wrap(this.frame, this.count) : 0;
  }

  /**
   * The page being shown: the current photo's, and, when it is on two (the last page repeats a few from the one before
   * it), the one that was showing, so choosing a photo never moves the table to another page.
   */
  get page(): number {
    return this.count ? this.curPage : 0;
  }

  /** The slot of photo `i` on the page being shown, or -1 if it is not on it. */
  slotIn(i: number): number {
    return this.layout.pages[this.page]?.indexOf(i) ?? -1;
  }

  private select(i: number) {
    this.frame = i;
    if (!this.layout.pages[this.curPage]?.includes(i)) this.curPage = this.layout.pageOf[i] ?? 0;
  }

  get pageCount(): number {
    return this.layout.pages.length;
  }

  /** The photo in a slot of the page being shown, or -1. */
  photoAt(slot: number): number {
    return this.layout.pages[this.page]?.[slot] ?? -1;
  }

  /** Back to the start of the roll, looking at the page (the gallery is opened afresh). */
  reset() {
    this.frame = 0;
    this.curPage = 0;
    this.mode = "page";
    this.queued.length = 0;
    this.hoverIndex = null;
    this.autoDir = 1;
    this.userAt = this.lastT;
  }

  /** The viewer did something: the idle pass's timer starts again, and it goes on the way they went (if they went). */
  private touch(direction?: 1 | -1) {
    this.userAt = this.lastT;
    if (direction) this.autoDir = direction;
  }

  /** Whether the roll goes on a page (or photo, zoomed in and not turning the page by `land`) in `direction`. */
  private canMove(direction: 1 | -1, land: number | undefined): boolean {
    if (!this.count) return false;
    if (this.mode === "photo" && land === undefined) {
      return direction > 0 ? this.index < this.count - 1 : this.index > 0;
    }
    return direction > 0 ? this.page < this.pageCount - 1 : this.page > 0;
  }

  /** Zooms the view into photo `i`. */
  zoomIn(i: number) {
    if (!this.count) return;
    this.select(wrap(i, this.count));
    this.mode = "photo";
    this.touch();
    this.onFrame?.(this.index);
  }

  zoomOut() {
    this.mode = "page";
    this.touch();
  }

  /** The shutter: zoom into the current photo, or back out to the page. */
  toggleZoom() {
    if (!this.count) return;
    this.mode = this.mode === "photo" ? "page" : "photo";
    this.touch();
  }

  /**
   * Ask for a stroke: 1 (the default) goes to the next page (or photo, zoomed in), -1 to the previous one. A click in
   * the middle of one waits for it to finish, then strokes. Asking for more than two at once drops the rest. `land` (for a
   * stroke that turns the page while zoomed in) is the slot to land on in the new page, or the nearest filled one.
   */
  queue(direction: 1 | -1 = 1, land?: number) {
    this.touch(direction);
    if (this.queued.length < 2) this.queued.push({ d: direction, land });
  }

  /**
   * Zoomed in: moves to the photo next to this one in a direction on the table (up, down, left, right), and at the edge
   * of the page turns the page, landing in the matching place on the next. Does nothing looking at the page.
   */
  move(direction: MoveKey) {
    if (!this.count || this.mode !== "photo") return;
    const slot = this.slotIn(this.index);
    if (slot < 0) return;
    for (const s of NEIGHBOURS[direction][slot]) {
      const i = this.photoAt(s);
      if (i >= 0) {
        this.select(i);
        this.touch(direction === "down" || direction === "right" ? 1 : -1);
        this.onFrame?.(this.index);
        return;
      }
    }
    const forward = direction === "down" || direction === "right";
    this.queue(forward ? 1 : -1, LANDING[direction][slot]);
  }

  /** How far the advance lever is toward its advanced place: 0 parked .. 1 out to the side of the body. */
  get lever(): number {
    const k = this.phase;
    if (k === null || this.dir < 0) return 0;
    if (this.blocked) return stuck(k, STUCK_LEVER);
    if (k < STROKE_OUT) return ease(k / STROKE_OUT);
    if (k < STROKE_HOLD) return 1;
    if (k < STROKE_END) return 1 - ease((k - STROKE_HOLD) / (STROKE_END - STROKE_HOLD));
    return 0;
  }

  /** How far round the rewind knob has turned in a backward stroke: 0 at rest .. 1 a whole turn (the same look as 0). */
  get knob(): number {
    const k = this.phase;
    if (k === null || this.dir > 0) return 0;
    if (this.blocked) return stuck(k, STUCK_KNOB);
    return ease(k / KNOB_TURN);
  }

  step(t: number) {
    if (t <= 0) {
      // reduced motion: the scene clock is held at 0, so nothing moves; a click just changes the page (this branch is
      // idempotent on its own, since each call drains the queue)
      for (let q = this.queued.shift(); q !== undefined; q = this.queued.shift()) {
        this.dir = q.d;
        if (this.canMove(q.d, q.land)) this.advance(q.land);
      }
      return;
    }
    if (t === this.steppedAt) return;
    this.steppedAt = t;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    // an invitation just began: the first tease comes a moment later, not at once
    if (this.invite !== this.wasInvite) {
      this.wasInvite = this.invite;
      if (this.invite) this.idleSince = Math.max(this.idleSince, t - (TEASE_EVERY - TEASE_FIRST));
    }

    if (this.phase === null) {
      // a stroke asked for (a click), or else the idle pass's
      const asked = this.queued.shift();
      let dir: 1 | -1;
      if (asked) {
        dir = asked.d;
      } else {
        // The pass: only looking at the page, at its pace, and (once the viewer has used anything) not until they have
        // left it alone for a while. It goes on the way it was going, and turns round at the end of the roll.
        if (this.mode !== "page") return;
        if (t - this.idleSince < (this.isOpen ? TEASE_EVERY : AUTO_EVERY)) return;
        if (!this.invite && t - this.userAt < USER_PAUSE) return;
        dir = this.canMove(this.autoDir, undefined) ? this.autoDir : this.autoDir === 1 ? -1 : 1;
        if (!this.canMove(dir, undefined)) return; // (one page: nothing to pass)
        this.autoDir = dir;
      }
      this.auto = asked === undefined;
      this.dir = dir;
      this.landing = asked?.land;
      this.blocked = asked !== undefined && !this.canMove(dir, asked.land);
      this.phase = 0;
    } else {
      this.phase += dt;
    }

    if (!this.committed && this.phase >= STROKE_OUT) {
      this.committed = true;
      // (a pass stroke the viewer has zoomed into a photo during is dropped: it must not step a photo)
      if (!this.blocked && (!this.auto || this.mode === "page")) this.advance(this.landing);
    }
    if (this.phase >= STROKE_END) {
      this.phase = null;
      this.committed = false;
      this.blocked = false;
      this.auto = false;
      this.idleSince = t;
    }
  }

  /**
   * One page on (or back) in page view, one photo in photo view; the first photo of the page it lands on becomes current. A
   * stroke that carries a `land` slot (an arrow key at the edge of the page, zoomed in) turns the page instead and goes to
   * that slot's photo on it, or the nearest one.
   */
  private advance(land?: number) {
    if (!this.count) return;
    // one on in `dir`; the roll has ends, and this stops at them
    const go = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
    if (this.mode === "photo" && land === undefined) {
      this.select(go(this.frame + this.dir, this.count));
    } else {
      const p = go(this.page + this.dir, this.pageCount);
      this.curPage = p; // (set first: the page's first photo can also be on the page before)
      const slots = this.layout.pages[p];
      let pick = Math.min(...slots.filter((i) => i >= 0));
      if (this.mode === "photo" && land !== undefined) {
        search: for (let d = 0; d < PAGE_SLOTS; d++) {
          for (const s of [land - d, land + d]) {
            if (slots[s] !== undefined && slots[s] >= 0) {
              pick = slots[s];
              break search;
            }
          }
        }
      }
      this.select(pick);
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

  // The leather strap: it hangs from each lug down the side of the body to the desk, and goes round in a loose loop behind
  // the camera, a flat band lying on the mat (a polyline of short boxes) with a small buckle on the way.
  const loop: [number, number][] = [
    [-6, -24],
    [-12, -27],
    [-22, -27],
    [-31, -21],
    [-37, -12],
    [-40, -3],
  ];
  const strapLine: [number, number][] = [...loop, ...[...loop].reverse().map(([x, z]): [number, number] => [x, -z])];
  for (const side of [-1, 1]) g.add(box(3, 19.6, 0.7, LEATHER, bx, 0.4, side * 23.1));
  for (let i = 0; i < strapLine.length - 1; i++) {
    const [x0, z0] = strapLine[i];
    const [x1, z1] = strapLine[i + 1];
    const seg = box(Math.hypot(x1 - x0, z1 - z0) + 0.8, 0.6, 3, LEATHER, (x0 + x1) / 2, 0.1, (z0 + z1) / 2);
    seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    g.add(seg);
  }
  g.add(box(3.4, 0.9, 4.4, SILVER, -22, 0.55, -27)); // buckle

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
  // the shutter button zooms the view into the current photo, or back out to the page; it sits a little forward (toward
  // the lens) of the advance lever's pivot, so the two are apart on screen
  const shutter = new Group();
  shutter.position.set(bx + 3, 24.8, 11);
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
  // An invisible, wider box round the lever to press (it is small, and nothing else on the camera is the lever: the body
  // is not a button). It is centred on the arm and turns with it. Narrow enough, and set back from the pivot, that it
  // stays clear of the shutter button's own pad.
  const leverPad = new Mesh(
    new BoxGeometry(5.5, 4, 15),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  leverPad.position.set(0, 0, 7);
  lever.add(leverPad);
  g.add(lever);

  // The controls light up amber when the pointer is over them. Their colours are their own, so tinting them does not
  // touch the other silver parts. The knob and
  // the lever also breathe in turn while the gallery is open (`phase` is where each is in that round, as a fraction of
  // it), strongly at first and gently once the viewer has used anything, dropping to plain silver between breaths; the
  // shutter button does neither: a photo can be clicked as well.
  // a warm honey amber, muted to sit with the cream and brown of the page rather than a bright signal yellow
  const AMBER = new Color("#d99a45");
  const tint = [
    { mat: toon(KNOB_COLOR), base: new Color(KNOB_COLOR), glow: 0, hint: "rewind" as const, phase: 0.5, shine: true },
    { mat: toon(LEVER_ARM), base: new Color(LEVER_ARM), glow: 0, hint: "lever" as const, phase: 0, shine: true },
    { mat: toon(LEVER_TIP), base: new Color(LEVER_TIP), glow: 0, hint: "lever" as const, phase: 0, shine: true },
    { mat: toon(SHUTTER_COLOR), base: new Color(SHUTTER_COLOR), glow: 0, hint: "shutter" as const, phase: null, shine: false },
  ];
  /** How lit a control is by the offer at time `t`: a soft swell in its turn, steady when the clock is held. */
  const swell = (t: number, phase: number) =>
    t <= 0 ? 0.45 : Math.pow(0.5 + 0.5 * Math.sin(t * 2.3 - phase * Math.PI * 2), 2);
  let breath = 0; // how far a breath goes (see BREATH_FIRST / BREATH_USED), eased as it changes
  let lastT = 0;
  g.userData.animate = ({ t, hover, focus }: AnimCtx) => {
    // the idle pass is quicker with the gallery open
    rig.isOpen = focus >= 0.5;
    // Going to the next page (clicked): from its parked place in the middle the lever sweeps away from the lens, out to
    // the side of the body (the advanced place), holds a moment, then eases back to where it started. Going back, the
    // lever stays put and the rewind knob makes a full turn instead.
    rig.step(t);
    lever.rotation.y = -2.1 * (1 - rig.lever);
    knob.rotation.y = -Math.PI * 2 * rig.knob;
    const elapsed = Math.max(0, t - lastT);
    const k = 1 - Math.exp(-elapsed * 14);
    lastT = t;
    // the size of the breath: none on the map, strong until something has been used, then small (over about half a second)
    const peak = (rig.used ? BREATH_USED : BREATH_FIRST) * ease(focus);
    breath = t <= 0 ? peak : breath + (peak - breath) * (1 - Math.exp(-elapsed * 5));
    for (const c of tint) {
      c.glow += ((rig.hint === c.hint ? 1 : 0) - c.glow) * k;
      const offered = c.phase === null ? 0 : breath * swell(t, c.phase);
      const lit = Math.max(c.glow, offered);
      c.mat.color.copy(c.base).lerp(AMBER, lit);
      // the knob itself shines (it gives off light, not just a different colour)
      if (c.shine) c.mat.emissive.copy(AMBER).multiplyScalar(lit * 0.3);
    }
    // a soft sweep of light across the glass when the box is hovered
    (glint.material as MeshBasicMaterial).opacity = hover * (0.4 + 0.3 * Math.sin(t * 1.7));
    glint.position.z = -1.5 + Math.sin(t * 1.1) * 2.5;
  };
  return g;
}

// ---------------------------------------------------------------- the still life beside the camera

// The camera's spares, at its own scale (its lens barrel is about 18 across; a 135 mm telephoto, a filter and a film
// canister are these sizes next to an OM-1). Nothing here is a control: each group is tagged as part of the table.

/**
 * A telephoto lens standing on its rear mount, front glass up: barrel, focus ring, silver band, and a hood made of a ring
 * of panels so the glass shows inside it. Origin at the middle of its base, on the desk.
 */
function telephotoModel(): Group {
  const g = new Group();
  g.add(cyl(8.4, 8.4, 2, SILVER, 0, 0, 0, 28)); // rear mount
  g.add(cyl(9, 9, 20, BLACK, 0, 2, 0, 28)); // barrel
  g.add(cyl(9.6, 9.6, 6, "#26272c", 0, 8, 0, 28)); // focus ring
  g.add(cyl(9.7, 9.7, 0.8, SILVER_DARK, 0, 14.6, 0, 28));
  g.add(cyl(9.3, 9.3, 1, SILVER, 0, 22, 0, 28)); // front rim
  g.add(cyl(7.6, 7.6, 0.4, "#1d3550", 0, 23, 0, 24)); // front glass
  const panels = 12;
  for (let i = 0; i < panels; i++) {
    const a = (i / panels) * Math.PI * 2;
    const panel = box(5.4, 5.6, 0.8, "#1d1e22", Math.cos(a) * 9.9, 23, Math.sin(a) * 9.9);
    panel.rotation.y = -a + Math.PI / 2;
    g.add(panel);
  }
  g.userData.part = "film";
  return g;
}

/**
 * A canister of film, standing (black body, yellow label, silver cap), with its tab: the leader drawn out of the side and
 * curling toward the viewer. Origin at the middle of the canister's base, on the desk.
 */
function filmCanisterModel(): Group {
  const g = new Group();
  const cx = 0;
  g.add(cyl(4, 4, 15, "#2b2d33", cx, 0, 0, 20));
  g.add(cyl(4.12, 4.12, 7, "#e8a317", cx, 4, 0, 20));
  g.add(cyl(3.2, 3.2, 2.2, SILVER, cx, 15, 0, 20));
  // The film tab: the leader, drawn out of the canister's side and curling toward the viewer, a band as wide as 35 mm film
  // is next to the canister, with a sprocket hole every so often down both edges.
  const R = 5; // radius of the curl
  const SWEEP = (100 * Math.PI) / 180;
  const SEGS = 7;
  for (let i = 0; i < SEGS; i++) {
    const a0 = (i / SEGS) * SWEEP;
    const a1 = ((i + 1) / SEGS) * SWEEP;
    const p0: [number, number] = [cx + 4 + R * Math.sin(a0), R * (1 - Math.cos(a0))];
    const p1: [number, number] = [cx + 4 + R * Math.sin(a1), R * (1 - Math.cos(a1))];
    const mx = (p0[0] + p1[0]) / 2;
    const mz = (p0[1] + p1[1]) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const rot = -Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const band = box(len + 0.25, 10.5, 0.35, "#8a5a2e", mx, 3, mz);
    band.rotation.y = rot;
    g.add(band);
    for (const hy of [3.9, 12.1]) {
      const hole = box(0.9, 0.9, 0.55, "#17110c", mx, hy - 0.45, mz);
      hole.rotation.y = rot;
      g.add(hole);
    }
  }
  g.userData.part = "film"; // part of the table: nothing here is a control
  return g;
}

/**
 * Two clear filters: one lying flat on the desk and the other leaning on it, its far edge on the desk and its near edge
 * resting on the first one's rim (so it is tilted down by the thickness of a filter over its width, and they overlap by only
 * a little). A silver ring each (a flat top, a dark knurled edge) with a pane of clear glass in the middle, which shows the
 * desk through it. Origin at the middle of the pair, on the desk.
 */
function filterStackModel(): Group {
  const g = new Group();
  const R = 7; // outer radius
  const T = 2.4; // thickness
  const glass = new MeshBasicMaterial({ color: "#d7e8f0", transparent: true, opacity: 0.22, depthWrite: false });
  /** One filter, centred on its own origin: its top face at +T/2, its bottom at -T/2. */
  const filter = () => {
    const f = new Group();
    const top = mesh(new RingGeometry(5.7, R, 32), toon(SILVER_DARK), 0, T / 2, 0);
    top.rotation.x = -Math.PI / 2;
    f.add(top);
    f.add(mesh(new CylinderGeometry(R + 0.1, R + 0.1, T, 32, 1, true), toon("#26272c"), 0, 0, 0)); // the edge
    f.add(mesh(new CylinderGeometry(5.7, 5.7, 0.3, 28), glass, 0, 0, 0)); // the glass
    return f;
  };
  // The first lies flat, on the left. The second's near edge comes down on its rim, so the two overlap only a little.
  const flat = filter();
  flat.position.set(-6.4, T / 2, 0);
  g.add(flat);
  // The second leans: tilted so its far (right) edge is on the desk and its near edge on the first one's top.
  const tilt = Math.asin(T / (2 * R));
  const lean = filter();
  lean.rotation.z = -tilt;
  lean.position.set(6.4, R * Math.sin(tilt) + (T / 2) * Math.cos(tilt), 0);
  g.add(lean);
  g.userData.part = "film";
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
// The film's own canvas (holes) is painted once, and is seen at its edges when a landscape photo is framed, so it is
// sharp; the frame numbers are separate little canvases, so a page change repaints almost nothing. The photos go on as
// textures: a small one (SMALL_W wide) for the map and as a page arrives, and one at the image's own resolution once the
// table is hovered or opened, brought in a plane per frame so no frame has six uploads to do.
const BASE_SCALE = 0.8;
const HAZE_SCALE = 1 / 8;
const SMALL_W = 384;
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
  cx: number; // where it is on the plate (table-local x), at rest
  w: number; // film px
  h: number;
  base: HTMLCanvasElement; // the film itself: the base, the windows and the holes (cut through), painted once
  haze: HTMLCanvasElement; // a small, blurry copy of the photos for the glow
  tex: { base: CanvasTexture; haze: CanvasTexture };
  mats: { base: MeshBasicMaterial; haze: MeshBasicMaterial };
  meshes: { base: Mesh; haze: Mesh };
  baseOut: Mesh; // a second copy of the film, for the page that is sliding out (it shares the base's texture)
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
 * the plate is dull and the photos are dim and black and white (the same layers, made grey as they are drawn); hovering
 * switches the light on, the photos turn to colour and glow through the film with a haze. Opened, that light is off the photos for good: they are shown as they were shot, with no
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

  // While the page slides the film runs past the edges of the plate: it is cut off there. Two planes (the plate's left and
  // right edges, facing in), in world space, rebuilt every frame from the table top's transform.
  const clipL = new Plane();
  const clipR = new Plane();
  const clip = [clipL, clipR];
  // The map's black and white is made as the film is drawn, not baked: one pair of values, shared by every film material
  // (`gray` 1 = black and white .. 0 = colour, `dim` = brightness), set each frame from how lit the table is. So the live
  // layers are what the map shows too, and the page slides there exactly as it does open.
  const film = { gray: { value: 1 }, dim: { value: 0.55 } };
  const grey = (m: MeshBasicMaterial) => {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGray = film.gray;
      shader.uniforms.uDim = film.dim;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float uGray;\nuniform float uDim;\nvoid main() {")
        .replace(
          "#include <opaque_fragment>",
          "float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) * 1.05;\n" +
            "outgoingLight = mix(outgoingLight, vec3(lum), uGray) * uDim;\n" +
            "#include <opaque_fragment>"
        );
    };
    m.customProgramCacheKey = () => "film-grey";
    return m;
  };
  const SLIDE_TIME = 0.55; // seconds for the film to slide a page
  const SLIDE_DIST = (plateW + totalW) / 2 + 2; // far enough that the film starts and ends clear of the plate

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
    const haze = mkCanvas(sw * HAZE_SCALE, sh * HAZE_SCALE);
    const tex = { base: canvasTexture(base, true), haze: canvasTexture(haze, false) };
    const mats = {
      base: grey(
        new MeshBasicMaterial({
          color: "#ffffff",
          map: tex.base,
          transparent: true,
          depthWrite: false,
          clippingPlanes: clip,
        })
      ),
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
    const meshes = { base: plane(mats.base, Y_BASE, 4), haze: plane(mats.haze, Y_HAZE, 6, 1.04) };
    meshes.base.userData.part = "film"; // part of the table: a click on the film between photos does nothing
    meshes.haze.userData.noPick = true; // it spills past the film, and is not a thing to click
    const baseOut = plane(mats.base, Y_BASE, 4);
    baseOut.visible = false;
    baseOut.userData.noPick = true;
    const st: Strip = { cells, landscape, cx, w: sw, h: sh, base, haze, tex, mats, meshes, baseOut };
    strips.push(st);
    paintBase(st); // the film does not change with the page
  };
  addStrip([0, 1], true, rowX, rowZ[0]);
  addStrip([2, 3], true, rowX, rowZ[1]);
  addStrip([4, 5], false, colX, 0);

  // ---- the photos themselves: one unlit plane per slot, each showing its image at the image's own resolution
  const photoPlanes: PhotoPlane[] = [];
  for (let slot = 0; slot < PAGE_SLOTS; slot++) {
    const mat = grey(
      new MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        clippingPlanes: clip,
      })
    );
    const m = new Mesh(new PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(slotRect[slot].x, Y_PHOTO, slotRect[slot].z);
    m.renderOrder = 5;
    m.visible = false;
    m.userData.noPick = true; // the slot's own plane is what a click lands on
    top.add(m);
    // the photo that was here before: just under this one, so a new photo fades in over it
    const ghostMat = grey(
      new MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        clippingPlanes: clip,
      })
    );
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
  const numberGhosts: NumberPlate[] = [];
  for (let slot = 0; slot < PAGE_SLOTS; slot++) {
    const b = numBox[slot];
    const canvas = mkCanvas(b.fw * NUM_SCALE, NUM_H * NUM_SCALE);
    const tex = canvasTexture(canvas, false);
    tex.anisotropy = 4;
    const mat = grey(
      new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, clippingPlanes: clip })
    );
    const m = new Mesh(new PlaneGeometry(b.fw * s, NUM_H * s), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(b.x, Y_NUM, b.z);
    m.renderOrder = 4.2;
    m.visible = false;
    m.userData.part = "film";
    top.add(m);
    numberPlates.push({ canvas, tex, mat, mesh: m });
    // the number that was there, for the page sliding out (a copy of the canvas, taken as the slide starts)
    const gCanvas = mkCanvas(b.fw * NUM_SCALE, NUM_H * NUM_SCALE);
    const gTex = canvasTexture(gCanvas, false);
    gTex.anisotropy = 4;
    const gMat = grey(
      new MeshBasicMaterial({ map: gTex, transparent: true, opacity: 0, depthWrite: false, clippingPlanes: clip })
    );
    const gm = new Mesh(new PlaneGeometry(b.fw * s, NUM_H * s), gMat);
    gm.rotation.x = -Math.PI / 2;
    gm.position.set(b.x, Y_NUM, b.z);
    gm.renderOrder = 4.2;
    gm.visible = false;
    gm.userData.noPick = true;
    top.add(gm);
    numberGhosts.push({ canvas: gCanvas, tex: gTex, mat: gMat, mesh: gm });
  }
  // Textures for the images on the page (and the next), made when an image has arrived and let go of when no longer near.
  // Each photo has a small one (a canvas SMALL_W wide: also what the haze is drawn from) at once, and a full one (the
  // image itself, mipmapped) when the table is hovered or opened.
  interface PhotoTex {
    canvas: HTMLCanvasElement;
    small: Texture;
    full?: Texture;
  }
  const textures = new Map<string, PhotoTex>();
  /** The photo's textures, the small one made if it is not there yet (one `drawImage`, about a millisecond). */
  const photoTex = (src: string, im: HTMLImageElement): PhotoTex => {
    let e = textures.get(src);
    if (!e) {
      const w = Math.min(SMALL_W, im.naturalWidth);
      const canvas = mkCanvas(w, (w * im.naturalHeight) / im.naturalWidth);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
      const small = canvasTexture(canvas, true);
      small.anisotropy = 4;
      e = { canvas, small };
      textures.set(src, e);
    }
    return e;
  };
  /** The full-size texture for a photo (made on first ask). */
  const fullTex = (src: string, im: HTMLImageElement): Texture => {
    const e = photoTex(src, im);
    if (!e.full) {
      const t = new Texture(im);
      t.generateMipmaps = true;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.anisotropy = 8;
      t.needsUpdate = true;
      e.full = t;
    }
    return e.full;
  };
  /** Makes the small texture for an image that is on its way (the next page's), once it has arrived. */
  const warm = (src: string) => {
    const im = images.get(src, () => {
      const loaded = images.get(src);
      if (loaded?.naturalWidth) photoTex(src, loaded);
    });
    if (im?.naturalWidth) photoTex(src, im);
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
    const onPage = rig.slotIn(index);
    const slot = onPage >= 0 ? onPage : rig.layout.slotOf[index];
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

  /** The haze (a small blurry copy of the page's photos, for the glow on the map), drawn from their small textures. */
  function paintHaze(st: Strip, page: number) {
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
        const e = textures.get(photos[i].src);
        if (!e) continue;
        const f = fitInWindow(c, photos[i].aspect);
        hctx.drawImage(e.canvas, f.x * HAZE_SCALE, f.y * HAZE_SCALE, f.w * HAZE_SCALE, f.h * HAZE_SCALE);
      }
    }
    hctx.globalCompositeOperation = "source-over";
    hctx.globalAlpha = 1;
    st.tex.haze.needsUpdate = true;
  }

  /** Lets go of the textures of photos that are neither on this page, nor the next, nor still fading out. */
  function pruneTextures(page: number) {
    const keep = new Set<string>();
    for (const p of [...(rig.layout.pages[page] ?? []), ...(rig.layout.pages[page + 1] ?? [])]) {
      if (p >= 0) keep.add(photos[p].src);
    }
    for (const pl of photoPlanes) if (pl.ghostA > 0 && pl.ghostSrc) keep.add(pl.ghostSrc);
    for (const [src, e] of textures) {
      if (!keep.has(src)) {
        e.small.dispose();
        e.full?.dispose();
        textures.delete(src);
      }
    }
  }

  /**
   * Puts each photo of the page on its plane (those whose image has arrived), sized to the photo. How the page changes
   * (`how`): "dip" is for the map, where the page's own fade out and in hides the swap; "cross" is for a page that changes
   * while the view is looking at a photo, where the photo that was in a slot is kept under the new one, which fades in over
   * it; "slide" keeps the old photo in the same way, but the new one is there at once, and the old one is held (it is the
   * page sliding out beside it) until the slide has finished.
   */
  function placePhotos(page: number, how: PageChange) {
    for (let slot = 0; slot < PAGE_SLOTS; slot++) {
      const i = rig.layout.pages[page]?.[slot] ?? -1;
      const plane = photoPlanes[slot];
      // a photo that is not on the page has nothing to click
      slotMeshes[slot].userData.noPick = i < 0;
      const src = i < 0 ? null : photos[i].src;
      const changed = plane.src !== src;
      const wasShowing = plane.ready;
      if (how === "dip") plane.ghostA = 0;
      if (changed && how !== "dip" && wasShowing && plane.mat.map) {
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
      const have = photoTex(src!, im);
      plane.mat.map = have.full ?? have.small; // (the full one is brought in by `animate`, a plane a frame)
      plane.mat.needsUpdate = true;
      plane.mesh.scale.set(f.w * s, f.h * s, 1);
      plane.ready = true;
      if (changed || !wasShowing) plane.amt = how === "cross" ? 0 : 1;
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

  /** `startSlide`: the page has just begun to slide, so the numbers on show are kept for the page going out. */
  function paintPage(page: number, how: PageChange, startSlide = false) {
    if (startSlide) {
      numberGhosts.forEach((gn, slot) => {
        const ctx = gn.canvas.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, gn.canvas.width, gn.canvas.height);
        ctx.drawImage(numberPlates[slot].canvas, 0, 0);
        gn.tex.needsUpdate = true;
      });
    }
    paintNumbers(page);
    placePhotos(page, how);
    for (const st of strips) paintHaze(st, page);
    // the next page is the likely next thing: start its images loading, and make their small textures as they arrive
    for (const i of rig.layout.pages[page + 1] ?? []) if (i >= 0) warm(photos[i].src);
  }

  // ---- outline: the photo under the pointer (nothing is shown as selected: a photo is chosen by clicking it)
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
  const hovered = makeOutline("#fff6dc");
  const outlineSlot = (o: ReturnType<typeof makeOutline>, slot: number) => {
    const r = slotRect[slot];
    o.place(r.x, r.z, r.w + 1.4, r.h + 1.4);
  };

  const off = new Color("#6f7176");
  const on = new Color("#e8e0c8");
  let lastT = 0;
  let fade = 0; // 0..1: the page's film, dipping out and back in when it is changed
  let slide: { dir: 1 | -1; t: number } | null = null; // the film sliding to a new page (see below)
  let hazeSlide = 1; // 0..1: the haze, dipping out while the film slides
  g.userData.animate = ({ t, hover, focus }: AnimCtx) => {
    rig.step(t);
    const instant = t <= 0; // reduced motion: the scene clock is held, so ease nothing
    const dt = Math.max(0, t - lastT);
    lastT = t;
    const k = instant ? 1 : 1 - Math.exp(-dt * 10);

    // A different page. Looking at the page (on the map or open), the film slides: the page that was there runs off one
    // side as the new page runs in from the other (forward is the lever's way: it goes left). Looking at a photo there is
    // no slide (the view is already panning to the next photo): the new photos take the place of the old ones, each fading
    // in over the one it replaces. Only the first paint, and reduced motion, dip out and back instead.
    const looking = rig.mode === "photo";
    const canSlide = !looking && !instant && shownPage >= 0 && count > 0;
    const wantPage = rig.page;
    let how: PageChange = looking ? "cross" : slide ? "slide" : "dip";
    let startSlide = false;
    if (wantPage !== shownPage) {
      if (looking && shownPage >= 0) {
        slide = null;
        shownPage = wantPage;
        dirty = true;
      } else if (canSlide) {
        // (one already under way is ended on the spot: its page is then the one that slides out)
        slide = { dir: rig.dir, t: 0 };
        startSlide = true;
        how = "slide";
        shownPage = wantPage;
        dirty = true;
      } else {
        slide = null;
        how = "dip";
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
      paintPage(shownPage, how, startSlide);
      dirty = false;
    }
    // how far the slide has got: the live film comes in from one side while the one that was there goes out the other
    let inOff = 0;
    let outOff = 0;
    if (slide) {
      slide.t += dt;
      if (slide.t >= SLIDE_TIME) slide = null;
    }
    if (slide) {
      const u = Math.min(1, slide.t / SLIDE_TIME);
      const e = 1 - (1 - u) * (1 - u) * (1 - u); // quick off the mark, soft landing
      inOff = slide.dir * SLIDE_DIST * (1 - e);
      outOff = -slide.dir * SLIDE_DIST * e;
    }
    // the clip planes: the plate's left and right edges, in the world as it is now
    top.updateWorldMatrix(true, false);
    const me = top.matrixWorld;
    const across = new Vector3(me.elements[0], me.elements[1], me.elements[2]).normalize();
    clipL.setFromNormalAndCoplanarPoint(across, new Vector3(-plateW / 2, 0, 0).applyMatrix4(me));
    clipR.setFromNormalAndCoplanarPoint(across.clone().negate(), new Vector3(plateW / 2, 0, 0).applyMatrix4(me));
    // Photos at their own resolution, once the table is hovered or opened: one plane a frame (a mipmapped upload each), so
    // a page's six never land in one frame; a page that has just slid in sharpens within a few frames of arriving.
    if (hover > 0.5 || focus > 0.02 || looking) {
      for (const p of photoPlanes) {
        if (!p.ready || !p.src) continue;
        const e = textures.get(p.src);
        if (!e || (e.full && p.mat.map === e.full)) continue;
        const im = images.get(p.src);
        if (!im || !im.naturalWidth) continue;
        p.mat.map = fullTex(p.src, im);
        p.mat.needsUpdate = true;
        break;
      }
    }

    // The light. On the map the table is lit by hovering it; once the project is open it is lit, and stays on, and the
    // photos are shown plainly: the colour is the images' own, with no black and white under them, and no haze.
    const h = Math.min(1, Math.max(0, hover));
    const lit = Math.max(h, focus);
    const breath = 1 + Math.sin(t * 1.4) * 0.06 * h;
    plateMat.color.copy(off).lerp(on, h);
    const hazeClear = rig.mode === "photo" ? 0 : 1 - ease(focus);
    // the film's grey: black and white and dim unlit, colour and full brightness lit or open
    film.gray.value = 1 - lit;
    film.dim.value = 0.55 + 0.45 * lit;
    // the haze is a glow over the page that is there: it dips out while a page slides, and comes back
    hazeSlide += ((slide ? 0 : 1) - hazeSlide) * k;
    for (const st of strips) {
      st.mats.base.opacity = fade;
      st.meshes.base.visible = st.mats.base.opacity > 0.004;
      st.meshes.base.position.x = st.cx + inOff;
      st.baseOut.position.x = st.cx + outOff;
      st.baseOut.visible = slide !== null && st.meshes.base.visible;
      // the haze is for the map: gone once the project opens, and never there while looking at one photo
      st.mats.haze.opacity = h * 0.42 * breath * hazeClear * fade * hazeSlide;
      st.meshes.haze.visible = st.mats.haze.opacity > 0.004;
    }
    const ka = instant ? 1 : 1 - Math.exp(-dt * 11);
    photoPlanes.forEach((p, slot) => {
      p.mesh.position.x = slotRect[slot].x + inOff;
      p.ghost.position.x = slotRect[slot].x + outOff;
      p.amt += (1 - p.amt) * ka;
      if (1 - p.amt < 0.01) p.amt = 1;
      p.mat.opacity = fade * p.amt;
      p.mesh.visible = p.ready && p.mat.opacity > 0.004;
      // the photo that was here is held opaque under the new one until it is in, then goes (a photo whose image has not
      // arrived yet is not waited for: the old one fades out). While the page slides it is the page going out: held.
      if (p.ghostA > 0) {
        p.ghostT += dt;
        if (slide) {
          // (kept until the slide has run)
        } else if (p.ready) {
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
      p.ghostMat.opacity = fade * p.ghostA;
      p.ghost.visible = p.ghostA > 0 && p.ghostMat.opacity > 0.004;
    });
    numberPlates.forEach((n, slot) => {
      n.mat.opacity = lit * fade;
      n.mesh.visible = n.mat.opacity > 0.004;
      n.mesh.position.x = numBox[slot].x + inOff;
      const gn = numberGhosts[slot];
      gn.mat.opacity = lit * fade;
      gn.mesh.visible = slide !== null && gn.mat.opacity > 0.004;
      gn.mesh.position.x = numBox[slot].x + outOff;
    });

    // the outline of the photo under the pointer, when the project is open
    // (a photo can be on two pages, the last one repeating a few: the slot is looked up on the page that is showing)
    const shown = rig.layout.pages[shownPage] ?? [];
    const over = rig.hoverIndex;
    const overSlot = over !== null ? shown.indexOf(over) : -1;
    hovered.mat.opacity = overSlot >= 0 && rig.mode === "page" && !slide ? 0.95 * focus * fade : 0;
    if (overSlot >= 0) outlineSlot(hovered, overSlot);
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
export function sceneryModel(id: string, footprint: Footprint | undefined, prop: Prop, zones: Zone[]): Group | null {
  const w = footprint?.kind === "rect" ? footprint.w : 0;
  const d = footprint?.kind === "rect" ? footprint.h : 0;
  const site = constructionModel(id, w, d, prop);
  if (site) return site;
  const zone = zones.find((z) => z.kind === "gallery");
  const rig = zone ? filmRig(zone) : new FilmRig();
  switch (id) {
    case "omcamera":
      return omCameraModel(rig);
    case "telephoto":
      return telephotoModel();
    case "film-canister":
      return filmCanisterModel();
    case "filter-stack":
      return filterStackModel();
    case "lighttable":
      return lightTableModel(w, d, zone, rig);
    case "deskmat":
      return deskMatModel(w, d);
    case "plaques":
      return plaquesModel(w);
  }
  return null;
}
