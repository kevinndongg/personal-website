import { navigate } from "astro:transitions/client";
import { Panel } from "./panel";
import type { PanelSide } from "./panel";
import { Renderer3D } from "./render3d";
import { filmRig } from "./scenery";
import { TILE, generateWorld, rectContains } from "./world";
import type { Zone, ZoneInput } from "./world";

let sceneCount = 0; // dev only: how many times a scene has been started in this page

/** Boots the scene inside `root`. Returns a teardown function. */
export function startGame(root: HTMLElement): () => void {
  const sceneId = ++sceneCount;
  if (import.meta.env.DEV) console.info(`[game] scene #${sceneId} started`);
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

  // Labels hung on the camera's controls while the photography page is open. They say what each control does, and they
  // are buttons too, so a label is as good a place to click as the control it names.
  const galleryZone = world.zones.find((z) => z.kind === "gallery");
  const controlLabels = galleryZone
    ? [
        { key: "lever" as const, title: "Next page", sub: "advance lever", act: () => wind(1) },
        { key: "rewind" as const, title: "Previous page", sub: "rewind knob", act: () => wind(-1) },
        // the shutter button zooms the view into the selected photo (it is only on screen while looking at the page)
        { key: "shutter" as const, title: "Zoom in", sub: "shutter button", act: () => zoomToggle() },
      ].map((c) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "control-label";
        el.setAttribute("aria-label", `${c.title} (${c.sub})`);
        const title = document.createElement("b");
        title.textContent = c.title;
        const sub = document.createElement("span");
        sub.textContent = c.sub;
        el.append(title, sub);
        el.addEventListener("click", c.act, { signal });
        labelsEl.append(el);
        return { ...c, el, titleEl: title };
      })
    : [];
  // announces the photo that is up, for screen readers (its title and place are printed on the film in the scene)
  const live = root.querySelector<HTMLElement>("[data-live]");

  // Previous / next buttons at the left and right edges of the screen while the photography page is open. Zoomed into a
  // photo the camera, with its labelled controls, is off screen, so these (and the arrow keys and the wheel) are how you
  // move on. They do what the lever and knob do: a page at a time, or a photo at a time while zoomed in.
  const edgeArrows = galleryZone
    ? ([-1, 1] as const).map((direction) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `edge-arrow ${direction < 0 ? "left" : "right"}`;
        el.innerHTML = `<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path d="${
          direction < 0 ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"
        }" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path></svg>`;
        el.addEventListener("click", () => wind(direction), { signal });
        root.append(el);
        return { direction, el };
      })
    : [];

  function resize() {
    renderer.resize(innerWidth, innerHeight);
  }
  resize();
  addEventListener("resize", resize, { signal });
  root.classList.add("ready");

  function zoneAt(x: number, y: number): Zone | null {
    return world.zones.find((z) => rectContains(z.scene.area, x, y)) ?? null;
  }

  // Deep links use the URL hash (/play#ftc), and the browser's Back button closes the panel again.
  //
  // The "#id" entry has to be pushed through Astro's router (`navigate`), not by assigning `location.hash`. The router
  // keeps its own idea of where the page is: if it was never told about "#id", then going back from it looks like a
  // visit to /play from /play, so it re-fetches the page and swaps it in. That rebuilt the whole scene, and closing a
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
    const side = sideFor(zone);
    openZone = zone;
    openSide = side;
    renderer.focus(zone.id, side, panel.coverage(side, zone));
    zoomKey = ""; // `focus` frames the whole project: say again where the view should be zoomed to, if anywhere
    panel.open(zone, side);
    hoveredId = zone.id;
    hint?.classList.add("gone");
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
  const linked = zoneById(location.hash.slice(1));
  if (linked) open(linked, true);

  type Hit = { zoneId?: string; propId?: string; partId?: string; slot?: number } | null;

  /**
   * The photography page leaves the scene clickable. Looking at the page: the camera's controls change the page (the
   * rewind knob back, the lever and the rest of the camera on, the shutter button zooms in), and a click on a photo zooms
   * the view into it. Zoomed in, a click anywhere zooms back out. Those are the only things on it that are not "click
   * anywhere to go back"; everywhere else behaves as on the other projects (zoom-out cursor, click to close).
   */
  function onCamera(hit: Hit) {
    return !!openZone && hit?.zoneId === openZone.id && hit.propId === "omcamera";
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
    if (panel.isOpen && openZone?.kind === "gallery") filmRig(openZone).queue(direction);
  }

  /** The shutter button: zoom into the selected photo, or back out to the page. */
  function zoomToggle() {
    if (panel.isOpen && openZone?.kind === "gallery") filmRig(openZone).toggleZoom();
  }

  /** Tell the camera which of its controls the pointer is over, and the table which photo, so they can light up. */
  function lightControl(hit: Hit) {
    if (openZone?.kind !== "gallery") return;
    const rig = filmRig(openZone);
    rig.hint = onCamera(hit) ? (hit?.partId === "rewind" ? "rewind" : hit?.partId === "shutter" ? "shutter" : "lever") : null;
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
            : onCamera(hit) || photoUnder(hit) !== null
              ? "pointer"
              : onFilm(hit)
                ? "default"
                : "zoom-out";
        }
        return;
      }
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
          rig.zoomOut(); // zoomed into a photo, a click anywhere goes back to the page
          return;
        }
        const hit = renderer.pick(e.clientX, e.clientY);
        const photo = photoUnder(hit);
        if (onCamera(hit)) {
          if (hit?.partId === "shutter") zoomToggle();
          else wind(hit?.partId === "rewind" ? -1 : 1);
        } else if (photo !== null) rig.zoomIn(photo);
        else if (!onFilm(hit)) panel.close(); // (the film between the photos does nothing)
        return;
      }
      const hit = renderer.pick(e.clientX, e.clientY);
      if (!hit) return;
      const zone = world.zones.find((z) => z.id === hit.zoneId) ?? zoneAt(hit.x, hit.y);
      if (zone) open(zone);
    },
    { signal }
  );

  // keyboard, while the photography page is open: left and right arrows flip the page (or, zoomed in, step to the next
  // photo), Enter zooms in or out (unless something else, like the link, has the focus and wants Enter)
  addEventListener(
    "keydown",
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!panel.isOpen || openZone?.kind !== "gallery") return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        wind(e.key === "ArrowRight" ? 1 : -1);
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
      const show = !panel.isOpen && zone.id === hoveredId;
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
      // the camera's control labels follow the controls (the camera moves while the project opens and closes), and are
      // there while looking at the page: zoomed into a photo the camera is off screen
      const showing = open && rig.mode === "page";
      for (const c of controlLabels) {
        const anchor = rig.anchors[c.key];
        if (anchor && (showing || c.el.classList.contains("visible"))) {
          const p = renderer.projectObject(anchor);
          c.el.style.transform = `translate(calc(${p.x}px - 50%), calc(${p.y}px - 100% - 24px))`;
        }
        c.el.classList.toggle("visible", showing);
        c.el.classList.toggle("hot", showing && rig.hint === c.key);
      }
      // the edge arrows are there whenever the page is open, and say whether they turn a page or a photo
      for (const a of edgeArrows) {
        const label = `${a.direction < 0 ? "Previous" : "Next"} ${rig.mode === "photo" ? "photo" : "page"}`;
        if (a.el.getAttribute("aria-label") !== label) {
          a.el.setAttribute("aria-label", label);
          a.el.title = label;
        }
        a.el.classList.toggle("visible", open);
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

  banner?.classList.add("show");
  const bannerTimer = setTimeout(() => banner?.classList.remove("show"), 3200);

  return () => {
    if (import.meta.env.DEV) console.info(`[game] scene #${sceneId} stopped`);
    cancelAnimationFrame(raf);
    clearTimeout(bannerTimer);
    for (const zone of world.zones) if (zone.kind === "gallery") filmRig(zone).onFrame = undefined;
    panel.destroy();
    abort.abort();
    renderer.dispose();
    labels.forEach((el) => el.remove());
    controlLabels.forEach((c) => c.el.remove());
    edgeArrows.forEach((a) => a.el.remove());
    root.classList.remove("ready");
  };
}
