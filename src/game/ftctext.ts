// A 3 x 5 pixel font, enough for the signs, the banner, the match clock and the plates on the robots. Each glyph is its rows,
// left to right. No `three` in here: both robot models and the field's models draw with it.

export const GLYPHS: Record<string, string> = {
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "111101101101101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "110001010100111",
  "3": "110001010001110",
  "4": "101101111001001",
  "5": "111100110001110",
  "6": "011100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001110",
  ":": "000010000010000",
  "-": "000000111000000",
  " ": "000000000000000",
};

/** Width in texels of `text` at `scale` (glyphs are 3 wide with a 1 texel gap, none after the last). */
export const textWidth = (text: string, scale: number) => text.length * 4 * scale - scale;

export function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let i = 0; i < 15; i++) if (g[i] === "1") ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
    cx += 4 * scale;
  }
}

/** Text centred across a canvas that is `width` texels wide. */
export function centred(ctx: CanvasRenderingContext2D, width: number, text: string, y: number, scale: number, color: string) {
  pixelText(ctx, text, Math.round((width - textWidth(text, scale)) / 2), y, scale, color);
}
