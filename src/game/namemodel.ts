import { ExtrudeGeometry, Group } from "three";
import { box, mesh, toon } from "./models";
import { NAME } from "./name";
import { nameShapes } from "./nameshapes";

// The name, "Kevin Dong", in Goudy Bookletter 1911: raised ivory letters on a stone tablet that leans back on a low plinth,
// so that its face catches the camera. Same conventions as models.ts: 1 unit = 1 world px, origin at the plinth's centre
// on the ground. It does nothing and cannot be picked; the sun, the grade and the focus dimming do the rest.

const LETTERS = "#e6d9bd"; // a little under the ivory it ends up as: the grade lifts highlights and leans them warm
const STONE = "#857d6f";
const PLINTH = "#5f5a52";

const LEAN = (12 * Math.PI) / 180;
const PLINTH_H = 5;
const TABLET_D = 7;
const RELIEF = 4; // how far the letters stand off the tablet

export function nameModel(): Group {
  const g = new Group();
  const { shapes, top, bottom } = nameShapes(NAME.letters);
  const width = NAME.letters + 2 * NAME.pad;

  g.add(box(width + 8, PLINTH_H, NAME.depth, PLINTH, 0, 0, 0));

  // a tablet tall enough for the capitals and the tail of the g, with the same stone showing all round
  const height = top - bottom + 2 * NAME.pad;
  const tablet = new Group();
  tablet.position.set(0, PLINTH_H, NAME.depth / 2 - TABLET_D); // stands towards the front of the plinth
  tablet.rotation.x = -LEAN;
  tablet.add(box(width, height, TABLET_D, STONE, 0, 0, 0));

  const geometry = new ExtrudeGeometry(shapes, {
    depth: RELIEF,
    curveSegments: 6,
    bevelEnabled: true,
    bevelThickness: 0.6,
    bevelSize: 0.5, // outwards, which also keeps the hairline serifs from vanishing
    bevelSegments: 1,
  });
  // the baseline sits above the tablet's bottom edge by the pad and the depth of the g's tail
  tablet.add(mesh(geometry, toon(LETTERS), 0, NAME.pad - bottom, TABLET_D / 2));
  g.add(tablet);
  return g;
}
