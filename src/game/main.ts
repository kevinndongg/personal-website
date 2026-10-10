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

  // Deep links use the URL hash (/play#ftc). A hash change is not a page navigation, so the router leaves the scene
  // alone, and the browser's Back button closes the panel again.
  let ownEntry = false; // we pushed the "#id" history entry ourselves (so closing can pop it)
  let syncing = false; // a close that came from the URL, which must not touch the URL again

  function zoneById(id: string): Zone | undefined {
    return id ? world.zones.find((z) => z.id === id) : undefined;
  }

  let openZone: Zone | null = null;
  let openSide: PanelSide = "right";

  /** The panel goes opposite the box (or becomes a bottom sheet on narrow screens). */
  function sideFor(zone: Zone): PanelSide {
    const a = zone.scene.area;
    const narrow = innerWidth < 760 || innerWidth < innerHeight * 0.9;
    return narrow ? "bottom" : a.x + a.w / 2 < mapSize / 2 ? "right" : "left";
  }

  function open(zone: Zone, fromUrl = false) {
    const side = sideFor(zone);
    openZone = zone;
    openSide = side;
    renderer.focus(zone.id, side, panel.coverage(side));
    panel.open(zone, side);
    hoveredId = zone.id;
    hint?.classList.add("gone");
    if (!fromUrl && location.hash.slice(1) !== zone.id) {
      ownEntry = true;
      location.hash = zone.id;
    }
  }

  panel.onClose = () => {
    renderer.focus(null);
    hoveredId = null;
    openZone = null;
    if (syncing || !location.hash) return;
    if (ownEntry) {
      ownEntry = false;
      history.back(); // pops the entry we pushed; the resulting hashchange finds the panel already closed
    } else {
      // opened straight from a shared link: just drop the hash, don't leave the site
      history.replaceState(history.state, "", location.pathname + location.search);
    }
  };

  addEventListener(
    "hashchange",
    () => {
      const zone = zoneById(location.hash.slice(1));
      if (zone) {
        if (!panel.isOpen || openZone !== zone) open(zone, true);
      } else if (panel.isOpen) {
        syncing = true;
        ownEntry = false;
        panel.close();
        syncing = false;
      }
    },
    { signal }
  );

  // keep the panel and the camera framing in step with the window (e.g. rotating a phone)
  addEventListener(
    "resize",
    () => {
      if (!openZone) return;
      if (sideFor(openZone) !== openSide) open(openZone, true);
      else renderer.focus(openZone.id, openSide, panel.coverage(openSide));
    },
    { signal }
  );

  // a shared link opens its panel right away (the camera eases in from the full map)
  const linked = zoneById(location.hash.slice(1));
  if (linked) open(linked, true);

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
