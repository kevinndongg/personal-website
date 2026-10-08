import { navigate } from "astro:transitions/client";
import type { Zone } from "./world";

const TYPE_CPS = 55;

interface Option {
  label: string;
  run: () => void;
}

/** Pokemon-style dialogue box: typewriter text, then a small menu. */
export class Overlay {
  private root: HTMLElement;
  private text: HTMLElement;
  private menu: HTMLElement;
  private more: HTMLElement;
  private options: Option[] = [];
  private selected = 0;
  private full = "";
  private shown = 0;
  private timer = 0;
  private lastTick = 0;
  open = false;
  onClose: () => void = () => {};

  constructor(root: HTMLElement, signal: AbortSignal) {
    this.root = root;
    this.text = root.querySelector("[data-dlg-text]")!;
    this.menu = root.querySelector("[data-dlg-menu]")!;
    this.more = root.querySelector("[data-dlg-more]")!;
    document.addEventListener("keydown", (e) => this.onKey(e), { signal });
    root.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-dlg-menu]")) return;
      if (this.typing) this.finishTyping();
    }, { signal });
  }

  private get typing() {
    return this.shown < this.full.length;
  }

  show(zone: Zone) {
    const actions = zone.actions ?? [
      { label: zone.kind === "gallery" ? "Open gallery" : "Open project", href: zone.href! },
    ];
    this.options = [
      ...actions.map((a) => ({
        label: a.label,
        run: () => {
          if (a.external) window.open(a.href, "_blank", "noopener,noreferrer");
          else if (a.href.startsWith("mailto:")) location.href = a.href;
          else navigate(a.href);
        },
      })),
      { label: "Not now", run: () => this.close() },
    ];
    this.full = `${zone.label}. ${zone.summary}`;
    this.shown = 0;
    this.selected = 0;
    this.text.textContent = "";
    this.menu.hidden = true;
    this.more.hidden = true;
    this.root.hidden = false;
    this.root.dataset.accent = zone.accent;
    this.root.style.setProperty("--accent", zone.accent);
    this.open = true;
    this.lastTick = performance.now();
    this.tick();
    this.root.focus({ preventScroll: true });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this.timer);
    this.root.hidden = true;
    this.onClose();
  }

  destroy() {
    cancelAnimationFrame(this.timer);
    this.open = false;
    this.root.hidden = true;
  }

  private tick = () => {
    const now = performance.now();
    const advance = Math.floor(((now - this.lastTick) / 1000) * TYPE_CPS);
    if (advance > 0) {
      this.lastTick = now;
      this.shown = Math.min(this.full.length, this.shown + advance);
      this.text.textContent = this.full.slice(0, this.shown);
    }
    if (this.typing) this.timer = requestAnimationFrame(this.tick);
    else this.finishTyping();
  };

  private finishTyping() {
    cancelAnimationFrame(this.timer);
    this.shown = this.full.length;
    this.text.textContent = this.full;
    this.renderMenu();
  }

  private renderMenu() {
    this.menu.replaceChildren(
      ...this.options.map((opt, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dlg-opt";
        b.textContent = opt.label;
        b.setAttribute("aria-selected", String(i === this.selected));
        b.addEventListener("pointerenter", () => this.select(i));
        b.addEventListener("click", () => opt.run());
        return b;
      })
    );
    this.menu.hidden = false;
  }

  private select(i: number) {
    this.selected = i;
    this.menu.querySelectorAll(".dlg-opt").forEach((el, j) => el.setAttribute("aria-selected", String(j === i)));
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    if (e.key === "Escape" || e.key === "x" || e.key === "X") {
      e.preventDefault();
      this.close();
      return;
    }
    if (this.typing) {
      if (e.key === "Enter" || e.key === " " || e.key === "z" || e.key === "Z") {
        e.preventDefault();
        this.finishTyping();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      this.select((this.selected + 1) % this.options.length);
    } else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      this.select((this.selected + this.options.length - 1) % this.options.length);
    } else if (e.key === "Enter" || e.key === " " || e.key === "z" || e.key === "Z") {
      e.preventDefault();
      this.options[this.selected].run();
    }
  }
}
