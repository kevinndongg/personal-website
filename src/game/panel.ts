import { navigate } from "astro:transitions/client";
import type { Zone, ZoneAction } from "./world";

export type PanelSide = "left" | "right" | "bottom";

const KIND_LABEL: Record<string, string> = { project: "Project", gallery: "Photography", contact: "Get in touch" };

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
  private media: HTMLElement;
  private logo: HTMLImageElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private role: HTMLElement;
  private summary: HTMLElement;
  private bullets: HTMLElement;
  private tags: HTMLElement;
  private actions: HTMLElement;
  private grip: HTMLElement;
  private closeTimer = 0;
  isOpen = false;
  /** Called when the panel closes (Esc, the close button or the backdrop). */
  onClose: () => void = () => {};

  constructor(root: HTMLElement, backdrop: HTMLElement, signal: AbortSignal) {
    this.root = root;
    this.backdrop = backdrop;
    this.media = root.querySelector("[data-media]")!;
    this.logo = root.querySelector("[data-logo]")!;
    this.kicker = root.querySelector("[data-kicker]")!;
    this.title = root.querySelector("[data-title]")!;
    this.role = root.querySelector("[data-role]")!;
    this.summary = root.querySelector("[data-summary]")!;
    this.bullets = root.querySelector("[data-bullets]")!;
    this.tags = root.querySelector("[data-tags]")!;
    this.actions = root.querySelector("[data-actions]")!;
    this.grip = root.querySelector("[data-grip]")!;
    root.querySelector("[data-close]")!.addEventListener("click", () => this.close(), { signal });
    backdrop.addEventListener("pointerdown", () => this.close(), { signal });
    this.grip.addEventListener("click", () => this.setExpanded(!this.root.classList.contains("expanded")), { signal });
    document.addEventListener(
      "keydown",
      (e) => {
        if (this.isOpen && e.key === "Escape") {
          e.preventDefault();
          this.close();
        }
      },
      { signal }
    );
  }

  /** Fraction of the viewport the panel covers on its axis (width for left/right, height for the bottom sheet). */
  coverage(side: PanelSide): number {
    if (side === "bottom") return 0.5;
    const w = Math.min(460, innerWidth * 0.42);
    return Math.min(0.55, (w + Math.max(24, innerWidth * 0.03) + 16) / innerWidth);
  }

  open(zone: Zone, side: PanelSide) {
    window.clearTimeout(this.closeTimer);
    this.fill(zone);
    this.setExpanded(false);
    this.root.dataset.side = side;
    this.root.style.setProperty("--accent", zone.accent);
    this.root.scrollTop = 0;
    this.root.hidden = false;
    this.backdrop.hidden = false;
    this.isOpen = true;
    // next frame, so the slide-in transition runs from its starting position
    requestAnimationFrame(() => {
      this.root.classList.add("open");
      (this.root.querySelector("[data-close]") as HTMLElement).focus({ preventScroll: true });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove("open");
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
    // the gallery shows a strip of its photos on top; projects show their logo as a chip beside the title
    this.media.replaceChildren();
    this.media.hidden = true;
    if (zone.thumbs?.length) {
      for (const src of zone.thumbs) {
        const img = el("img");
        img.src = src;
        img.alt = "";
        this.media.append(img);
      }
      this.media.hidden = false;
      this.media.dataset.kind = "thumbs";
    }
    if (zone.image) this.logo.src = zone.image;
    else this.logo.removeAttribute("src");
    this.logo.hidden = !zone.image;

    const meta = [zone.period, zone.organization].filter(Boolean).join(" · ");
    this.kicker.textContent = meta || KIND_LABEL[zone.kind] || "";
    this.title.textContent = zone.label;
    this.role.textContent = zone.role ?? "";
    this.role.hidden = !zone.role;
    this.summary.textContent = zone.summary;

    this.bullets.replaceChildren(...(zone.bullets ?? []).map((b) => el("li", undefined, b)));
    this.bullets.hidden = !zone.bullets?.length;
    this.tags.replaceChildren(...(zone.techStack ?? []).map((t) => el("li", "tag", t)));
    this.tags.hidden = !zone.techStack?.length;

    this.actions.replaceChildren();
    const open = (a: ZoneAction) => {
      if (a.external) window.open(a.href, "_blank", "noopener,noreferrer");
      else if (a.href.startsWith("mailto:")) location.href = a.href;
      else navigate(a.href);
    };
    const actions: ZoneAction[] = zone.actions ?? [];
    actions.forEach((a, i) => {
      const b = el("button", i === 0 && zone.kind !== "contact" ? "btn primary" : "btn", a.label);
      b.type = "button";
      b.addEventListener("click", () => open(a));
      this.actions.append(b);
    });
    this.actions.hidden = actions.length === 0;
  }
}
