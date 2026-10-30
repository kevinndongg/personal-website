import { navigate } from "astro:transitions/client";
import { clampDrag, type Box, type Point } from "./drag";
import { orgLine } from "./orgline";
import type { Zone, ZoneAction } from "./world";

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
  private brand: HTMLElement;
  private when: HTMLElement;
  private note: HTMLElement;
  private badge: HTMLElement;
  private org: HTMLElement;
  private summary: HTMLElement;
  private bullets: HTMLElement;
  private tags: HTMLElement;
  private actions: HTMLElement;
  private grip: HTMLElement;
  private closeTimer = 0;
  /** How far the side card has been dragged from where it rests (it is put back on every open). */
  private drag: Point = { x: 0, y: 0 };
  private dragging: { id: number; from: Point; rect: Box; offset: Point } | null = null;
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
    this.brand = root.querySelector("[data-brand]")!;
    this.when = root.querySelector("[data-when]")!;
    this.note = root.querySelector("[data-note]")!;
    this.badge = root.querySelector("[data-badge]")!;
    this.org = root.querySelector("[data-org]")!;
    this.summary = root.querySelector("[data-summary]")!;
    this.bullets = root.querySelector("[data-bullets]")!;
    this.tags = root.querySelector("[data-tags]")!;
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
    backdrop.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.onBackdropPress(e)) this.close();
      },
      { signal }
    );
    this.grip.addEventListener("click", () => this.setExpanded(!this.root.classList.contains("expanded")), { signal });
    document.addEventListener(
      "keydown",
      (e) => {
        if (this.isOpen && e.key === "Escape") {
          e.preventDefault();
          if (!this.beforeEscape()) this.close();
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
    return this.isOpen && this.root.dataset.variant !== "link" && (side === "left" || side === "right");
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
    this.root.classList.remove("open");
    this.endDrag();
    this.backdrop.hidden = true;
    this.closeTimer = window.setTimeout(() => (this.root.hidden = true), 320);
    this.onClose();
  }

  destroy() {
    window.clearTimeout(this.closeTimer);
    this.isOpen = false;
    this.root.hidden = true;
    this.root.classList.remove("open");
    this.backdrop.hidden = true;
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
