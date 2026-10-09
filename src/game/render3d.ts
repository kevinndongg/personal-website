import {
  AmbientLight,
  BoxGeometry,
  BasicShadowMap,
  CanvasTexture,
  Color,
  ColorManagement,
  DirectionalLight,
  Group,
  InstancedMesh,
  LinearSRGBColorSpace,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Plane,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  UnsignedByteType,
  RGBAFormat,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import type { Car } from "./car";
import { buildGroundLayer } from "./ground";
import { createModel, hazardWallTexture, roadCarModel, tireModel } from "./models";
import { TILE } from "./world";
import type { World } from "./world";

export interface Marker {
  x: number;
  y: number;
}

// Colors are authored as plain sRGB hex values and used as-is (no color management),
// so the palette in the code is exactly what ends up on screen.
ColorManagement.enabled = false;

const TILT = (58 * Math.PI) / 180; // camera elevation above the horizon
const YAW = 0; // straight-on: map edges line up with the pixel grid
const CAM_DIST = 2500; // orthographic: distance only has to clear the scene
/** Each rendered pixel is shown as this many CSS pixels (a whole number, so every pixel is the same size). */
const PIXEL_CSS = 2;
/** The road car's visual heading snaps to this many directions (its steering stays continuous). */
const CAR_STEPS = 24;

const EDGE_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Draws the scene color, plus a 1px dark outline on every object pixel that touches a different object id.
const EDGE_FS = `
  uniform sampler2D tColor;
  uniform sampler2D tId;
  uniform vec2 texel;
  uniform vec3 outline;
  varying vec2 vUv;
  float differs(vec3 a, vec3 b) { return step(0.002, abs(a.r - b.r) + abs(a.g - b.g) + abs(a.b - b.b)); }
  void main() {
    vec4 c = texture2D(tColor, vUv);
    vec3 id = texture2D(tId, vUv).rgb;
    float edge = 0.0;
    if (dot(id, id) > 0.0001) {
      edge = max(
        max(differs(id, texture2D(tId, vUv + vec2(texel.x, 0.0)).rgb), differs(id, texture2D(tId, vUv - vec2(texel.x, 0.0)).rgb)),
        max(differs(id, texture2D(tId, vUv + vec2(0.0, texel.y)).rgb), differs(id, texture2D(tId, vUv - vec2(0.0, texel.y)).rgb))
      );
    }
    gl_FragColor = vec4(mix(c.rgb, outline, edge), 1.0);
  }
`;

/** Defaults for the hover effect on a project box (a scene can override via `scene.hover`). */
const LIFT = 2; // rendered pixels the props rise (whole pixels only, so they never shimmer)
const GLOW = 0.14; // how much brighter the ground gets (white overlay opacity)

const VISUAL_SCALE: Record<string, number> = {
  cone: 1.3,
  person: 1.4,
  battery: 1.3,
  laptop: 1.4,
  tirestack: 1.3,
  formula: 1.42,
};

export class Renderer3D {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  private renderer: WebGLRenderer;
  private colorTarget: WebGLRenderTarget;
  private idTarget: WebGLRenderTarget;
  private quadScene = new Scene();
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: ShaderMaterial;
  private raycaster = new Raycaster();
  private groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private center: Vector3;
  private carModel: Group;
  private pickables: Object3D[] = [];
  private zoneModels = new Map<string, Object3D[]>();
  private zoneGlow = new Map<string, Mesh>();
  /** Models that sit on the pixel board: re-snapped whenever the camera or resolution changes. */
  private snapped: { obj: Object3D; x: number; z: number }[] = [];
  private wpp = 1; // world units per rendered pixel
  private idMaterials = new Map<Mesh, Material | Material[]>();
  private blackId = new MeshBasicMaterial({ color: "#000000" });
  private dots: InstancedMesh;
  private markerMesh: Group;
  private mapSize: number;
  private width = 1;
  private height = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World
  ) {
    this.mapSize = world.w * TILE;
    this.center = new Vector3(this.mapSize / 2, 0, this.mapSize / 2);

    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = BasicShadowMap;
    this.renderer.setClearColor(new Color("#16161d"));

    const makeTarget = () =>
      new WebGLRenderTarget(1, 1, {
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        format: RGBAFormat,
        type: UnsignedByteType,
        depthBuffer: true,
      });
    this.colorTarget = makeTarget();
    this.idTarget = makeTarget();

    this.quad = new ShaderMaterial({
      vertexShader: EDGE_VS,
      fragmentShader: EDGE_FS,
      uniforms: {
        tColor: { value: this.colorTarget.texture },
        tId: { value: this.idTarget.texture },
        texel: { value: new Vector2(1, 1) },
        outline: { value: new Color("#101018") },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new Mesh(new PlaneGeometry(2, 2), this.quad);
    this.quadScene.add(tri);

    this.buildScene();

    // marker + path dots (flat things on the ground)
    this.dots = new InstancedMesh(new BoxGeometry(2, 0.4, 2), new MeshBasicMaterial({ color: "#f4f4f4" }), 160);
    this.dots.userData.noOutline = true;
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);
    this.markerMesh = new Group();
    const mk = new MeshBasicMaterial({ color: "#f6d02a" });
    const bar1 = new Mesh(new BoxGeometry(9, 0.6, 2), mk);
    const bar2 = new Mesh(new BoxGeometry(2, 0.6, 9), mk);
    this.markerMesh.add(bar1, bar2);
    this.markerMesh.visible = false;
    bar1.userData.noOutline = bar2.userData.noOutline = true;
    this.scene.add(this.markerMesh);

    this.assignIds();
  }

  private buildScene() {
    const { scene, world, mapSize } = this;

    scene.add(new AmbientLight("#ffffff", 1.15));
    const sun = new DirectionalLight("#ffffff", 2.0);
    sun.position.set(mapSize / 2 + 320, 420, mapSize / 2 + 380);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -620;
    cam.right = 620;
    cam.top = 620;
    cam.bottom = -620;
    cam.near = 50;
    cam.far = 1600;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);

    // ground: the 2D floor drawing as a texture, plus a shadow-only overlay
    const tex = new CanvasTexture(buildGroundLayer(world));
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.generateMipmaps = false;
    const ground = new Mesh(new PlaneGeometry(mapSize, mapSize), new MeshBasicMaterial({ map: tex }));
    ground.userData.noOutline = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.copy(this.center);
    scene.add(ground);
    const shadowCatcher = new Mesh(new PlaneGeometry(mapSize, mapSize), new ShadowMaterial({ opacity: 0.38 }));
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.set(this.center.x, 0.05, this.center.z);
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    // low hazard-striped wall around the yard
    const hz = hazardWallTexture();
    hz.wrapS = hz.wrapT = RepeatWrapping;
    const wallMat = (repX: number) => {
      const t = hz.clone();
      t.repeat.set(repX, 1);
      t.needsUpdate = true;
      return new MeshBasicMaterial({ map: t });
    };
    const wallH = 6;
    const ring = TILE;
    const long = mapSize / TILE;
    const walls: [number, number, number, number, number][] = [
      [mapSize, ring, mapSize / 2, ring / 2, long],
      [mapSize, ring, mapSize / 2, mapSize - ring / 2, long],
      [ring, mapSize - 2 * ring, ring / 2, mapSize / 2, 1],
      [ring, mapSize - 2 * ring, mapSize - ring / 2, mapSize / 2, 1],
    ];
    for (const [w, d, x, z, rep] of walls) {
      const m = new Mesh(new BoxGeometry(w, wallH, d), wallMat(rep));
      m.position.set(x, wallH / 2, z);
      m.castShadow = true;
      scene.add(m);
    }

    // scene props
    for (const zone of world.zones) {
      for (const p of zone.scene.props) {
        const fp = p.solid;
        const model = createModel(p.sprite, fp, world.zones);
        const cx = p.x;
        let cz = p.y - 2;
        if (p.angle !== undefined) cz = p.y;
        else if (fp?.kind === "rect") cz = p.y - fp.h / 2;
        else if (fp?.kind === "circle") cz = p.y - fp.r;
        model.position.set(cx, 0, cz);
        model.userData.baseY = 0;
        this.snapped.push({ obj: model, x: cx, z: cz });
        if (p.angle !== undefined) model.rotation.y = -p.angle;
        const k = VISUAL_SCALE[p.sprite.split("-")[0]] ?? 1; // small props are drawn a bit oversized so they read at this resolution
        model.scale.setScalar(k);
        model.userData.zoneId = zone.id;
        scene.add(model);
        this.pickables.push(model);
        let list = this.zoneModels.get(zone.id);
        if (!list) this.zoneModels.set(zone.id, (list = []));
        list.push(model);
      }
    }

    // hover glow: one brightening overlay per project box, hidden until hovered
    for (const zone of world.zones) {
      const a = zone.scene.area;
      const glow = new Mesh(
        new PlaneGeometry(a.w - 2, a.h - 2),
        new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(a.x + a.w / 2, 0.12, a.y + a.h / 2);
      glow.renderOrder = 1;
      glow.visible = false;
      glow.userData.noOutline = true;
      scene.add(glow);
      this.zoneGlow.set(zone.id, glow);
    }

    // yard tire piles
    for (const item of world.items) {
      const t = tireModel();
      const tx = item.tx * TILE + TILE / 2;
      const tz = item.ty * TILE + TILE / 2;
      t.position.set(tx, 0, tz);
      this.snapped.push({ obj: t, x: tx, z: tz });
      scene.add(t);
    }

    this.carModel = roadCarModel();
    this.carModel.scale.setScalar(1.2);
    this.carModel.position.set(world.start.x, 0, world.start.y);
    scene.add(this.carModel);
  }

  /** Give every mesh a unique flat color for the outline pass. */
  private assignIds() {
    // one outline id per top-level model (a cone's base, body and band share an id), so small props
    // are outlined around their silhouette only instead of turning black from internal edges
    let next = 1;
    const perRoot = new Map<Object3D, MeshBasicMaterial>();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !(m.material as Material)) return;
      if (m.userData.noOutline || m.material instanceof ShadowMaterial) return;
      let root: Object3D = m;
      while (root.parent && root.parent !== this.scene) root = root.parent;
      let mat = perRoot.get(root);
      if (!mat) {
        const n = next++;
        mat = new MeshBasicMaterial({ color: new Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255) });
        perRoot.set(root, mat);
      }
      this.idMaterials.set(m, mat);
    });
  }

  resize(innerW: number, innerH: number) {
    // whole-number upscale: render at 1/k of the screen's device pixels, then show each pixel as k device pixels
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(PIXEL_CSS, Math.round(PIXEL_CSS * dpr));
    this.width = Math.max(2, Math.ceil((innerW * dpr) / k));
    this.height = Math.max(2, Math.ceil((innerH * dpr) / k));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.colorTarget.setSize(this.width, this.height);
    this.idTarget.setSize(this.width, this.height);
    this.quad.uniforms.texel.value.set(1 / this.width, 1 / this.height);
    this.fitCamera();
    this.applySnap();
  }

  /** Orthographic camera at a fixed tilt, scaled so the whole map fits and centered on it. */
  private fitCamera() {
    const { camera, center, mapSize } = this;
    const dir = new Vector3(Math.sin(YAW) * Math.cos(TILT), Math.sin(TILT), Math.cos(YAW) * Math.cos(TILT));
    camera.position.copy(center).addScaledVector(dir, CAM_DIST);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const y of [0, 45]) {
      for (const x of [0, mapSize]) {
        for (const z of [0, mapSize]) {
          const v = new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
      }
    }
    this.wpp = Math.max((maxX - minX) / (this.width * 0.98), (maxY - minY) / (this.height * 0.98));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camera.left = cx - (this.width * this.wpp) / 2;
    camera.right = cx + (this.width * this.wpp) / 2;
    camera.top = cy + (this.height * this.wpp) / 2;
    camera.bottom = cy - (this.height * this.wpp) / 2;
    camera.updateProjectionMatrix();
  }

  /** Render-pixel coordinates (float) of a world point. */
  toPixel(x: number, y: number, z: number): { px: number; py: number } {
    const v = new Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    return { px: (v.x - this.camera.left) / this.wpp, py: (this.camera.top - v.y) / this.wpp };
  }

  /** Move a world point (at height `y`) to the nearest whole render pixel; returns the new world x/z. */
  snapXZ(x: number, y: number, z: number): { x: number; z: number } {
    const cam = this.camera;
    const v = new Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const sx = cam.left + Math.round((v.x - cam.left) / this.wpp) * this.wpp;
    const sy = cam.top - Math.round((cam.top - v.y) / this.wpp) * this.wpp;
    // un-project: p = camPos + right*sx + up*sy + back*t, with t chosen so the world height stays `y`
    const m = cam.matrixWorld.elements;
    const right = new Vector3(m[0], m[1], m[2]);
    const up = new Vector3(m[4], m[5], m[6]);
    const back = new Vector3(m[8], m[9], m[10]);
    const pos = new Vector3(m[12], m[13], m[14]);
    const t = (y - pos.y - right.y * sx - up.y * sy) / back.y;
    const p = pos.addScaledVector(right, sx).addScaledVector(up, sy).addScaledVector(back, t);
    return { x: p.x, z: p.z };
  }

  /** Put every static model on the pixel board (identical props then rasterize identically). */
  private applySnap() {
    for (const s of this.snapped) {
      const p = this.snapXZ(s.x, 0, s.z);
      s.obj.position.x = p.x;
      s.obj.position.z = p.z;
    }
  }

  /** Hover effect for one project box, `amount` 0..1: its props rise and its ground brightens. Works for any zone. */
  setHover(zoneId: string, amount: number) {
    const cfg = this.world.zones.find((z) => z.id === zoneId)?.scene.hover;
    // lift in whole rendered pixels: one pixel of screen height is wpp / up.y in world height
    const upY = this.camera.matrixWorld.elements[5] || Math.cos(TILT);
    const pixels = Math.round(amount * (cfg?.lift ?? LIFT));
    const height = (pixels * this.wpp) / upY;
    for (const m of this.zoneModels.get(zoneId) ?? []) m.position.y = (m.userData.baseY ?? 0) + height;
    // the ground glow moves in the same whole steps as the lift: a smoothly fading overlay re-rounds every
    // ground pixel on a different frame, which reads as individual pixels flickering
    const liftPixels = cfg?.lift ?? LIFT;
    const stepped = liftPixels > 0 ? pixels / liftPixels : amount;
    const glow = this.zoneGlow.get(zoneId);
    if (glow) {
      glow.visible = stepped > 0.001;
      (glow.material as MeshBasicMaterial).opacity = stepped * (cfg?.glow ?? GLOW);
    }
  }

  /** Where a click lands: the world position (px) and the zone whose model was hit, if any. */
  pick(clientX: number, clientY: number): { x: number; y: number; zoneId?: string } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    const hit = this.raycaster.intersectObjects(this.pickables, true)[0];
    let zoneId: string | undefined;
    for (let o: Object3D | null = hit?.object ?? null; o; o = o.parent) {
      if (o.userData.zoneId) {
        zoneId = o.userData.zoneId;
        break;
      }
    }
    return { x: point.x, y: point.z, zoneId };
  }

  /** Screen position (css px) of a world point at the given height. */
  project(x: number, height: number, z: number): { x: number; y: number } {
    const v = new Vector3(x, height, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  draw(car: Car, marker: Marker | null, time: number) {
    const { renderer } = this;
    const carPos = this.snapXZ(car.x, 0, car.y);
    this.carModel.position.set(carPos.x, 0, carPos.z);
    const step = (Math.PI * 2) / CAR_STEPS;
    this.carModel.rotation.y = -Math.round(car.heading / step) * step;

    // path dots marching toward the goal
    const pts = [{ x: car.x, y: car.y }, ...car.path];
    const m4 = new Matrix4();
    let n = 0;
    if (car.path.length) {
      const phase = (time * 24) % 10;
      let acc = 0;
      for (let i = 1; i < pts.length && n < 160; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const first = (10 - ((acc - phase + 10) % 10)) % 10;
        for (let d = first; d < len && n < 160; d += 10) {
          const t = d / len;
          const dp = this.snapXZ(a.x + (b.x - a.x) * t, 0.3, a.y + (b.y - a.y) * t);
          m4.makeTranslation(dp.x, 0.3, dp.z);
          this.dots.setMatrixAt(n++, m4);
        }
        acc += len;
      }
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;

    this.markerMesh.visible = !!marker && Math.floor(time * 4) % 2 === 0;
    if (marker) {
      const mp = this.snapXZ(marker.x, 0.4, marker.y);
      this.markerMesh.position.set(mp.x, 0.4, mp.z);
    }

    // 1) color
    renderer.setRenderTarget(this.colorTarget);
    renderer.render(this.scene, this.camera);

    // 2) object ids (swap in flat id materials)
    const original = new Map<Mesh, Material | Material[]>();
    const hidden: Object3D[] = [];
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (m.material instanceof ShadowMaterial) {
        m.visible = false;
        hidden.push(m);
        return;
      }
      original.set(m, m.material);
      m.material = this.idMaterials.get(m) ?? this.blackId;
    });
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.idTarget);
    renderer.setClearColor(new Color("#000000"));
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(new Color("#16161d"));
    renderer.shadowMap.autoUpdate = true;
    for (const [m, mat] of original) m.material = mat;
    for (const o of hidden) o.visible = true;

    // 3) composite with outlines
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.renderer.dispose();
    this.colorTarget.dispose();
    this.idTarget.dispose();
  }
}
