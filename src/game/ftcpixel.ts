import { ExtrudeGeometry, Mesh, Path, Shape, Vector2 } from "three";
import { PIXEL_SIZE } from "./ftcfield";
import { mesh, toon } from "./models";

// A Center Stage pixel as a 3D model: a hexagonal ring 3 in across and half an inch thick with a hexagonal hole (sizes in ftcfield.ts). The
// field's floor pixels, the pixels on the backdrop and the ones the Center Stage robot carries are all this one shared geometry.

let pixelGeo: ExtrudeGeometry | null = null;

/** One pixel's ring, shared: a hexagon 3 in across with a hexagonal hole, half an inch thick, the extrusion going up (+y). */
export function pixelRing(): ExtrudeGeometry {
  if (!pixelGeo) {
    const hex = (r: number) => Array.from({ length: 6 }, (_, k) => new Vector2(Math.cos(Math.PI / 6 + (k * Math.PI) / 3) * r, Math.sin(Math.PI / 6 + (k * Math.PI) / 3) * r));
    const outline = new Shape(hex(PIXEL_SIZE.corner / 2));
    outline.holes.push(new Path(hex((PIXEL_SIZE.corner / 2) * PIXEL_SIZE.hole)));
    pixelGeo = new ExtrudeGeometry(outline, { depth: PIXEL_SIZE.thick, bevelEnabled: false });
    pixelGeo.rotateX(-Math.PI / 2); // lie flat: the extrusion goes up
  }
  return pixelGeo;
}

/** A pixel lying flat with its underside `y` above the origin, two of its sides facing east and west. It catches the light on its thickness and the hole's walls. */
export function pixelMesh(color: string, y = 0): Mesh {
  return mesh(pixelRing(), toon(color), 0, y, 0);
}
