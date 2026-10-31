import { navigate } from "astro:transitions/client";
import { clampDrag, type Box, type Point } from "./drag";
import { fullRect, type Rect } from "./fullrect";
import { edgeTime } from "./reveal";
import { orgLine } from "./orgline";
import type { Zone, ZoneAction } from "./world";
import { buildMedia } from "./panelmedia";

export type PanelSide = "left" | "right" | "bottom";

/**
 * The photography page is the scene itself (the light table and the camera are the controls, and the title and place of
 * the photo are printed on the film), so it has no card: at most a small link in the corner, and nothing at all when the
 * zone has no actions.
 */
const isLinkOnly = (zone: Zone) => zone.kind === "gallery";

const KIND_LABEL: Record<string, string> = { project: "Project", gallery: "Photography", about: "About me" };

/** Follows a link: external ones in a new tab, mailto: in this window, the rest through the site's router. */
export function openAction(a: ZoneAction) {
  if (a.external) window.open(a.href, "_blank", "noopener,noreferrer");
  else if (a.href.startsWith("mailto:")) location.href = a.href;
  else navigate(a.href);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The card is laid out for a window of this size; a larger window scales it up (to CARD_SCALE_MAX), a smaller one leaves it as is. */
const CARD_BASE_W = 1440;
const CARD_BASE_H = 820;
const CARD_SCALE_MAX = 1.75;
const CARD_WIDTH = 580;
/** The close button on a side card sits this far (base px) outside it, and is this big. */
const CLOSE_SIZE = 34;
const CLOSE_GAP = 10;

/** How much bigger than its base size the card is for this window: the limiting side decides, so a wide but short window gets no oversized card. */
export function cardScale(w = innerWidth, h = innerHeight): number {
  return Math.min(CARD_SCALE_MAX, Math.max(1, Math.min(w / CARD_BASE_W, h / CARD_BASE_H)));
}

/** The project card that slides in beside the zoomed-in project box (a bottom sheet on narrow screens). */
export class Panel {
  private root: HTMLElement;
  private backdrop: HTMLElement;
  private logo: HTMLImageElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private role: HTMLElement;
  private head: HTMLElement;
  private sheet: HTMLElement;
  private closeBtn: HTMLElement;
  private expandBtn: HTMLButtonElement;
  /** The card is expanded to nearly the whole window (or is on its way: this is the state it is going to). */
  private full = false;
  private growTimer = 0;
  private brand: HTMLElement;
  private when: HTMLElement;
  private note: HTMLElement;
  private badge: HTMLElement;
  private org: HTMLElement;
  private summary: HTMLElement;
  private bullets: HTMLElement;
  private tags: HTMLElement;
  private media: HTMLElement;
  private actions: HTMLElement;
  private grip: HTMLElement;
  private closeTimer = 0;
  /** How far the side card has been dragged from where it rests (it is put back on every open). */
  private drag: Point = { x: 0, y: 0 };
  private dragging: { id: number; from: Point; rect: Box; offset: Point } | null = null;
  private stopMedia: (() => void) | undefined;
  isOpen = false;
  /** Called when the panel closes (Esc, the close button or the backdrop). */
  onClose: () => void = () => {};
  /** Asked when the backdrop is pressed: return true if the press was for something in the scene behind it (the panel stays). */
  onBackdropPress: (e: PointerEvent) => boolean = () => false;
  /** Asked before Esc closes the panel: return true if it dealt with the key itself (e.g. zoomed back out a level). */
  beforeEscape: () => boolean = () => false;

  constructor(root: HTMLElement, backdrop: HTMLElement, signal: AbortSignal) {
    this.root = root;
    this.backdrop = backdrop;
    this.logo = root.querySelector("[data-logo]")!;
    this.kicker = root.querySelector("[data-kicker]")!;
    this.title = root.querySelector("[data-title]")!;
    this.role = root.querySelector("[data-role]")!;
    this.head = root.querySelector(".head")!;
    this.sheet = root.querySelector("[data-sheet]")!;
    this.closeBtn = root.querySelector("[data-close]")!;
    this.expandBtn = root.querySelector("[data-expand]")!;
    this.brand = root.querySelector("[data-brand]")!;
    this.when = root.querySelector("[data-when]")!;
    this.note = root.querySelector("[data-note]")!;
    this.badge = root.querySelector("[data-badge]")!;
    this.org = root.querySelector("[data-org]")!;
    this.summary = root.querySelector("[data-summary]")!;
    this.bullets = root.querySelector("[data-bullets]")!;
    this.tags = root.querySelector("[data-tags]")!;
    this.media = root.querySelector("[data-media]")!;
    this.actions = root.querySelector("[data-actions]")!;
    this.grip = root.querySelector("[data-grip]")!;
    addEventListener(
      "resize",
      () => {
        this.fit();
        this.keepOnScreen();
      },
      { signal }
    );
    this.listenForDrag(this.head, signal);
    this.closeBtn.addEventListener("click", () => this.close(), { signal });
    this.expandBtn.addEventListener("click", () => this.setFull(!this.full), { signal });
    backdrop.addEventListener(
      "pointerdown",
      (e) => {
        if (this.onBackdropPress(e)) return;
        if (this.full) this.setFull(false); // (the margin round an expanded card is easy to hit: it shrinks, it does not close)
        else this.close();
      },
      { signal }
    );
    this.grip.addEventListener("click", () => this.setExpanded(!this.root.classList.contains("expanded")), { signal });
    document.addEventListener(
      "keydown",
      (e) => {
        if (this.isOpen && e.key === "Escape") {
          e.preventDefault();
          if (this.full) this.setFull(false);
          else if (!this.beforeEscape()) this.close();
        }
      },
      { signal }
    );
  }

  /** Fraction of the viewport the panel covers on its axis (width for left/right, height for the bottom sheet). */
  coverage(side: PanelSide, zone?: Zone): number {
    // the photography page has no card, so the scene may use the whole screen
    if (zone && isLinkOnly(zone)) return 0;
    if (side === "bottom") return 0.5;
    const scale = cardScale();
    const w = Math.min(CARD_WIDTH * scale, innerWidth * 0.42) + (CLOSE_SIZE + CLOSE_GAP) * scale; // (the close button sits beside the card)
    return Math.min(0.55, (w + Math.max(24, innerWidth * 0.03) + 16) / innerWidth);
  }

  /** A side card is moved by its header; the bottom sheet and the gallery link stay where they are. */
  private canDrag(): boolean {
    const side = this.root.dataset.side;
    return this.isOpen && !this.full && this.root.dataset.variant !== "link" && (side === "left" || side === "right");
  }

  /** Expands the card to nearly the whole window, or puts it back (only a card that is marked `expandable`, beside the project). */
  private setFull(on: boolean) {
    if (on === this.full || this.expandBtn.hidden || !this.isOpen || this.growTimer) return;
    this.endDrag();
    this.full = on;
    this.expandBtn.classList.toggle("is-full", on);
    this.expandBtn.setAttribute("aria-expanded", String(on));
    this.expandBtn.setAttribute("aria-label", on ? "Shrink" : "Expand");
    const root = this.root;
    const parent = root.offsetParent as HTMLElement | null;
    if (!parent || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.setDrag({ x: 0, y: 0 });
      root.classList.toggle("full", on);
      return;
    }
    // The new content (the media, the buttons) is out of the way (.hold) while the card changes layout, and each item fades in
    // as the growing paper reaches it (and out as the shrinking paper leaves it): see reveal.ts and revealDelays().
    if (on) {
      root.classList.add("hold"); // (they fade out, then the layout is spread and the paper grows)
      this.sheet.scrollTo({ top: 0, behavior: "smooth" }); // (so the text is where the spread layout puts it)
      this.growTimer = window.setTimeout(() => this.runGrow(parent, true), 200);
    } else this.runGrow(parent, false);
  }

  /** The two-column layout has room only on a wide window. */
  private spreadable() {
    return innerWidth >= 1000;
  }

  /** Animates the card between two pixel boxes: it is laid out from its side with a transform, which cannot be animated to "inset all round". */
  private runGrow(parent: HTMLElement, on: boolean) {
    const root = this.root;
    const body = root.querySelector(".body") as HTMLElement;
    const place = parent.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({
      left: r.left - place.left - parent.clientLeft,
      top: r.top - place.top - parent.clientTop,
      width: r.width,
      height: r.height,
    });
    const spread = this.spreadable();
    const from = rel(root.getBoundingClientRect());
    let to: Rect;
    let copyW: number; // the text's width, in the small card
    let bodyW: number; // the width the body is held at while the paper moves
    if (on) {
      to = fullRect({ w: parent.clientWidth, h: parent.clientHeight }, Math.max(24, innerWidth * 0.03));
      copyW = this.head.offsetWidth;
      // the body is laid out at the size it will have, and the paper uncovers it (a window too narrow for two columns keeps the small card's width)
      bodyW = spread ? to.width - (this.sheet.offsetWidth - this.sheet.clientWidth) : body.offsetWidth;
    } else {
      bodyW = body.offsetWidth;
      // where it rests: measured now, in its own layout, with the drag taken off (and no transitions, which would
      // still be at the start of their way, with the card's transform not yet applied)
      root.style.transition = "none";
      root.classList.remove("full", "spread");
      this.setDrag({ x: 0, y: 0 });
      to = rel(root.getBoundingClientRect());
      copyW = this.head.offsetWidth;
      root.classList.add("full", "spread"); // the two-column layout stays until the paper has shrunk: the text does not move
    }
    root.style.setProperty("--copy-w", `${copyW}px`);
    root.style.setProperty("--body-w", `${bodyW}px`);
    const box = (g: Rect) => {
      const s = root.style;
      s.left = `${g.left}px`;
      s.top = `${g.top}px`;
      s.width = `${g.width}px`;
      s.height = `${g.height}px`;
    };
    // no transitions while the card is put on its starting box (its transform and `top: 50%` would otherwise be animated away from),
    // then they are let loose, and the next box is animated to
    root.style.transition = "none";
    root.classList.add("growing", "pin");
    if (on) root.classList.add("spread");
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.maxHeight = "none";
    root.style.transform = "none";
    box(from);
    void root.offsetWidth;
    if (spread) this.revealDelays(rel, on, from, to);
    root.style.removeProperty("transition");
    box(to);
    // growing: the content fades in as the paper reaches it, now; shrinking: it fades out as the paper leaves it
    if (on && spread) root.classList.remove("hold");
    else if (!on) root.classList.add("hold");
    this.growTimer = window.setTimeout(() => this.finishGrow(), 480);
  }

  /**
   * Sets when each item of the new content fades, from where the layout puts it: an item fades in when the paper's moving edge
   * reaches its near side. Shrinking plays that backwards in time (the paper's edge sweeps past the far items too quickly for
   * "faded out by the time it passes" to tell them apart), so the farthest item fades out first and the nearest last.
   */
  private revealDelays(rel: (r: DOMRect) => Rect, on: boolean, from: Rect, to: Rect) {
    const items = [...this.root.querySelectorAll<HTMLElement>(".media-item, .actions")];
    const right = this.root.dataset.side === "right"; // the card is on the right: the paper grows towards the left
    const edge = (g: Rect) => (right ? g.left : g.left + g.width);
    const small = edge(on ? from : to); // (the edge as it is in the small card, and as it is when expanded)
    const full = edge(on ? to : from);
    const fade = 240;
    const move = 450;
    const rows = [...new Set(items.map((it) => Math.round(rel(it.getBoundingClientRect()).top / 8)))].sort((a, b) => a - b);
    for (const it of items) {
      const r = rel(it.getBoundingClientRect());
      const near = right ? r.left + r.width : r.left;
      const row = rows.indexOf(Math.round(r.top / 8));
      const start = edgeTime(near, small, full, move) + row * 40; // (when it fades in, expanding)
      const ms = on ? start : Math.max(0, move - start - fade);
      it.style.setProperty("--d", `${Math.round(ms)}ms`);
    }
  }

  /** Takes the pixel box off the card, so that its own layout is in charge again. */
  private clearBox() {
    for (const p of ["left", "top", "width", "height", "right", "bottom", "max-height", "transform"]) this.root.style.removeProperty(p);
  }

  /** The end of the grow or shrink: the card's own layout takes over from the pixel boxes. */
  private finishGrow() {
    if (!this.growTimer) return;
    window.clearTimeout(this.growTimer);
    this.growTimer = 0;
    // swapped with transitions off, or the card's own transform would glide into place from where the pixel box left it
    const root = this.root;
    root.style.transition = "none";
    this.clearBox();
    root.classList.remove("growing", "pin");
    root.classList.toggle("full", this.full);
    root.classList.toggle("spread", this.full);
    void root.offsetWidth;
    root.style.removeProperty("transition");
    // the paper has stopped: what is still hidden comes back at once (the media below the text, after a shrink)
    for (const it of root.querySelectorAll<HTMLElement>(".media-item, .actions")) it.style.removeProperty("--d");
    requestAnimationFrame(() => root.classList.remove("hold"));
  }

  private setDrag(p: Point) {
    this.drag = p;
    this.root.style.setProperty("--drag-x", `${p.x}px`);
    this.root.style.setProperty("--drag-y", `${p.y}px`);
  }

  private endDrag() {
    this.dragging = null;
    this.root.classList.remove("dragging");
  }

  /** The card and its close button (which sits outside it), as one box: that is what has to stay inside the window. */
  private box(): Box {
    const a = this.root.getBoundingClientRect();
    const c = this.closeBtn.getBoundingClientRect();
    return {
      left: Math.min(a.left, c.left),
      top: Math.min(a.top, c.top),
      right: Math.max(a.right, c.right),
      bottom: Math.max(a.bottom, c.bottom),
    };
  }

  /** After the window changes size, a dragged card is pulled back inside it. */
  private keepOnScreen() {
    if (!this.canDrag() || (this.drag.x === 0 && this.drag.y === 0)) return;
    this.setDrag(clampDrag(this.box(), this.drag, { x: 0, y: 0 }, { w: innerWidth, h: innerHeight }));
  }

  private listenForDrag(handle: Element, signal: AbortSignal) {
    handle.addEventListener(
      "pointerdown",
      (e) => {
        const ev = e as PointerEvent;
        if (ev.button !== 0 || !this.canDrag()) return;
        this.dragging = {
          id: ev.pointerId,
          from: { x: ev.clientX, y: ev.clientY },
          rect: this.box(),
          offset: { ...this.drag },
        };
        handle.setPointerCapture(ev.pointerId);
        this.root.classList.add("dragging");
        ev.preventDefault(); // (no text selection while dragging)
      },
      { signal }
    );
    handle.addEventListener(
      "pointermove",
      (e) => {
        const ev = e as PointerEvent;
        const d = this.dragging;
        if (!d || ev.pointerId !== d.id) return;
        const delta = { x: ev.clientX - d.from.x, y: ev.clientY - d.from.y };
        this.setDrag(clampDrag(d.rect, d.offset, delta, { w: innerWidth, h: innerHeight }));
      },
      { signal }
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, () => this.endDrag(), { signal });
  }

  /** Size the card for the window: the CSS reads --card-scale (the bottom sheet stays at its own size; the gallery link scales with the window). */
  private fit() {
    const sheet = this.root.dataset.side === "bottom" && this.root.dataset.variant !== "link";
    const scale = sheet ? 1 : cardScale();
    this.root.style.setProperty("--card-scale", String(+scale.toFixed(3)));
  }

  open(zone: Zone, side: PanelSide) {
    window.clearTimeout(this.closeTimer);
    const linkOnly = isLinkOnly(zone);
    const empty = linkOnly && !zone.actions?.length; // the scene is all there is: no panel to show
    this.fill(zone);
    this.setExpanded(false);
    this.endDrag();
    this.setDrag({ x: 0, y: 0 }); // every open starts in the default spot
    this.resetFull(zone, side);
    this.root.dataset.side = side;
    this.root.dataset.variant = linkOnly ? "link" : "card";
    this.fit();
    // the link sits over a scene that stays clickable (the camera's controls, the table), so nothing is dimmed or blocked
    this.root.setAttribute("aria-modal", String(!linkOnly));
    if (linkOnly && !empty) this.root.setAttribute("aria-label", `${zone.label}: link to the full gallery`);
    else this.root.removeAttribute("aria-label");
    this.sheet.scrollTop = 0;
    this.root.hidden = empty;
    this.backdrop.hidden = linkOnly;
    this.isOpen = true;
    // next frame, so the slide-in transition runs from its starting position
    requestAnimationFrame(() => {
      this.root.classList.add("open");
      // a card takes the focus (its close button); the link does not, so the arrow keys and Enter go to the scene
      if (!linkOnly) (this.root.querySelector("[data-close]") as HTMLElement).focus({ preventScroll: true });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.stopMedia?.();
    this.finishGrow();
    this.root.classList.remove("open");
    this.endDrag();
    this.backdrop.hidden = true;
    this.closeTimer = window.setTimeout(() => (this.root.hidden = true), 320);
    this.onClose();
  }

  destroy() {
    window.clearTimeout(this.closeTimer);
    this.stopMedia?.();
    this.isOpen = false;
    this.root.hidden = true;
    this.root.classList.remove("open");
    this.backdrop.hidden = true;
  }

  /** Every open starts as the ordinary card; the expand button is there only for a project marked expandable, beside the project. */
  private resetFull(zone: Zone, side: PanelSide) {
    window.clearTimeout(this.growTimer);
    this.growTimer = 0;
    this.clearBox();
    this.root.style.removeProperty("transition");
    for (const p of ["--copy-w", "--body-w"]) this.root.style.removeProperty(p);
    for (const it of this.root.querySelectorAll<HTMLElement>(".media-item, .actions")) it.style.removeProperty("--d");
    this.root.classList.remove("growing", "full", "spread", "hold", "pin");
    this.full = false;
    const can = !!zone.expandable && !isLinkOnly(zone) && (side === "left" || side === "right");
    this.expandBtn.hidden = !can;
    this.expandBtn.classList.remove("is-full");
    this.expandBtn.setAttribute("aria-expanded", "false");
    this.expandBtn.setAttribute("aria-label", "Expand");
    this.root.toggleAttribute("data-expandable", can);
    this.setDrag({ x: 0, y: 0 });
  }

  private setExpanded(on: boolean) {
    this.root.classList.toggle("expanded", on);
    this.grip.setAttribute("aria-expanded", String(on));
  }

  private fill(zone: Zone) {
    // the top row: the logo, shown whole, with the organisation beside it (unless the title already says it); no row when there is neither
    if (zone.image) this.logo.src = zone.image;
    else this.logo.removeAttribute("src");
    this.logo.hidden = !zone.image;
    const org = zone.brand ?? orgLine(zone.label, zone.organization);
    this.org.textContent = org;
    this.org.hidden = !org;
    this.note.textContent = zone.brandNote ?? "";
    this.note.hidden = !zone.brandNote;
    this.brand.hidden = !zone.image && !org && !zone.brandNote;
    this.head.classList.toggle("has-brand", !this.brand.hidden); // (without it the title itself clears the close button)

    // a card with its own heading beside the logo (`brand`) uses that as its title: what is below it is dropped, or is a smaller line
    const brandTitle = !!zone.brand;
    this.org.classList.toggle("is-title", brandTitle);
    if (brandTitle) this.org.setAttribute("role", "heading"), this.org.setAttribute("aria-level", "2");
    else this.org.removeAttribute("role"), this.org.removeAttribute("aria-level");
    this.root.setAttribute("aria-labelledby", brandTitle ? "panel-brand" : "panel-title");
    this.title.textContent = brandTitle ? (zone.subtitle ?? "") : zone.label;
    this.title.hidden = !this.title.textContent;
    this.title.classList.toggle("sub", brandTitle);
    if (brandTitle) this.title.setAttribute("role", "doc-subtitle");
    else this.title.removeAttribute("role");
    this.role.textContent = zone.role ?? "";
    this.role.hidden = !zone.role;
    // the date sits under the role; cards without one (contact) show what kind of card they are
    this.kicker.textContent = zone.period || KIND_LABEL[zone.kind] || "";
    // a project still on the default site is not finished: say so on its card, beside the date
    this.badge.hidden = zone.variant !== "construction";
    this.when.hidden = !this.kicker.textContent && this.badge.hidden;
    this.summary.textContent = zone.summary;

    this.bullets.replaceChildren(...(zone.bullets ?? []).map((b) => el("li", undefined, b)));
    this.bullets.hidden = !zone.bullets?.length;
    this.tags.replaceChildren(...(zone.techStack ?? []).map((t) => el("li", "tag", t)));
    this.tags.hidden = !zone.techStack?.length;

    // the pictures and clips are made when the card opens, so none of them is fetched before it
    this.stopMedia?.();
    const media = zone.media?.length ? buildMedia(zone.media) : undefined;
    this.stopMedia = media?.stop;
    this.media.replaceChildren(...(media?.nodes ?? []));
    this.media.hidden = !media;

    this.actions.replaceChildren();
    const actions: ZoneAction[] = zone.actions ?? [];
    actions.forEach((a, i) => {
      const b = el("button", i === 0 ? "btn primary" : "btn", a.label);
      b.type = "button";
      b.addEventListener("click", () => openAction(a));
      this.actions.append(b);
    });
    this.actions.hidden = actions.length === 0;
  }
}
