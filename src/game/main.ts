import { planDrive } from "./astar";
import { Car } from "./car";
import { Overlay } from "./overlay";
import { Renderer3D } from "./render3d";
import type { Marker } from "./render3d";
import { generateWorld, nearestReachable, rectContains } from "./world";
import type { Zone, ZoneInput } from "./world";

const STEP = 1 / 60;

/** Boots the game inside `root`. Returns a teardown function. */
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
  const car = new Car(world.start.x, world.start.y);
  const overlay = new Overlay(root.querySelector<HTMLElement>("[data-dialog]")!, signal);

  let marker: Marker | null = null;
  let hoveredId: string | null = null; // project box under the pointer
  let pinnedId: string | null = null; // the project whose dialogue is open
  const lift = new Map<string, number>(world.zones.map((z) => [z.id, 0]));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let armed = true; // re-arms once the car leaves every stop, so closing a dialog doesn't instantly reopen it

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
    // UI (dialog, banner) keeps a chunky integer pixel size independent of the 3D view
    const ui = Math.max(2, Math.min(Math.floor(innerHeight / 180), Math.floor(innerWidth / 200)));
    root.style.setProperty("--px", String(ui));
    root.style.setProperty("--ws", "2.2");
  }
  resize();
  addEventListener("resize", resize, { signal });
  root.classList.add("ready");

  function zoneAt(x: number, y: number): string | null {
    return world.zones.find((z) => rectContains(z.scene.area, x, y))?.id ?? null;
  }

  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      const hit = renderer.pick(e.clientX, e.clientY);
      hoveredId = hit ? zoneAt(hit.x, hit.y) : null;
    },
    { signal }
  );
  canvas.addEventListener("pointerleave", () => (hoveredId = null), { signal });
  overlay.onClose = () => (pinnedId = null);

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (overlay.open || e.button !== 0) return;
      const hit = renderer.pick(e.clientX, e.clientY);
      if (!hit) return;
      if (e.pointerType === "touch") hoveredId = zoneAt(hit.x, hit.y); // no hover on touch: a tap selects the box
      // clicking anywhere in a project area (or on its models) drives to that area's stop (the garage)
      const zone =
        world.zones.find((z) => z.id === hit.zoneId) ?? world.zones.find((z) => rectContains(z.scene.area, hit.x, hit.y));
      const target = zone?.scene.stop ?? hit;
      const goal = nearestReachable(world, target.x, target.y);
      if (!goal) return;
      const path = planDrive(world, { x: car.x, y: car.y }, goal);
      if (!path) return;
      car.drive(path);
      marker = { x: goal.x, y: goal.y };
      hint?.classList.add("gone");
    },
    { signal }
  );

  function checkZones() {
    let inside: Zone | null = null;
    for (const zone of world.zones) {
      if (rectContains(zone.scene.trigger, car.x, car.y)) inside = zone;
    }
    if (inside && armed) {
      armed = false;
      car.stop();
      marker = null;
      pinnedId = inside.id;
      overlay.show(inside);
    } else if (!inside && !world.zones.some((z) => rectContains(z.scene.trigger, car.x, car.y, -20))) {
      armed = true;
    }
  }

  /** Ease each zone's hover amount toward 1 (hovered / open) or 0 and apply it (props lift, ground brightens). Only zones whose value changed are touched, so cost doesn't grow with the number of projects. */
  function updateHover(dt: number) {
    const active = pinnedId ?? hoveredId;
    for (const zone of world.zones) {
      const target = zone.id === active ? 1 : 0;
      const cur = lift.get(zone.id)!;
      const next = reduceMotion ? target : cur + (target - cur) * (1 - Math.exp(-dt * 12));
      const settled = Math.abs(target - next) < 0.002 ? target : next;
      if (settled !== cur) {
        lift.set(zone.id, settled);
        renderer.setHover(zone.id, settled);
      }
    }
  }

  function updateLabels() {
    const active = pinnedId ?? hoveredId;
    world.zones.forEach((zone, i) => {
      labels[i].classList.toggle("visible", zone.id === active);
      const p = renderer.project(zone.scene.labelAt.x, zone.scene.labelHeight, zone.scene.labelAt.y);
      labels[i].style.transform = `translate(calc(${p.x}px - 50%), calc(${p.y}px - 100%))`;
    });
  }

  let time = 0;

  if (import.meta.env.DEV)
    Object.assign(window, {
      __game: {
        car,
        world,
        renderer,
        setHover(id: string | null) {
          hoveredId = id;
        },
        // advance the simulation and redraw without waiting for animation frames
        tick(n: number) {
          for (let i = 0; i < n && !overlay.open; i++) {
            car.update(STEP);
            time += STEP;
            checkZones();
          }
          updateHover(Math.max(n, 1) * STEP);
          renderer.draw(car, marker, time);
          updateLabels();
        },
      },
    });

  let raf = 0;
  let last = performance.now();
  let acc = 0;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      acc -= STEP;
      time += STEP;
      if (!overlay.open) {
        car.update(STEP);
        if (marker && !car.moving) marker = null;
        checkZones();
      }
      updateHover(STEP);
    }
    renderer.draw(car, marker, time);
    updateLabels();
  }
  raf = requestAnimationFrame(frame);

  banner?.classList.add("show");
  const bannerTimer = setTimeout(() => banner?.classList.remove("show"), 3200);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(bannerTimer);
    overlay.destroy();
    abort.abort();
    renderer.dispose();
    labels.forEach((el) => el.remove());
    root.classList.remove("ready");
  };
}
