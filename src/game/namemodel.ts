import { Color, ExtrudeGeometry, Group } from "three";
import { GRAIN_MEAN, grainTexture } from "./grain";
import { mesh, toon } from "./models";
import { NAME, NAME_BASELINE, NAME_H, NAME_TOP } from "./name";
import { nameShapes } from "./nameshapes";

// The name, "Kevin Dong", in Goudy Bookletter 1911: big, thick letters lying flat on the ground, like block letters set into a
// courtyard, in the site's beige with a fine film grain. Same conventions as models.ts: 1 unit = 1 world px. The origin is the
// middle of the name's footprint on the ground (it is the model of the name's zone), so the baseline is a little south of it, with
// the capitals north of the baseline and the g's tail hanging south. Hovering the zone lifts the letters, like any other project.

/** A colour of the site's theme (src/styles/global.css), so that the scene stays in step with it. */
function themeColor(name: string, fallback: string): Color {
  const value = typeof getComputedStyle === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(value || fallback);
}

/**
 * The sun and the scene's warm grade lift a flat top toward cream, so the theme's beige on its own comes out lighter on screen than
 * it is. The letters take the theme colour times this, so that they read as that beige. This is the one number to tune.
 */
const LIGHTING_ALLOWANCE = 0.85;

const THICK = 9; // how high the letters stand off the ground
const BEVEL = 1.4;

export function nameModel(): Group {
  const g = new Group();
  const { shapes } = nameShapes(NAME.letters);
  const geometry = new ExtrudeGeometry(shapes, {
    depth: THICK,
    curveSegments: 1, // (the outline is straight segments already: see `nameShapes`)
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: 1.1, // outwards, which also makes the hairline serifs a solid stroke
    bevelSegments: 2,
  });
  // extruded along +z, with the letters' top towards +y: lay them down so that they rise from the ground (y) and read
  // upright from the south, where the camera is (a letter's top towards -z)
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, BEVEL, 0); // (the bevel reaches that far below the face the extrusion starts from)

  // the letters' own material (the shared one is for every other model of that colour): the beige, with the grain on it
  const letters = toon("#ffffff").clone();
  letters.map = grainTexture();
  letters.color.copy(themeColor("--color-border", "#d9cab3")).multiplyScalar(LIGHTING_ALLOWANCE / GRAIN_MEAN); // (the grain's average darkening is allowed for)

  // the shapes' baseline is at the origin: move it to where it is, relative to the middle of the footprint
  g.add(mesh(geometry, letters, 0, 0, NAME_BASELINE - (NAME_TOP + NAME_H / 2)));
  // (hovered, the letters only lift: the light is on the ground under them, see nameglow.ts)
  return g;
}
