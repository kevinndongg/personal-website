// One place for every color in the game. Sprite grids use the single-letter keys below.
export const SPRITE_PALETTE: Record<string, string> = {
  K: "#16161d", // outline
  w: "#f4f4f4", // white
  g: "#b8bcc4", // light grey
  G: "#8b909a", // mid grey
  d: "#4a4d57", // dark grey
  o: "#f08a1c", // orange
  O: "#b4560e", // dark orange
  b: "#2f74e0", // blue
  B: "#1b4796", // dark blue
  r: "#d8322c", // red
  R: "#8e1d1a", // dark red
  y: "#f6d02a", // yellow
  Y: "#b8921a", // dark yellow
  t: "#26262c", // tire black
  T: "#43434d", // tire tread highlight
  s: "#8fdcff", // screen / glass
  S: "#4aa0d0", // screen shade
};

export const GROUND = {
  asphalt: ["#3c3d46", "#3f4049"],
  asphaltSpeck: ["#2f3037", "#51525c"],
  concrete: ["#70737d", "#74777f"],
  concreteJoint: "#5a5d66",
  concreteSpeck: ["#62656e", "#8a8d97"],
  oil: "#25262c",
  laneLine: "#c9a921",
  shadow: "rgba(10, 10, 16, 0.35)",
  pathDot: "#f4f4f4",
  marker: "#f6d02a",
};

export const CAR = {
  body: "#d8322c",
  bodyDark: "#8e1d1a",
  bodyLight: "#f06a5e",
  stripe: "#f4f4f4",
  glass: "#8fdcff",
  wheel: "#1a1a20",
  hub: "#b8bcc4",
  headlight: "#f6d02a",
  taillight: "#ff5a4a",
  outline: "#16161d",
};

// Zone roofs fall back to these when a project has no accentColor.
export const ZONE_FALLBACK_ACCENTS = [
  "#d8322c",
  "#2f74e0",
  "#e8a317",
  "#2fa84f",
  "#e07a1f",
  "#8a4fd0",
];
