import { planDrive } from "./astar";
import { Car } from "./car";
import { Overlay } from "./overlay";
import { Renderer } from "./render";
import type { Marker } from "./render";
import { buildSprites } from "./sprites";
import { TILE, generateWorld, nearestReachable, rectContains } from "./world";
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
  const sprites = buildSprites(world.zones);
  const renderer = new Renderer(canvas, world, sprites);
  const car = new Car(world.start.x, world.start.y);
  const overlay = new Overlay(root.querySelector<HTMLElement>("[data-dialog]")!, signal);

  if (import.meta.env.DEV) Object.assign(window, { __game: { car, world } });

  const worldW = world.w * TILE;
  const worldH = world.h * TILE;
  let scale = 1; // world px -> css px
  let marker: Marker | null = null;
  let armed = true; // re-arms once the car leaves every pad, so closing a dialog doesn't instantly reopen it

  const labels = world.zones.map((zone) => {
    const el = document.createElement("div");
    el.className = "zone-label";
    el.textContent = zone.label;
    el.style.setProperty("--accent", zone.accent);
    labelsEl.append(el);
    return el;
  });

  canvas.width = worldW;
  canvas.height = worldH;

  function resize() {
    // the whole map is always visible: fit it to the window, centered
    scale = Math.min(innerWidth / worldW, innerHeight / worldH);
    const w = Math.floor(worldW * scale);
    const h = Math.floor(worldH * scale);
    const left = Math.floor((innerWidth - w) / 2);
    const top = Math.floor((innerHeight - h) / 2);
    for (const el of [canvas, labelsEl]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    scale = w / worldW;
    // UI (dialog, banner) keeps a chunky integer pixel size independent of the map scale
    const ui = Math.max(2, Math.min(Math.floor(innerHeight / 180), Math.floor(innerWidth / 200)));
    root.style.setProperty("--px", String(ui));
    root.style.setProperty("--ws", String(scale));
  }
  resize();
  addEventListener("resize", resize, { signal });
  root.classList.add("ready");

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (overlay.open || e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const wx = (e.clientX - rect.left) / scale;
      const wy = (e.clientY - rect.top) / scale;
      const goal = nearestReachable(world, Math.floor(wx / TILE), Math.floor(wy / TILE));
      if (!goal) return;
      const path = planDrive(world, { x: car.x, y: car.y }, goal);
      if (!path) return;
      car.drive(path);
      marker = { x: goal.x * TILE + TILE / 2, y: goal.y * TILE + TILE / 2 };
      hint?.classList.add("gone");
    },
    { signal }
  );

  function checkZones() {
    let inside: Zone | null = null;
    for (const zone of world.zones) {
      if (rectContains(zone.pad, car.x, car.y, 4)) inside = zone;
    }
    if (inside && armed) {
      armed = false;
      car.stop();
      marker = null;
      overlay.show(inside);
    } else if (!inside && !world.zones.some((z) => rectContains(z.pad, car.x, car.y, -6))) {
      armed = true;
    }
  }

  function updateLabels() {
    world.zones.forEach((zone, i) => {
      const x = zone.labelPos.x * scale;
      const y = zone.labelPos.y * scale;
      labels[i].style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 100%))`;
    });
  }

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let time = 0;

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
    labels.forEach((el) => el.remove());
    root.classList.remove("ready");
  };
}
