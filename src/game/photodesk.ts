import type { Decal, Footprint, Prop, PropFocus, Rect, Scene } from "./scenes";

// The photography area: an Olympus OM-1 standing on a desk next to a light table with film on it (two rows of landscape
// photos and a vertical strip of portrait ones) that the camera's advance lever winds on, one photo per stroke.
// Positions are relative to the area's top-left corner, then shifted by (ox, oy) into world px.
// The width is kept in step with sceneSize("photodesk") in scenes.ts.
//
// On the map the table is small. When the project is opened the camera zooms in and the whole map grows about the front
// of the table (`zoom` on the scene), so the table grows without ever looking out of scale with what is around it. On
// top of that the camera prop and the desk mat are rearranged: on a wide screen the camera slides to the left of the
// table; on a portrait screen it goes above it instead, so the table can use the whole width of the screen.

const W = 256;
const H = 144;

/** The desk mat on the map (area-local), and the table that stands on it: footprint, and how much the map grows. */
const MAT = { x: 8, y: 8, w: W - 16, h: H - 16 };
// `grow` is how much the map grows about the table when the project opens (so how big the table ends up against the map):
// on a wide screen it is picked so that the table, with the camera beside it, about fills the height of the screen.
const TABLE = { w: 150, d: 120, x: 160, front: 132, grow: 2.4, growTall: 2.0 };
// `grow` is the camera's size once the project is open, against its size on the map (the table's is `TABLE.grow`). It is
// big enough to read as the second thing on the page and for its controls to have labels beside them.
const CAMERA = { x: 46, y: 76, grow: 2.0 };

/**
 * What the box covers once opened (area-local, after the map has grown): camera and table side by side, or stacked for
 * portrait screens. These are the numbers to tune; everything below is worked out from them. The camera, at `grow`,
 * takes about 104 x 88 of this, and `CAMERA_AT` puts its centre so that it clears the table (which spans x -20..340 and
 * z -156..132 when wide, and ends at z -108 when stacked) with a little room. `WIDE`'s shape is meant to match a 16:10
 * screen once the table's raised top is counted in, so on a 16:9 one the table's height is the limit.
 */
const WIDE: Rect = { x: -146, y: -164, w: 494, h: 302 };
const TALL: Rect = { x: -16, y: -206, w: 336, h: 340 };
/** Where the camera ends up (its centre), in the same zoomed coordinates. */
const CAMERA_AT = { wide: { x: -86, y: -12 }, tall: { x: 46, y: -160 } };

/** Where the map's zoom is anchored: the middle of the table's front edge, so the table grows back and sideways. */
const ANCHOR = { x: TABLE.x, y: TABLE.front };

/**
 * A prop's `focus` for ending up at scale `scale` with its centre at `to` (zoomed coordinates) once the map has grown
 * by `g` about the anchor: the map's growth already carries it, so only the difference is left to the prop.
 */
function relative(g: number, from: { x: number; y: number }, scale: number, to: { x: number; y: number }): PropFocus {
  return {
    scale: scale / g,
    dx: ANCHOR.x + (to.x - ANCHOR.x) / g - from.x,
    dz: ANCHOR.y + (to.y - ANCHOR.y) / g - from.y,
  };
}

/**
 * How the mat has to stretch and move, relative to the grown map, to cover `r` (zoomed coordinates): a margin at the top
 * and sides, and the mat's own front edge at the bottom.
 */
function matFocus(g: number, r: Rect): PropFocus {
  const t = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 4 }; // bottom reaches the mat's old front edge
  const centre = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  const base = { x: MAT.x + MAT.w / 2, y: MAT.y + MAT.h / 2 };
  return {
    sx: t.w / g / MAT.w,
    sz: t.h / g / MAT.h,
    dx: ANCHOR.x + (centre.x - ANCHOR.x) / g - base.x,
    dz: ANCHOR.y + (centre.y - ANCHOR.y) / g - base.y,
  };
}

const rect = (w: number, h: number): Footprint => ({ kind: "rect", w, h });

export function photoDeskScene(ox: number, oy: number): Scene {
  const at = (x: number, y: number) => ({ x: ox + x, y: oy + y });
  const toWorld = (r: Rect): Rect => ({ x: ox + r.x, y: oy + r.y, w: r.w, h: r.h });
  const props: Prop[] = [];
  const decals: Decal[] = [];
  const g = TABLE.grow;
  const gt = TABLE.growTall;

  // a dark desk mat under everything so the box reads as one surface. It is a flat prop rather than a ground decal so
  // that it can reach further than the box where it has to. On a wide screen it needs nothing: it grows with the map,
  // just as the box it sits in does, and keeps its margin inside it. Stacked for a portrait screen the camera ends up
  // above the box, so the mat stretches to go under that as well.
  props.push({
    sprite: "deskmat",
    ...at(MAT.x + MAT.w / 2, MAT.y + MAT.h),
    solid: rect(MAT.w, MAT.h),
    focus: { tall: matFocus(gt, TALL) },
  });

  // the camera stands on the left with its lens toward the viewer (south), turned 20 degrees clockwise (toward the west):
  // PI/2 turns its +x front to face +y, and a larger angle swings the front clockwise on screen
  // (opened up, it grows a little less than the table and sits level with the middle of it)
  const cameraFrom = { x: CAMERA.x, y: CAMERA.y };
  props.push({
    sprite: "omcamera",
    ...at(CAMERA.x, CAMERA.y),
    angle: Math.PI / 2 + (20 * Math.PI) / 180,
    solid: rect(32, 46),
    focus: {
      ...relative(g, cameraFrom, CAMERA.grow, CAMERA_AT.wide),
      tall: relative(gt, cameraFrom, CAMERA.grow, CAMERA_AT.tall),
    },
  });
  // the light table on the right: the viewer's way into the photos. It grows exactly as much as the map does.
  props.push({
    sprite: "lighttable",
    ...at(TABLE.x, TABLE.front),
    solid: rect(TABLE.w, TABLE.d),
  });

  return {
    area: { x: ox, y: oy, w: W, h: H },
    focusArea: toWorld(WIDE),
    focusAreaTall: toWorld(TALL),
    focusFill: 0.95, // the table is what the page is for: let it use nearly all of the screen it is given
    zoom: { about: at(ANCHOR.x, ANCHOR.y), scale: g, tall: gt },
    building: { x: ox, y: oy, w: W, h: H },
    labelAt: { x: ox + W / 2, y: oy + 40 },
    labelHeight: 40,
    // the grown table's tilted top at its back edge: about 45 high on the map (28 up, 10 for the tilt, 7 for the top and
    // the film on it), times how much the map grows. The framing needs it to keep that edge on screen.
    height: Math.ceil(45 * TABLE.grow),
    props,
    decals,
  };
}
