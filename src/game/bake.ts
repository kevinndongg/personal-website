import { Matrix4, Mesh } from "three";
import type { BufferGeometry, Material, Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Most props are built from a dozen small meshes of a few materials, and each mesh is a draw call twice over (the shadow pass,
// and the picture). Meshes that never move relative to each other can be joined into one per material: the same triangles,
// and the same picture, for a fraction of the calls.
//
// A prop that never changes once it is built is joined as a whole. A prop that animates has to say which of its parts move
// (`markMoving`): the meshes are then joined within each part (everything that moves with it), and the moving parts themselves
// are left as they are. A prop that animates but does not say is left alone.

/** `userData` keys that mark a part for something outside the model (picking, the table's controls, the lift, the ground). */
const MARKS = ["part", "slot", "noPick", "liftOverlay", "flat"];

/**
 * Says that `parts` are the objects the model's animation moves: it changes their position, rotation or scale, or shows and
 * hides them, or gives them other children. Every one of them has to be listed (a part that moves and is not listed freezes
 * where it stands) but not what stands inside them: that moves with them. A listed part may be the model's own group.
 */
export function markMoving(model: Object3D, ...parts: Object3D[]): void {
  model.userData.bakeable = true;
  for (const part of parts) part.userData.moves = true;
}

/**
 * Whether the model can be joined at all. What can change it, once it is built, is handed out through `userData` as functions
 * (`animate`, `pose`, `drive`, `setGlow`...), which hold on to its parts: such a model has to have said what moves (see
 * `markMoving`), and only its own group may carry the functions. A part marked for something else (see `MARKS`) rules it out.
 */
function joinable(model: Object3D): boolean {
  let ok = true;
  model.traverse((o) => {
    for (const [key, value] of Object.entries(o.userData)) {
      if (MARKS.includes(key) || (typeof value === "function" && !(o === model && model.userData.bakeable))) ok = false;
    }
  });
  return ok;
}

/** The part a mesh is joined into: the nearest part above it that moves, or the model itself. */
function frameOf(mesh: Object3D, model: Object3D): Object3D {
  for (let o = mesh.parent; o && o !== model; o = o.parent) if (o.userData.moves) return o;
  return model;
}

/** The matrix that takes a part to the space of `frame` (the frame's own transform left out). */
function inFrame(part: Object3D, frame: Object3D): Matrix4 {
  const m = new Matrix4();
  for (let o: Object3D | null = part; o && o !== frame; o = o.parent) {
    o.updateMatrix();
    m.premultiply(o.matrix);
  }
  return m;
}

/** Whether a mesh can be joined with others without changing how it draws. */
function canJoin(mesh: Mesh, frame: Object3D): boolean {
  if (mesh.userData.moves || Array.isArray(mesh.material) || mesh.material.transparent || mesh.material.clippingPlanes?.length) return false;
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial || Object.prototype.hasOwnProperty.call(mesh, "onBeforeRender")) return false;
  for (let o: Object3D | null = mesh; o && o !== frame; o = o.parent) if (!o.visible) return false;
  return inFrame(mesh, frame).determinant() > 0; // (a mirrored part would draw inside out once its matrix is baked in)
}

/**
 * Joins the meshes of a model that share a material (and shadow flags) and move together into one each. Returns how many
 * meshes there were and how many there are now. A model that cannot be joined (see `joinable`) is left alone.
 */
export function bakeStatic(model: Object3D): { from: number; to: number } {
  type Group = { frame: Object3D; material: Material; cast: boolean; receive: boolean; order: number; meshes: Mesh[] };
  const groups = new Map<string, Group>();
  let from = 0;
  const all = joinable(model);
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    from++;
    if (!all || (o as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const frame = frameOf(mesh, model);
    if (!canJoin(mesh, frame)) return;
    const material = mesh.material as Material;
    const key = `${frame.uuid}|${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { frame, material, cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder, meshes: [] }));
    group.meshes.push(mesh);
  });
  let to = from;
  for (const { frame, material, cast, receive, order, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => mesh.geometry.clone().applyMatrix4(inFrame(mesh, frame)));
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
    frame.add(mesh);
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
