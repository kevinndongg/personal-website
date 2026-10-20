import { ExtrudeGeometry, Group } from "three";
import { mesh, toon } from "./models";
import { NAME } from "./name";
import { nameShapes } from "./nameshapes";

// The name, "Kevin Dong", in Goudy Bookletter 1911: big, thick ivory letters lying flat on the ground, like block letters
// set into a courtyard. Same conventions as models.ts: 1 unit = 1 world px. The origin is on the ground at the middle of the
// baseline, so the capitals stand north of it and the g's tail hangs south of it. It does nothing and cannot be picked; the
// sun, the grade and the focus dimming do the rest.

export const LETTERS = "#b8ae97"; // a warm ivory, well under white: the grade lifts highlights and leans them warm
const THICK = 9; // how high the letters stand off the ground
const BEVEL = 1.4;

export function nameModel(): Group {
  const g = new Group();
  const { shapes } = nameShapes(NAME.letters);
  const geometry = new ExtrudeGeometry(shapes, {
    depth: THICK,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: 1.1, // outwards, which also makes the hairline serifs a solid stroke
    bevelSegments: 2,
  });
  // extruded along +z, with the letters' top towards +y: lay them down so that they rise from the ground (y) and read
  // upright from the south, where the camera is (a letter's top towards -z)
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, BEVEL, 0); // (the bevel reaches that far below the face the extrusion starts from)
  g.add(mesh(geometry, toon(LETTERS)));
  return g;
}
