// The loading screen: a 35 mm film canister that stands at the left of a bar while the film is pulled out of it to the
// right as the world loads, leader tongue first, the frames following. The frames carry small copies of the gallery's
// photos (inlined in the page by `index.astro`, so they are there from the first paint), in black and white; when the
// world is ready they turn to colour, from the frame nearest the tongue back to the canister, and then the strip leaves.
// The page carries the markup, so it is painted before any script runs, and `intro.css` the look; this is the part that
// counts what has loaded, and moves the film. It does not import three.js, so it is ready long before the scene.
//
// Progress is a weighted sum of stages (below), and is how much of the world has really loaded. It only ever goes
// forward. The film does not follow it directly: that would make its speed ripple with every burst of updates. It is
// planned (`Film`, motion.ts): a steady pull that is held back by what has really loaded, and finishes once everything
// is ready, smoothed so that position, speed and acceleration never jump.
//
// How it is moved matters as much as the curve. A plan is played as ONE Web Animations `transform` animation per moving
// part, made of keyframes (so it runs on the compositor, and keeps going while the main thread is busy, with nothing to be
// accelerated but a transform), and a new plan is only made when it would look different, starting from the exact state
// the old one has by then, with the animation frame's own time as the start.
//
// `?introdebug` (or `localStorage.introdebug = "1"`) prints a table at the end: frame gaps, long tasks, and how evenly the
// film moved, with the stages in flight at the worst moments.

import { Film, keyframes } from "./motion";
import type { Plan } from "./motion";

export type Stage = "fonts" | "code" | "photos" | "scene" | "gpu";

const WEIGHT: Record<Stage, number> = { fonts: 0.05, code: 0.25, photos: 0.4, scene: 0.1, gpu: 0.2 };

/**
 * How the film moves (see motion.ts, FILM_DEFAULTS): it pulls at a steady `cruise` (of the bar a second) but never gets
 * more than `headroom` ahead of what has really loaded, and finishes at `finishSpeed` once everything is ready. With
 * `cruise: Infinity` it follows real progress directly. Higher `omega` and `lag` are quicker, and twitchier.
 */
const FILM = { cruise: 0.5, headroom: 0.06, finishSpeed: 0.9, speedRate: 3, omega: 16, lag: 20 };
const FILM_REDUCED = { cruise: 3, headroom: 0.06, finishSpeed: 6, speedRate: 20, omega: 40, lag: 60, gateRate: 20 };
/** A new plan is made this long (ms) before the one that is playing runs out. */
const REPLAN_AHEAD_MS = 500;
/** Past this the loader goes away with whatever is ready: it can never keep someone out of the page. */
const GIVE_UP_MS = 20000;
/** How close to the end (of the whole pull) counts as there: a few pixels on the bar (the last of a tail is not worth waiting for). */
const ARRIVED = 0.01;
const COLOUR_STAGGER_MS = 50; // from one frame turning to colour to the next
const COLOUR_MS = 700; // how long a frame takes to turn (the transition in intro.css)
const HOLD_MS = 300;
const LEAVE_MS = 600;
const FADE_MS = 400;

const SEEN_KEY = "loader-seen";

export interface Intro {
  /** How far a stage has got, 0..1. */
  stage(name: Stage, fraction: number): void;
  /** Resolves after GIVE_UP_MS: whatever is still not ready by then is not waited for. */
  readonly timeout: Promise<void>;
  /** Everything is ready: the film goes to the end and the loader plays out. Resolves when it is gone. */
  finish(): Promise<void>;
  /** Takes the loader away at once (something failed, or the page is being left). */
  cancel(): void;
}

function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the loader will just be shown again */
  }
}

