import { CanvasTexture, RepeatWrapping } from "three";

// A film-grain surface for the letters of the name: fine grain, a few dust specks and scuffs, and a soft mottling, as a texture that
// multiplies the colour of a material. It cannot make a surface brighter than its colour, so the texture sits a little under white
// (GRAIN_MEAN is how far under, on average) and the colour that goes with it is raised by the same amount, so that the grain does
// not change the overall tone. Tweak the strength here.

/** How strongly the grain departs from its mean: 0 is smooth, 0.1 is heavy. */
const AMPLITUDE = 0.07;
/** The texture's average brightness (1 = white). */
export const GRAIN_MEAN = 0.94;

const SIZE = 512; // texture px
const REPEAT = 256; // map px that one tile covers (2 texture px for every map px): wide, so that the pattern hardly repeats across the name
const AREA = (SIZE / 256) ** 2; // how many more of the specks and patches a tile of this size takes, to keep them as dense

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function grainTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const rand = rng(77);
  const grey = (v: number) => {
    const g = Math.max(0, Math.min(255, Math.round(v * 255)));
    return `rgb(${g},${g},${Math.round(g * 0.985)})`; // (a hair warm)
  };
  /** Draws at every wrap of the tile, so that nothing stops at a seam. */
  const wrapped = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) draw(dx, dy);
  };

  // the grain: cells of one map px, around the mean
  const cell = SIZE / REPEAT;
  for (let y = 0; y < SIZE; y += cell) {
    for (let x = 0; x < SIZE; x += cell) {
      ctx.fillStyle = grey(GRAIN_MEAN + (rand() + rand() - 1) * AMPLITUDE);
      ctx.fillRect(x, y, cell, cell);
    }
  }

  // mottling: broad, faint patches, lighter and darker
  for (let i = 0; i < Math.round(14 * AREA); i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = 24 + rand() * 40;
    const dark = rand() < 0.5;
    wrapped((dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, dark ? `rgba(0,0,0,${0.05 + rand() * 0.04})` : `rgba(255,255,255,${0.05 + rand() * 0.04})`);
      g.addColorStop(1, "rgba(128,128,128,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    });
  }

  // dust: a few darker specks
  for (let i = 0; i < Math.round(46 * AREA); i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.12 + rand() * 0.18})`;
    const s = cell * (1 + (rand() < 0.3 ? 1 : 0));
    ctx.fillRect(Math.floor(rand() * SIZE), Math.floor(rand() * SIZE), s, s);
  }

  // scuffs: short scratches, a few light and most dark
  for (let i = 0; i < Math.round(20 * AREA); i++) {
    const light = rand() < 0.35;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.1 + rand() * 0.12})` : `rgba(0,0,0,${0.1 + rand() * 0.12})`;
    ctx.lineWidth = 0.8 + rand();
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const len = 10 + rand() * 28;
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + len, y + dy + (rand() - 0.5) * 6);
      ctx.stroke();
    });
  }

  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / REPEAT, 1 / REPEAT); // (the letters' tops take map px as texture coordinates)
  t.anisotropy = 8;
  return t;
}
