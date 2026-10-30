import { navigate } from "astro:transitions/client";
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

/** The project card that slides in beside the zoomed-in project box (a bottom sheet on narrow screens). */
export class Panel {
  private root: HTMLElement;
  private backdrop: HTMLElement;
  private logo: HTMLImageElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private role: HTMLElement;
  private summary: HTMLElement;
  private bullets: HTMLElement;
  private tags: HTMLElement;
  private media: HTMLElement;
  private actions: HTMLElement;
  private grip: HTMLElement;
  private closeTimer = 0;
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
    this.summary = root.querySelector("[data-summary]")!;
    this.bullets = root.querySelector("[data-bullets]")!;
    this.tags = root.querySelector("[data-tags]")!;
    this.media = root.querySelector("[data-media]")!;
    this.actions = root.querySelector("[data-actions]")!;
    this.grip = root.querySelector("[data-grip]")!;
    root.querySelector("[data-close]")!.addEventListener("click", () => this.close(), { signal });
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
    const w = Math.min(460, innerWidth * 0.42);
    return Math.min(0.55, (w + Math.max(24, innerWidth * 0.03) + 16) / innerWidth);
  }

  open(zone: Zone, side: PanelSide) {
    window.clearTimeout(this.closeTimer);
    const linkOnly = isLinkOnly(zone);
    const empty = linkOnly && !zone.actions?.length; // the scene is all there is: no panel to show
    this.fill(zone);
    this.setExpanded(false);
    this.root.dataset.side = side;
    this.root.dataset.variant = linkOnly ? "link" : "card";
    // the link sits over a scene that stays clickable (the camera's controls, the table), so nothing is dimmed or blocked
    this.root.setAttribute("aria-modal", String(!linkOnly));
    if (linkOnly && !empty) this.root.setAttribute("aria-label", `${zone.label}: link to the full gallery`);
    else this.root.removeAttribute("aria-label");
    this.root.scrollTop = 0;
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
    this.root.classList.remove("open");
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

  private setExpanded(on: boolean) {
    this.root.classList.toggle("expanded", on);
    this.grip.setAttribute("aria-expanded", String(on));
  }

  private fill(zone: Zone) {
    // projects show their logo as a chip beside the title
    if (zone.image) this.logo.src = zone.image;
    else this.logo.removeAttribute("src");
    this.logo.hidden = !zone.image;

    // a project still on the default site is not finished: say so on its card
    const meta = [zone.variant === "construction" && "Under construction", zone.period, zone.organization]
      .filter(Boolean)
      .join(" · ");
    this.kicker.textContent = meta || KIND_LABEL[zone.kind] || "";
    this.title.textContent = zone.label;
    this.role.textContent = zone.role ?? "";
    this.role.hidden = !zone.role;
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