function debugging(): boolean {
  try {
    return new URLSearchParams(location.search).has("introdebug") || localStorage.getItem("introdebug") === "1";
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Records what the loader's frames did, for `?introdebug`: how long each took, what blocked the main thread, and how
 * evenly the film moved (its position as the page computes it each frame). Costs nothing when it is not asked for.
 */
function startProbe(strip: HTMLElement | null, reelWidth: () => number) {
  const t0 = performance.now();
  const gaps: { t: number; gap: number }[] = [];
  const tasks: { t: number; ms: number }[] = [];
  const marks: { t: number; what: string }[] = [];
  const positions: number[] = []; // px
  let last = t0;
  let raf = 0;
  const loop = (now: number) => {
    gaps.push({ t: now - t0, gap: now - last });
    last = now;
    if (strip) {
      const m = new DOMMatrix(getComputedStyle(strip).transform);
      positions.push(m.m41);
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tasks.push({ t: e.startTime - t0, ms: e.duration });
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    /* no long task entries in this browser */
  }
  const near = (t: number) => {
    let best = "";
    for (const m of marks) if (m.t <= t + 50) best = m.what;
    return best;
  };
  return {
    mark: (what: string) => marks.push({ t: performance.now() - t0, what }),
    report() {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      const g = gaps.slice(1);
      const worst = [...g].sort((a, b) => b.gap - a.gap).slice(0, 6);
      // how much the film's step from one frame to the next changed (px per frame): a smooth pull changes it a little
      const steps = positions.slice(1).map((p, i) => p - positions[i]);
      const change = steps.slice(1).map((s, i) => Math.abs(s - steps[i]));
      const rows = worst.map((w) => ({ at_ms: Math.round(w.t), frame_ms: +w.gap.toFixed(1), stage: near(w.t) }));
      console.group("[intro] frame report");
      console.log({
        frames: g.length,
        meanFrameMs: +(g.reduce((a, b) => a + b.gap, 0) / Math.max(1, g.length)).toFixed(1),
        framesOver25ms: g.filter((x) => x.gap > 25).length,
        framesOver50ms: g.filter((x) => x.gap > 50).length,
        longTasks: tasks.length,
        longestTaskMs: Math.round(Math.max(0, ...tasks.map((x) => x.ms))),
        filmWidthPx: Math.round(reelWidth()),
        biggestChangeInStepPx: +Math.max(0, ...change).toFixed(2),
        stepChangesOver1px: change.filter((c) => c > 1).length,
      });
      console.table(rows);
      if (tasks.length) console.table(tasks.map((x) => ({ at_ms: Math.round(x.t), ms: Math.round(x.ms), stage: near(x.t) })));
      console.groupEnd();
    },
  };
}

/**
 * Starts the loader in `root`, and the loading it measures (the fonts, and the photos, which are the only graphics that
 * come over the network). Returns null (and hides the markup) when there is no loader to show: it has already played in this
 * browser session, or the markup is not there.
 */
export function createIntro(root: HTMLElement): Intro | null {
  const el = root.querySelector<HTMLElement>("[data-intro]");
  if (!el) return null;
  if (seen()) {
    el.hidden = true;
    return null;
  }
  el.hidden = false;
  root.setAttribute("aria-busy", "true");

  const frames = [...el.querySelectorAll<HTMLElement>("[data-intro-frame]")];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The colour copies are not painted until the wave, and an image is not decoded until it is painted: decoded here, off
  // the main thread, so that the wave does not start with eleven decodes in one frame.
  for (const img of el.querySelectorAll<HTMLImageElement>("img.colour")) void img.decode().catch(() => {});

  const done: Record<Stage, number> = { fonts: 0, code: 0, photos: 0, scene: 0, gpu: 0 };
  let shown = 0; // the furthest the film has been told to go
  let over = false; // finished or cancelled: nothing more to do

  // ---- moving the film. Three things move with how far it has been pulled (x, 0..1): the strip (out of the canister), the
  // bar's fill, and the knob (and the film's shadow, with the strip). Each plays the plan's positions as `transform` keyframes.
  const strip = el.querySelector<HTMLElement>("[data-intro-strip]");
  const spin = parseFloat(getComputedStyle(el).getPropertyValue("--spin")) || 0; // degrees over the whole pull
  const parts: [HTMLElement | null, (x: number) => string][] = [
    [strip, (x) => `translateX(${(x - 1) * 100}%)`],
    [el.querySelector("[data-intro-shadow]"), (x) => `translateX(${(x - 1) * 100}%)`], // (the film's shadow: same width, same move)
    [el.querySelector("[data-intro-fill]"), (x) => `scaleX(${x})`],
    [el.querySelector("[data-intro-disc]"), (x) => `rotate(${x * spin}deg)`],
  ];
  const film = new Film(reduceMotion ? FILM_REDUCED : FILM);
  const canAnimate = typeof HTMLElement.prototype.animate === "function";
  let playing: Animation[] = [];
  let frameId = 0; // the animation-frame loop that decides when a new plan is needed
  let finishing = false; // everything is ready: the gate is open
  let arrived: (() => void) | null = null; // resolves `finish` once the film is at the end

  const probe = debugging() ? startProbe(strip, () => el.querySelector<HTMLElement>("[data-intro-reel]")?.offsetWidth ?? 0) : null;

  const place = (x: number) => {
    for (const [part, transform] of parts) if (part) part.style.transform = transform(x);
  };

  /** Plays a plan (the one `film` has just adopted), at its own start time, in place of the one before. */
  const play = (plan: Plan) => {
    if (!canAnimate) return; // (placed a frame at a time instead: see `loop`)
    // (fill both: a new animation holds its first pose from the moment it is made, never showing the one under it)
    const timing: KeyframeAnimationOptions = { duration: plan.seconds * 1000, easing: "linear", fill: "both" };
    const next: Animation[] = [];
    for (const [part, transform] of parts) {
      if (!part) continue;
      const a = part.animate(keyframes(plan, transform), timing);
      a.startTime = plan.t0; // the instant the plan took its state at: the frame's time, which is the compositor's
      next.push(a);
    }
    // (in the same task, so no frame lands between the old animations and the new)
    for (const a of playing) a.cancel();
    playing = next;
  };

  /** Once a frame: a new plan if there is none, if it would differ from the one playing, or if that is running out. */
  const loop = (now: number) => {
    frameId = requestAnimationFrame(loop);
    if (over) return;
    const cur = film.current;
    const running = cur ? cur.t0 + cur.seconds * 1000 - now : 0;
    const stale = !cur || cur.progress !== shown || cur.finishing !== finishing;
    if (stale || running < REPLAN_AHEAD_MS) {
      const next = film.make(now, shown, finishing);
      if (!cur || running < REPLAN_AHEAD_MS || film.differs(next, now)) {
        film.adopt(next);
        play(next);
        probe?.mark(`plan from ${(next.x0 * 100).toFixed(0)}% (progress ${(shown * 100).toFixed(0)}%${finishing ? ", finishing" : ""})`);
      } else {
        cur.progress = shown; // (looked at: it would not look different)
      }
    }
    if (!canAnimate) place(film.at(now).x);
    if (finishing && arrived && 1 - film.at(now).x <= ARRIVED) {
      arrived();
      arrived = null;
    }
  };
  frameId = requestAnimationFrame(loop);

  const render = () => {
    let total = 0;
    for (const s of Object.keys(WEIGHT) as Stage[]) total += WEIGHT[s] * done[s];
    shown = Math.max(shown, Math.min(1, total));
    const percent = Math.round(shown * 20) * 5; // (in steps of 5: a change to it is work for assistive technology)
    if (String(percent) !== el.getAttribute("aria-valuenow")) el.setAttribute("aria-valuenow", String(percent));
  };

  const stage = (name: Stage, fraction: number) => {
    if (over) return;
    done[name] = Math.max(done[name], Math.min(1, Math.max(0, fraction)));
    probe?.mark(`${name} ${Math.round(done[name] * 100)}%`);
    render();
  };

  // ---- what the intro itself measures
  // The fonts the page and its canvas text use, so nothing is drawn in a fallback face and then redrawn.
  void Promise.race([
    Promise.all([
      document.fonts.load('500 1em "Figtree"'),
      document.fonts.load('600 1em "Figtree"'),
      document.fonts.load('500 1em "Fraunces Variable"'),
    ]).then(() => document.fonts.ready),
    sleep(4000),
  ]).then(
    () => stage("fonts", 1),
    () => stage("fonts", 1)
  );

  // Each photo is fetched and decoded (full size: the scene asks for the same urls, which then come from the cache, and
  // they are what the world waits for), and counts towards the pull as it arrives. The frames do not wait for them: they
  // carry the inlined thumbnails. Only a frame without one (the build could not make it) is given the photo when it lands.
  let photosDone = 0;
  const total = frames.length;
  if (!total) done.photos = 1;
  for (const frame of frames) {
    const finish = () => {
      stage("photos", ++photosDone / total);
    };
    const src = frame.dataset.src;
    if (!src) {
      finish();
      continue;
    }
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.src = src;
    const ready = () => {
      const window = frame.querySelector("[data-intro-window]") ?? frame;
      if (!over && !window.querySelector("img")) {
        img.style.filter = "grayscale(1)"; // (only a frame the build could not make thumbnails for: the strip has no filters)
        window.prepend(img);
      }
      finish();
    };
    img.decode().then(ready, finish); // a photo that will not load does not hold the film up
  }

  let timedOut!: () => void;
  const timeout = new Promise<void>((resolve) => (timedOut = resolve));
  const giveUp = setTimeout(timedOut, GIVE_UP_MS);

  const leave = async () => {
    if (over) return;
    over = true;
    clearTimeout(giveUp);
    cancelAnimationFrame(frameId);
    probe?.report();
    el.classList.add("leaving");
    await sleep(reduceMotion ? FADE_MS : LEAVE_MS + FADE_MS);
    el.hidden = true;
    root.removeAttribute("aria-busy");
  };

  return {
    stage,
    timeout,
    async finish() {
      if (over) return;
      for (const s of Object.keys(WEIGHT) as Stage[]) done[s] = 1;
      render();
      // the gate opens: the film finishes its pull (the next frame plans that), and that is waited for
      await new Promise<void>((resolve) => {
        arrived = resolve;
        finishing = true;
      });
      if (over) return;
      // the photos have been black and white all along: now they take their colour, from frame 1 (next to the tongue, and
      // last in the page: the strip is laid out the way it comes out of the canister) back to the canister
      [...frames].reverse().forEach((frame, i) => {
        setTimeout(() => {
          frame.classList.add("coloured");
          frame.querySelectorAll("img").forEach((img) => (img.style.filter = ""));
        }, reduceMotion ? 0 : i * COLOUR_STAGGER_MS);
      });
      await sleep(reduceMotion ? 200 : Math.max(0, frames.length - 1) * COLOUR_STAGGER_MS + COLOUR_MS + HOLD_MS);
      if (over) return;
      markSeen();
      await leave();
    },
    cancel() {
      if (over) return;
      over = true;
      clearTimeout(giveUp);
      cancelAnimationFrame(frameId);
      for (const a of playing) a.cancel();
      probe?.report();
      el.hidden = true;
      root.removeAttribute("aria-busy");
    },
  };
}
