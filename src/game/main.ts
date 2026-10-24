import { navigate } from "astro:transitions/client";
import type { Intro } from "./intro";
import { Panel, openAction } from "./panel";
import type { PanelSide } from "./panel";
import { Renderer3D } from "./render3d";
import { filmRig } from "./scenery";
import type { MoveKey } from "./scenery";
import { TILE, generateWorld, rectContains } from "./world";
import type { Zone, ZoneInput } from "./world";

let sceneCount = 0; // dev only: how many times a scene has been started in this page

/** The next paint: a frame the viewer can see has been drawn (so a change made before it, to the loader, is on screen). */
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * The outline of a page torn out of a notebook, for a box `w` x `h` px, as a CSS polygon: every side ragged, and along the
 * left the half-holes the binding leaves. Seeded, so that a box of one size is torn the same way every time.
 */
function tornOutline(w: number, h: number): string {
  let seed = 7;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const JAG = 2.4; // how far a tear wanders in from the straight edge
  const STEP = 8;
  const pts: [number, number][] = [];
  for (let x = 0; x < w; x += STEP) pts.push([x, rand() * JAG]); // top, left to right
  for (let y = 0; y < h; y += STEP) pts.push([w - rand() * JAG, y]); // right, top to bottom
  for (let x = w; x > 0; x -= STEP) pts.push([x, h - rand() * JAG]); // bottom, right to left
  // left, bottom to top: a half-hole every PITCH px, torn ragged between them
  const PITCH = 24;
  const R = 4.5;
  for (let cy = h - PITCH / 2; cy > R + 3; cy -= PITCH) {
    pts.push([rand() * JAG, cy + R + 4]);
    for (let a = 0.5; a >= -0.5; a -= 0.25) pts.push([R * Math.cos(a * Math.PI) + 0.5, cy + R * Math.sin(a * Math.PI) * 1.0]);
  }
  pts.push([rand() * JAG, rand() * JAG]);
  return `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;
}

/**
 * Boots the scene inside `root`. Returns a teardown function. With a loader (`intro`) the scene is built behind it, and the
 * view is only handed over (a linked project) once the photos are on the GPU at their own resolution.
 */
export function startGame(root: HTMLElement, intro: Intro | null = null): () => void {
  const sceneId = ++sceneCount;
  if (import.meta.env.DEV) console.info(`[game] scene #${sceneId} started`);
  const canvas = root.querySelector<HTMLCanvasElement>("[data-canvas]")!;
  const labelsEl = root.querySelector<HTMLElement>("[data-labels]")!;
  const hint = root.querySelector<HTMLElement>("[data-hint]");
  const abort = new AbortController();
  const { signal } = abort;

  const inputs: ZoneInput[] = JSON.parse(root.dataset.zones ?? "[]");
  const world = generateWorld(inputs);
  const renderer = new Renderer3D(canvas, world);
  const backdrop = root.querySelector<HTMLElement>("[data-backdrop]")!;
  const panel = new Panel(root.querySelector<HTMLElement>("[data-panel]")!, backdrop, signal);
  // with a project open the backdrop lies over the scene, but the car behind it can still be clicked
  panel.onBackdropPress = (e) => {
    const hit = renderer.pick(e.clientX, e.clientY);
    return hit?.propId === "formula" && !!hit.zoneId && renderer.driveCar(hit.zoneId);
  };
  backdrop.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      const onCar = renderer.pick(e.clientX, e.clientY)?.propId === "formula";
      backdrop.style.cursor = onCar ? "pointer" : "";
      renderer.hoverCar(onCar);
    },
    { signal }
  );
  backdrop.addEventListener("pointerleave", () => renderer.hoverCar(false), { signal });
  const mapSize = world.w * TILE;

  let hoveredId: string | null = null; // project box under the pointer
  const lift = new Map<string, number>(world.zones.map((z) => [z.id, 0]));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const labels = world.zones.map((zone) => {
    const el = document.createElement("div");
    el.className = "zone-label";
    el.textContent = zone.label;
    labelsEl.append(el);
    return el;
  });

  const galleryZone = world.zones.find((z) => z.kind === "gallery");
  let swipe: { id: number; x: number; y: number } | null = null; // a touch that began while zoomed into a photo
  let lastStuck = 0; // how many strokes had hit the end of the roll when the arrows were last looked at
  // the viewer has used a control, a photo or a key: the offer (the lever turning the page by itself, and the glow) is
  // done, for this visit
  let used = false;
  // announces the photo that is up, for screen readers (its title and place are not drawn anywhere in the scene)
  const live = root.querySelector<HTMLElement>("[data-live]");

  // Previous / next arrows at the left and right edges of the screen while zoomed into a photo (the camera and its controls
  // are off screen then). The right one goes to the next photo and the left one to the one before, in the order the photos
  // have on the table; at the first or last photo the one that would go past it is dimmed.
  const photoArrows = galleryZone
    ? ([-1, 1] as const).map((direction) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `edge-arrow ${direction < 0 ? "left" : "right"}`;
        el.setAttribute("aria-label", direction < 0 ? "Previous photo" : "Next photo");
        el.innerHTML = `<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path d="${
          direction < 0 ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"
        }" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path></svg>`;
        el.addEventListener("click", () => wind(direction), { signal });
        root.append(el);
        return { direction, el };
      })
    : [];

  // "Pick an area to look inside" is a torn page that stands to the left of the racing area, or above it on a narrow screen (or
  // one with no room beside it), with an arrow drawn toward the area. Placed whenever the window changes: the camera is at its
  // resting view then, and the hint is gone before it moves.
  const racing = world.zones.find((z) => z.variant === "garage");
  const paper = hint?.querySelector<HTMLElement>("[data-hint-paper]");
  function placeHint() {
    if (!hint || !racing) return; // (without a racing area the hint keeps its place at the top left)
    const a = racing.scene.area;
    const left = renderer.project(a.x, 0, a.y + a.h / 2);
    const top = renderer.project(a.x + a.w / 2, 0, a.y);
    const GAP = 8; // from the arrow's tip to the area
    const narrow = innerWidth < 760 || innerWidth < innerHeight * 0.9;
    const room = left.x - 16 - GAP;
    const above = narrow || room < 160;
    hint.style.maxWidth = above ? "" : `${room}px`;
    hint.classList.toggle("above", above);
    if (paper) paper.style.clipPath = tornOutline(paper.offsetWidth, paper.offsetHeight); // (its size is after any wrapping)
    const w = hint.offsetWidth;
    const h = hint.offsetHeight;
    let x: number;
    let y: number;
    if (above) {
      x = Math.min(Math.max(16, top.x - w / 2), innerWidth - 16 - w);
      y = Math.max(16, top.y - GAP - h);
      hint.style.setProperty("--ax", `${Math.min(Math.max(top.x - x, 24), w - 24)}px`);
    } else {
      x = left.x - GAP - w;
      y = left.y - h / 2;
    }
    hint.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  // the handwriting is not the same size as the font it stands in for until it has arrived: place the note again then
  void document.fonts?.load("600 22px Caveat").then(() => {
    if (!signal.aborted) placeHint();
  });

  /** The scene is on: the glow starts to pulse and the note is tossed down beside it. */
  function invite() {
    renderer.setInvite(true);
    hint?.classList.add("shown");
  }

  function resize() {
    renderer.resize(innerWidth, innerHeight);
    placeHint();
  }
  resize();
  addEventListener("resize", resize, { signal });
  root.classList.add("ready");

  function zoneAt(x: number, y: number): Zone | null {
    return world.zones.find((z) => rectContains(z.scene.area, x, y)) ?? null;
  }

  // Deep links use the URL hash (/#ftc), and the browser's Back button closes the panel again.
  //
  // The "#id" entry has to be pushed through Astro's router (`navigate`), not by assigning `location.hash`. The router
  // keeps its own idea of where the page is: if it was never told about "#id", then going back from it looks like a
  // visit to / from /, so it re-fetches the page and swaps it in. That rebuilt the whole scene, and closing a
  // project cut the zoom out off instead of easing it. (Keeping the router's popstate handler from running did not hold
  // up.) Told about the hash, the router treats going back from "#id" as the same-page move it is and does nothing.
  let ownEntry = false; // we pushed the "#id" history entry ourselves (so closing can pop it)
  let syncing = false; // a close that came from the URL, which must not touch the URL again

  function zoneById(id: string): Zone | undefined {
    return id ? world.zones.find((z) => z.id === id) : undefined;
  }

  let openZone: Zone | null = null;
  let zoomKey = ""; // what the view was last told to frame: the page, or one photo
  let openSide: PanelSide = "right";

  /** The panel goes opposite the box (or becomes a bottom sheet on narrow screens). */
  function sideFor(zone: Zone): PanelSide {
    // the photography page is the scene itself: just a caption bar under it
    if (zone.kind === "gallery") return "bottom";
    const a = zone.scene.area;
    const narrow = innerWidth < 760 || innerWidth < innerHeight * 0.9;
    return narrow ? "bottom" : a.x + a.w / 2 < mapSize / 2 ? "right" : "left";
  }

  // say which photo is up whenever it changes (only while that zone is the one open: the panel is shared)
  for (const zone of world.zones) {
    if (zone.kind !== "gallery") continue;
    filmRig(zone).onFrame = (index) => {
      const p = zone.photos?.[index];
      if (live && p && openZone === zone) {
        const place = p.location ? `, ${p.location}` : "";
        live.textContent = `${p.title}${place} (photo ${index + 1} of ${zone.photos!.length})`;
      }
    };
  }

  function open(zone: Zone, fromUrl = false) {
    if (zone.kind === "link") return; // a button on the ground opens its link when pressed, never a card
    const side = sideFor(zone);
    // the gallery is a roll with a start and an end: opening it begins at the start (a turn of the window, which opens it
    // again, does not)
    if (zone.kind === "gallery" && !(panel.isOpen && openZone === zone)) filmRig(zone).reset();
    openZone = zone;
    openSide = side;
    renderer.focus(zone.id, side, panel.coverage(side, zone));
    zoomKey = ""; // `focus` frames the whole project: say again where the view should be zoomed to, if anywhere
    panel.open(zone, side);
    hoveredId = zone.id;
    hint?.classList.add("gone");
    renderer.setInvite(false);
    if (!fromUrl && location.hash.slice(1) !== zone.id) {
      ownEntry = true;
      void navigate(`#${zone.id}`);
    }
  }

  panel.onClose = () => {
    if (import.meta.env.DEV) watch = { t0: performance.now(), rows: [] };
    if (openZone?.kind === "gallery") {
      const rig = filmRig(openZone);
      rig.hint = null;
      rig.hoverIndex = null;
      rig.zoomOut(); // it opens at the page next time, not zoomed into the photo it was closed on
    }
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
      else {
        renderer.focus(openZone.id, openSide, panel.coverage(openSide, openZone));
        zoomKey = ""; // and zoom back into the photo, if that is where the view was
      }
    },
    { signal }
  );

  // a shared link opens its panel right away (the camera eases in from the full map)
  // (behind the loader it waits for the reveal, so the camera is seen easing in)
  const linked = zoneById(location.hash.slice(1));
  if (linked && !intro) open(linked, true);

  type Hit = { zoneId?: string; propId?: string; partId?: string; slot?: number } | null;

  /**
   * The photography page leaves the scene clickable. Looking at the page: the camera's controls change the page (the
   * rewind knob back, the lever on, the shutter button zooms in; the rest of the camera does nothing), and a click on a photo zooms
   * the view into it. Zoomed in, a click anywhere zooms back out. Those are the only things on it that are not "click
   * anywhere to go back"; everywhere else behaves as on the other projects (zoom-out cursor, click to close).
   */
  function onCamera(hit: Hit) {
    return !!openZone && hit?.zoneId === openZone.id && hit.propId === "omcamera";
  }

  /** Which of the camera's controls a hit landed on (the lever, the rewind knob, the shutter button), or null: the body is not one. */
  function control(hit: Hit): "lever" | "rewind" | "shutter" | null {
    if (!onCamera(hit)) return null;
    return hit?.partId === "lever" || hit?.partId === "rewind" || hit?.partId === "shutter" ? hit.partId : null;
  }

  /** The photo of the page that a hit landed on, or null (the film between photos, an empty slot, anything else). */
  function photoUnder(hit: Hit): number | null {
    if (!openZone || hit?.zoneId !== openZone.id || hit.partId !== "slot" || hit.slot === undefined) return null;
    const i = filmRig(openZone).photoAt(hit.slot);
    return i >= 0 ? i : null;
  }

  /** The film on the table (its photos, and the film between them): clicking it is not "go back". */
  function onFilm(hit: Hit) {
    return !!openZone && hit?.zoneId === openZone.id && (hit.partId === "film" || hit.partId === "slot");
  }

  /** Moves the open photography page on (1) or back (-1): a page at a time, or a photo at a time while zoomed in. */
  function wind(direction: 1 | -1) {
    if (panel.isOpen && openZone?.kind === "gallery") {
      used = true;
      filmRig(openZone).queue(direction);
    }
  }

  /** The shutter button: zoom into the current photo, or back out to the page. */
  function zoomToggle() {
    if (panel.isOpen && openZone?.kind === "gallery") {
      used = true;
      filmRig(openZone).toggleZoom();
    }
  }

  /** Tell the camera which of its controls the pointer is over, and the table which photo, so they can light up. */
  function lightControl(hit: Hit) {
    if (openZone?.kind !== "gallery") return;
    const rig = filmRig(openZone);
    rig.hint = control(hit);
    rig.hoverIndex = photoUnder(hit);
  }

  /**
   * Keeps the view where the photography page says it should be: framing the whole project looking at the page, or
   * framing one photo's place on the table, which it eases to (so stepping to the next photo is a pan along the table).
   */
  function syncZoom() {
    if (!panel.isOpen || openZone?.kind !== "gallery") return;
    const rig = filmRig(openZone);
    const key = rig.mode === "photo" ? `photo:${rig.index}` : "page";
    if (key === zoomKey) return;
    zoomKey = key;
    if (rig.mode === "photo") {
      const corners = rig.photoCorners?.(rig.index);
      renderer.focusPoints(openZone.id, corners ?? null, 0.95);
    } else renderer.focusPoints(openZone.id, null);
  }

  // Esc zooms back out first; a second one closes the project
  panel.beforeEscape = () => {
    if (openZone?.kind !== "gallery") return false;
    const rig = filmRig(openZone);
    if (rig.mode !== "photo") return false;
    rig.zoomOut();
    return true;
  };

  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      if (panel.isOpen) {
        if (openZone?.kind === "gallery") {
          const hit = renderer.pick(e.clientX, e.clientY);
          lightControl(hit);
          const zoomed = filmRig(openZone).mode === "photo";
          canvas.style.cursor = zoomed
            ? "zoom-out"
            : control(hit) || photoUnder(hit) !== null
              ? "pointer"
              : onFilm(hit) || onCamera(hit)
                ? "default"
                : "zoom-out";
        }
        return;
      }
      const hit = renderer.pick(e.clientX, e.clientY);
      hoveredId = hit ? (zoneAt(hit.x, hit.y)?.id ?? null) : null;
      canvas.style.cursor = hoveredId ? "pointer" : "default";
      renderer.hoverCar(hit?.propId === "formula");
    },
    { signal }
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      renderer.hoverCar(false);
      if (!panel.isOpen) hoveredId = null;
      else lightControl(null);
    },
    { signal }
  );
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (panel.isOpen) {
        // other cards sit behind a backdrop that closes on any click; the photography page has none (so the camera and
        // the photos can be clicked) and does the same by hand
        if (openZone?.kind !== "gallery") return;
        const rig = filmRig(openZone);
        if (rig.mode === "photo") {
          if (e.pointerType === "mouse") {
            rig.zoomOut(); // zoomed into a photo, a click anywhere goes back to the page
          } else {
            // touch and pen: a swipe moves on to the next photo, a tap goes back to the page (told apart when the
            // finger lifts)
            swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
            canvas.setPointerCapture?.(e.pointerId);
          }
          return;
        }
        const hit = renderer.pick(e.clientX, e.clientY);
        const photo = photoUnder(hit);
        const pressed = control(hit);
        if (pressed) {
          if (pressed === "shutter") zoomToggle();
          else wind(pressed === "rewind" ? -1 : 1);
        } else if (photo !== null) {
          used = true;
          rig.zoomIn(photo);
        } else if (!onFilm(hit) && !onCamera(hit)) panel.close(); // (the film between the photos, and the camera's body, do nothing)
        return;
      }
      const hit = renderer.pick(e.clientX, e.clientY);
      if (!hit) return;
      if (hit.propId === "formula" && hit.zoneId && renderer.driveCar(hit.zoneId)) return; // the parked car drives instead
      const zone = world.zones.find((z) => z.id === hit.zoneId) ?? zoneAt(hit.x, hit.y);
      if (zone) open(zone);
    },
    { signal }
  );

  // The toast: a line that says what a button just did.
  const toast = document.createElement("p");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  root.append(toast);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function say(text: string) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  /**
   * Opens a contact link. A mailto: goes nowhere on a computer with no mail app registered, and the page cannot tell, so it
   * also copies the address and says so: the visitor has it either way.
   */
  function followLink(label: string, href: string) {
    const mail = href.startsWith("mailto:");
    openAction({ label, href, external: !mail });
    if (!mail) return;
    const address = decodeURIComponent(href.slice("mailto:".length).split("?")[0]);
    navigator.clipboard?.writeText(address).then(
      () => say(`Copied ${address}`),
      () => say(address)
    ) ?? say(address);
  }

  // A contact button opens its link on the click (not the press, which browsers do not always count as a user's go-ahead
  // for a new tab). A tap on a touch screen is a click too: there is no hover step.
  canvas.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || panel.isOpen) return;
      const hit = renderer.pick(e.clientX, e.clientY);
      const zone = hit ? zoneAt(hit.x, hit.y) : null;
      if (zone?.kind !== "link" || !zone.href) return;
      followLink(zone.label, zone.href);
    },
    { signal }
  );

  // A swipe, zoomed into a photo, does what the arrow keys do (the photo is dragged along: swiping left shows the one to
  // the right). A short touch is a tap, which goes back to the page.
  const SWIPE_PX = 40;
  canvas.addEventListener(
    "pointerup",
    (e) => {
      const s = swipe;
      if (!s || e.pointerId !== s.id) return;
      swipe = null;
      if (!panel.isOpen || openZone?.kind !== "gallery") return;
      const rig = filmRig(openZone);
      if (rig.mode !== "photo") return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) {
        rig.zoomOut();
        return;
      }
      used = true;
      if (Math.abs(dx) >= Math.abs(dy)) rig.move(dx < 0 ? "right" : "left");
      else rig.move(dy < 0 ? "down" : "up");
    },
    { signal }
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      swipe = null;
    },
    { signal }
  );

  // keyboard, while the photography page is open. Looking at the page, any arrow key turns it (left and up back, right and
  // down forward). Zoomed in, the arrows move to the photo next to this one in that direction on the table, and turn the
  // page at its edge. Enter zooms in (to the photo last looked at, the first of the page after a turn) or
  // out, unless something else, like the link, has the focus and wants Enter.
  const ARROWS: Record<string, MoveKey> = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };
  addEventListener(
    "keydown",
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!panel.isOpen || openZone?.kind !== "gallery") return;
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        const rig = filmRig(openZone);
        used = true;
        if (rig.mode === "photo") rig.move(arrow);
        else wind(arrow === "right" || arrow === "down" ? 1 : -1);
      } else if (e.key === "Enter" && (document.activeElement === document.body || document.activeElement === canvas)) {
        e.preventDefault();
        zoomToggle();
      }
    },
    { signal }
  );

  // mouse wheel / trackpad over the scene: scrolling down winds on, up winds back. A trackpad sends a long stream of small
  // events and keeps going after the fingers lift, so one scroll gesture (events with no pause longer than a fifth of a
  // second between them) makes one stroke, however long it lasts. Scroll, pause, scroll to go further.
  let wheelSum = 0;
  let wheelLast = 0;
  let wheelArmed = true;
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!panel.isOpen || openZone?.kind !== "gallery") return;
      const now = performance.now();
      if (now - wheelLast > 200) {
        wheelSum = 0;
        wheelArmed = true;
      }
      wheelLast = now;
      wheelSum += e.deltaY * (e.deltaMode === 1 ? 16 : 1); // lines to pixels
      if (wheelArmed && Math.abs(wheelSum) >= 30) {
        wheelArmed = false;
        wind(wheelSum > 0 ? 1 : -1);
      }
    },
    { signal, passive: true }
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
      // (a link slab has no name pill, and neither has the name itself: it would only say the name again over the lettering)
      const show = !panel.isOpen && zone.id === hoveredId && zone.kind !== "link" && zone.kind !== "about";
      // a label only needs placing while it is showing or fading out (placing asks the page for the canvas's size,
      // which makes the browser do layout work, and this runs for every project on every frame)
      if (show || labels[i].classList.contains("visible")) {
        const p = renderer.project(zone.scene.labelAt.x, zone.scene.labelHeight, zone.scene.labelAt.y);
        labels[i].style.transform = `translate(calc(${p.x}px - 50%), calc(${p.y}px - 100%))`;
      }
      labels[i].classList.toggle("visible", show);
    });

    if (galleryZone) {
      const rig = filmRig(galleryZone);
      const open = panel.isOpen && openZone === galleryZone;
      // While the page is up (not zoomed into a photo) and nothing has been used yet, the camera offers itself: the lever
      // turns the page by itself and the lever and knob glow in turn (the camera model does that).
      rig.invite = open && rig.mode === "page" && !used;
      rig.used = used;
      // the photo arrows are there while zoomed into a photo; one that cannot go on is dimmed, and nudges when tried
      const zoomed = open && rig.mode === "photo";
      const stuck = rig.stuckCount !== lastStuck;
      lastStuck = rig.stuckCount;
      for (const a of photoArrows) {
        a.el.classList.toggle("visible", zoomed);
        const end = !rig.canStep(a.direction);
        a.el.classList.toggle("end", end);
        a.el.setAttribute("aria-disabled", String(end));
        if (stuck && zoomed && a.direction === rig.dir) {
          a.el.classList.remove("bump");
          void a.el.offsetWidth; // (so the animation can run again)
          a.el.classList.add("bump");
        }
      }
    }
  }

  let time = 0;
  let last = performance.now();
  let raf = 0;
  // Time moves on by at most this much per frame. The camera and the zoom ease toward their targets a fixed fraction of
  // the remaining distance per second, so a frame that arrives late would otherwise cover a big part of what is left in
  // one step (a 100 ms frame is nearly half of it): the zoom out of a project is heavy to draw halfway, and it showed up as
  // smooth, then a jump near the end. Capped like this a slow stretch just plays slower instead.
  const MAX_STEP = 1 / 30;

  // dev only: after a project is closed, what the zoom did frame by frame, to find stalls and jumps (`__game.lastClose()`)
  const gaps: number[] = []; // milliseconds between frames, newest last
  let watch: { t0: number; rows: number[][] } | null = null;
  let lastClose: number[][] = [];
  const WATCH_MS = 3000;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const gap = now - last;
    const dt = Math.min(MAX_STEP, gap / 1000);
    last = now;
    time += dt;
    updateHover(dt);
    syncZoom();
    renderer.draw(time);
    if (hint && !hint.classList.contains("gone")) hint.style.setProperty("--pulse", renderer.invitePulse.toFixed(3)); // (the note breathes with the glow)
    updateLabels();
    if (import.meta.env.DEV) {
      gaps.push(gap);
      if (gaps.length > 300) gaps.shift();
      if (watch) {
        const v = renderer.debugView();
        // [ms since the close, frame gap ms, view.wpp, view.left, view.top, map scale, dim amount]
        watch.rows.push([now - watch.t0, gap, v.wpp, v.left, v.top, v.mapScale, v.focus]);
        if (now - watch.t0 > WATCH_MS) {
          lastClose = watch.rows;
          watch = null;
        }
      }
    }
  }
  // Behind a loading screen nothing is drawn each frame until it is gone: a render loop of the whole world (shadows, an
  // MSAA target and a post pass) behind an opaque overlay is work the viewer cannot see, and it competes with the overlay
  // for the main thread and the GPU, which shows as the loader's own jitter. The warm-up below draws what is needed once.
  if (!intro) raf = requestAnimationFrame(frame);

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
        /** The last ~300 gaps between frames (ms), and the worst few. */
        frames: () => ({ gaps: [...gaps], worst: [...gaps].sort((a, b) => b - a).slice(0, 6).map((g) => Math.round(g)) }),
        /**
         * What the 3 seconds after the last project close looked like, frame by frame. Close a project, wait a few
         * seconds, then run this. `lastClose()` is a summary; `lastClose(true)` also has every frame.
         */
        lastClose: (rows = false) => {
          // the recording that is still running (a close less than 3 seconds ago), else the last finished one
          const r = watch && watch.rows.length > 1 ? watch.rows : lastClose;
          if (r.length < 2) return `no close recorded in scene #${sceneId} yet (close a project in this scene first)`;
          const biggest = (col: number, relative: boolean) =>
            r
              .slice(1)
              .map((row, j) => {
                const d = Math.abs(row[col] - r[j][col]);
                return { atMs: Math.round(row[0]), step: +(relative ? d / (Math.abs(r[j][col]) || 1) : d).toFixed(4) };
              })
              .sort((a, b) => b.step - a.step)
              .slice(0, 4);
          return {
            scene: sceneId,
            frames: r.length,
            spanMs: Math.round(r[r.length - 1][0]),
            longestFrameMs: Math.round(Math.max(...r.map((x) => x[1]))),
            // biggest single-frame change in each number that drives the zoom, with when it happened (ms after the close)
            wppStepRelative: biggest(2, true),
            leftStep: biggest(3, false),
            topStep: biggest(4, false),
            mapScaleStep: biggest(5, false),
            dimStep: biggest(6, false),
            ...(rows ? { rows: r.map((x) => x.map((n) => +n.toFixed(3))) } : {}),
          };
        },
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

  if (!intro) {
    if (!linked) invite();
  } else {
    // The loader is up and the scene is built behind it. What it waits for: the photos of the first two pages on the GPU at
    // their own resolution (the table makes those lazily otherwise: on first hover), and the shaders compiled, so that
    // what it reveals is finished and the first thing the viewer does is not a stall.
    const rig = galleryZone ? filmRig(galleryZone) : null;
    const prepare = async () => {
      intro.stage("scene", 1);
      await nextPaint(); // (so the loading screen has shown where it is before anything that blocks)
      await rig?.warmUp?.(
        (texture) => renderer.upload(texture),
        (done, total) => intro.stage("gpu", 0.7 * (done / total))
      );
      intro.stage("gpu", 0.7);
      await renderer.warm();
      intro.stage("gpu", 1);
      await nextPaint();
    };
    void (async () => {
      try {
        await Promise.race([prepare(), intro.timeout]);
      } catch (error) {
        console.error(error); // show the scene anyway: it works, it is just not fully warmed
      }
      if (signal.aborted) return;
      await intro.finish();
      if (signal.aborted) return;
      // the world is on from here: its render loop starts (its clock from now, not from when it was built)
      last = performance.now();
      raf = requestAnimationFrame(frame);
      if (linked) open(linked, true);
      else invite();
    })();
  }

  return () => {
    if (import.meta.env.DEV) console.info(`[game] scene #${sceneId} stopped`);
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    toast.remove();
    intro?.cancel();
    for (const zone of world.zones) if (zone.kind === "gallery") filmRig(zone).onFrame = undefined;
    panel.destroy();
    abort.abort();
    renderer.dispose();
    labels.forEach((el) => el.remove());
    root.classList.remove("ready");
  };
}
