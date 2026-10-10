import { Panel } from "./panel";
import type { PanelSide } from "./panel";
import { Renderer3D } from "./render3d";
import { TILE, generateWorld, rectContains } from "./world";
import type { Zone, ZoneInput } from "./world";

/** Boots the scene inside `root`. Returns a teardown function. */
export function startGame(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-canvas]")!;
  const labelsEl = root.querySelector<HTMLElement>("[data-labels]")!;
  const hint = root.querySelector<HTMLElement>("[data-hint]");
  const banner = root.querySelector<HTMLElement>("[data-banner]");
  const abort = new AbortController();
  const { signal } = abort;

  const inputs: ZoneInput[] = JSON.parse(root.dataset.zones ?? "[]");
  const world = generateWorld(inputs);
  const renderer = new Renderer3D(canvas, world);
  const panel = new Panel(
    root.querySelector<HTMLElement>("[data-panel]")!,
    root.querySelector<HTMLElement>("[data-backdrop]")!,
    signal
  );
  const mapSize = world.w * TILE;

  let hoveredId: string | null = null; // project box under the pointer
  const lift = new Map<string, number>(world.zones.map((z) => [z.id, 0]));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const labels = world.zones.map((zone) => {
    const el = document.createElement("div");
    el.className = "zone-label";
    el.textContent = zone.label;
    el.style.setProperty("--accent", zone.accent);
    labelsEl.append(el);
    return el;
  });

  function resize() {
    renderer.resize(innerWidth, innerHeight);
  }
  resize();
  addEventListener("resize", resize, { signal });
  root.classList.add("ready");

  function zoneAt(x: number, y: number): Zone | null {
    return world.zones.find((z) => rectContains(z.scene.area, x, y)) ?? null;
  }

  function open(zone: Zone) {
    const a = zone.scene.area;
    const narrow = innerWidth < 760 || innerWidth < innerHeight * 0.9;
    const side: PanelSide = narrow ? "bottom" : a.x + a.w / 2 < mapSize / 2 ? "right" : "left";
    renderer.focus(zone.id, side);
    panel.open(zone, side);
    hoveredId = zone.id;
    hint?.classList.add("gone");
  }

  panel.onClose = () => {
    renderer.focus(null);
    hoveredId = null;
  };

  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (panel.isOpen || e.pointerType === "touch") return;
      const hit = renderer.pick(e.clientX, e.clientY);
      hoveredId = hit ? (zoneAt(hit.x, hit.y)?.id ?? null) : null;
      canvas.style.cursor = hoveredId ? "pointer" : "default";
    },
    { signal }
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      if (!panel.isOpen) hoveredId = null;
    },
    { signal }
  );
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (panel.isOpen || e.button !== 0) return;
      const hit = renderer.pick(e.clientX, e.clientY);
      if (!hit) return;
      const zone = world.zones.find((z) => z.id === hit.zoneId) ?? zoneAt(hit.x, hit.y);
      if (zone) open(zone);
    },
    { signal }
  );

  /** Ease each zone's hover amount toward 1 (hovered / open) or 0 and apply it to the props and the ground. */
  function updateHover(dt: number) {
    for (const zone of world.zones) {
      const target = zone.id === hoveredId ? 1 : 0;
      const cur = lift.get(zone.id)!;
      const next = reduceMotion ? target : cur + (target - cur) * (1 - Math.exp(-dt * 10));
      const settled = Math.abs(target - next) < 0.002 ? target : next;
      if (settled !== cur) {
        lift.set(zone.id, settled);
        renderer.setHover(zone.id, settled);
      }
    }
  }

  function updateLabels() {
    world.zones.forEach((zone, i) => {
      const p = renderer.project(zone.scene.labelAt.x, zone.scene.labelHeight, zone.scene.labelAt.y);
      labels[i].style.transform = `translate(calc(${p.x}px - 50%), calc(${p.y}px - 100%))`;
      labels[i].classList.toggle("visible", !panel.isOpen && zone.id === hoveredId);
    });
  }

  let time = 0;
  let last = performance.now();
  let raf = 0;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    updateHover(dt);
    renderer.draw(time);
    updateLabels();
  }
  raf = requestAnimationFrame(frame);

  if (import.meta.env.DEV)
    Object.assign(window, {
      __game: {
        world,
        renderer,
        panel,
        open: (id: string) => {
          const z = world.zones.find((zz) => zz.id === id);
          if (z) open(z);
        },
        setHover: (id: string | null) => (hoveredId = id),
        // advance time and redraw without waiting for animation frames
        tick(seconds: number) {
          const steps = Math.max(1, Math.round(seconds * 60));
          for (let i = 0; i < steps; i++) {
            time += 1 / 60;
            updateHover(1 / 60);
            renderer.draw(time);
          }
          updateLabels();
        },
      },
    });

  banner?.classList.add("show");
  const bannerTimer = setTimeout(() => banner?.classList.remove("show"), 3200);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(bannerTimer);
    panel.destroy();
    abort.abort();
    renderer.dispose();
    labels.forEach((el) => el.remove());
    root.classList.remove("ready");
  };
}
