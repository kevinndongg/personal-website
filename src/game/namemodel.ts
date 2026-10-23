import { ExtrudeGeometry, Group } from "three";
import { mesh, toon } from "./models";
import { NAME, NAME_BASELINE, NAME_H, NAME_TOP } from "./name";
import { nameShapes } from "./nameshapes";

// The name, "Kevin Dong", in Goudy Bookletter 1911: big, thick ivory letters lying flat on the ground, like block letters set
// into a courtyard. Same conventions as models.ts: 1 unit = 1 world px. The origin is the middle of the name's footprint on the
// ground (it is the model of the name's zone), so the baseline is a little south of it, with the capitals north of the baseline
// and the g's tail hanging south. Hovering the zone lifts the letters, like any other project.

const LETTERS = "#e6d9bd"; // a little under the ivory it ends up as: the grade lifts highlights and leans them warm
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
  // the shapes' baseline is at the origin: move it to where it is, relative to the middle of the footprint
  g.add(mesh(geometry, toon(LETTERS), 0, 0, NAME_BASELINE - (NAME_TOP + NAME_H / 2)));
  return g;
}
