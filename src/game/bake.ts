import { Matrix4, Mesh } from "three";
import type { BufferGeometry, Material, Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Most props are built from a dozen small meshes of a few materials, and each mesh is a draw call twice over (the shadow pass,
// and the picture). A prop that never changes after it is built can have its meshes of one material joined into one: the
// same triangles, and the same picture, for a fraction of the calls.

/** `userData` keys that mark a part for something outside the model (picking, the table's controls, the lift, the ground). */
const MARKS = ["part", "slot", "noPick", "liftOverlay", "flat"];

/**
 * Whether nothing about the model can change once it is built. A model that animates, or is posed or driven from outside,
 * hands out functions through its `userData` (`animate`, `pose`, `drive`, `setGlow`...), which hold on to its parts: those
 * parts have to stay as they are. The same goes for any part marked for something else (see `MARKS`).
 */
function isStatic(model: Object3D): boolean {
  let ok = true;
  model.traverse((o) => {
    for (const [key, value] of Object.entries(o.userData)) if (typeof value === "function" || MARKS.includes(key)) ok = false;
  });
  return ok;
}

/** The matrix that takes a part to the model's own space (the model's own transform left out). */
function inModel(part: Object3D, model: Object3D): Matrix4 {
  const m = new Matrix4();
  for (let o: Object3D | null = part; o && o !== model; o = o.parent) {
    o.updateMatrix();
    m.premultiply(o.matrix);
  }
  return m;
}

/** Whether a mesh can be joined with others without changing how it draws. */
function joinable(mesh: Mesh, model: Object3D): boolean {
  if (Array.isArray(mesh.material) || mesh.material.transparent || mesh.material.clippingPlanes?.length) return false;
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial || Object.prototype.hasOwnProperty.call(mesh, "onBeforeRender")) return false;
  for (let o: Object3D | null = mesh; o && o !== model; o = o.parent) if (!o.visible) return false;
  return inModel(mesh, model).determinant() > 0; // (a mirrored part would draw inside out once its matrix is baked in)
}

/**
 * Joins the meshes of a static model that share a material (and shadow flags) into one each. Returns how many meshes there
 * were and how many there are now. A model that is not static is left alone.
 */
export function bakeStatic(model: Object3D): { from: number; to: number } {
  const groups = new Map<string, { material: Material; cast: boolean; receive: boolean; order: number; meshes: Mesh[] }>();
  let from = 0;
  if (isStatic(model)) {
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (o === model || !mesh.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || !joinable(mesh, model)) return;
      const material = mesh.material as Material;
      const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder, meshes: [] }));
      group.meshes.push(mesh);
    });
  }
  model.traverse((o) => ((o as Mesh).isMesh ? from++ : 0));
  let to = from;
  for (const { material, cast, receive, order, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => mesh.geometry.clone().applyMatrix4(inModel(mesh, model)));
    // (the geometries have to carry the same attributes, and all be indexed or none: keep what they have in common)
    const names = Object.keys(geometries[0].attributes).filter((name) => geometries.every((g) => g.attributes[name]));
    const indexed = geometries.every((g) => g.index);
    for (const g of geometries) {
      for (const name of Object.keys(g.attributes)) if (!names.includes(name)) g.deleteAttribute(name);
    }
    const joined = mergeGeometries(indexed ? geometries : geometries.map((g) => (g.index ? g.toNonIndexed() : g)));
    geometries.forEach((g: BufferGeometry) => g.dispose());
    if (!joined) continue;
    const mesh = new Mesh(joined, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.renderOrder = order;
    for (const part of meshes) part.removeFromParent();
    model.add(mesh);
    to -= meshes.length - 1;
  }
  // (the groups the parts stood in are empty now: they would only be walked over every frame)
  const prune = (o: Object3D) => {
    for (const child of [...o.children]) {
      prune(child);
      if (!(child as Mesh).isMesh && child.children.length === 0 && Object.keys(child.userData).length === 0) child.removeFromParent();
    }
  };
  if (to < from) prune(model);
  return { from, to };
}
