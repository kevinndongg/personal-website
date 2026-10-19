import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  ColorManagement,
  DirectionalLight,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Plane,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  Texture,
  UnsignedByteType,
  RGBAFormat,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { attachLap } from "./drive";
import { GROUND_MARGIN, buildGroundLayer } from "./ground";
import { createModel, tireModel, woodTexture } from "./models";
import type { AnimCtx } from "./models";
import { sceneryModel } from "./scenery";
import type { PropFocus, Rect } from "./scenes";
import { TILE } from "./world";
import type { World, Zone } from "./world";

// Colors are authored as plain sRGB hex values; lighting is tuned by eye, so no color management.
ColorManagement.enabled = false;

const TILT = (58 * Math.PI) / 180; // camera elevation above the horizon
const YAW = 0;
const CAM_DIST = 2500; // orthographic: distance only has to clear the scene
/** Cap on the device pixel ratio we render at (keeps big/hi-dpi screens fast). */
const MAX_RENDER_RATIO = 1.5;

// ------------------------------------------------------------------ "cinematic miniature" post pass
// A muted green/warm grade, vignette and film grain (heavier on the dark surface around the map), plus the focus blur.
const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
  uniform sampler2D tColor;
  uniform vec2 texel;
  uniform vec2 res;
  uniform vec4 focusRect; // focused project box in screen uv (minX, minY, maxX, maxY)
  uniform float focusAmt;
  uniform float pure; // 0 the graded picture .. 1 the scene's own pixels (zoomed right into a photo)
  uniform vec3 voidCol;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // the scene target is cleared to alpha 0 (premultiplied, so black); lay whatever is not covered over the dark surface
  vec3 scene(vec2 uv) {
    vec4 t = texture2D(tColor, uv);
    return t.rgb + (1.0 - t.a) * voidCol;
  }

  void main() {
    // focus: blur everything outside the chosen project box (nothing is blurred otherwise)
    float outside = max(max(focusRect.x - vUv.x, vUv.x - focusRect.z), max(focusRect.y - vUv.y, vUv.y - focusRect.w));
    float away = smoothstep(0.0, 0.16, outside) * focusAmt; // 0 inside the focused box, 1 well outside
    float blur = away * 3.2; // radius in pixels
    float bg = 1.0 - texture2D(tColor, vUv).a; // the scene clears to alpha 0, so this is how much of this pixel is the dark surface
    vec3 c = scene(vUv) * 0.2270270270;
    float w1 = 0.3162162162, w2 = 0.0702702703;
    vec2 o1 = vec2(0.0, 1.3846153846) * texel.y * blur;
    vec2 o2 = vec2(0.0, 3.2307692308) * texel.y * blur;
    c += scene(vUv + o1) * w1 + scene(vUv - o1) * w1;
    c += scene(vUv + o2) * w2 + scene(vUv - o2) * w2;

    // grade: slightly muted, warm highlights, cool green-teal shadows, a little contrast
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 0.86);
    c += vec3(0.010, 0.030, 0.026) * (1.0 - l);        // shadows lean green/teal
    c *= mix(vec3(1.0), vec3(1.07, 1.02, 0.90), l);     // highlights lean warm
    c = (c - 0.5) * 1.05 + 0.5;
    c *= 1.14; // a little exposure: the scene is lit low and warm, keep it from going muddy

    // focus: everything outside the chosen project quietly drops back
    c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.4 * away);
    c *= 1.0 - 0.42 * away;

    // vignette
    float v = smoothstep(1.05, 0.28, length((vUv - 0.5) * vec2(1.25, 1.0)));
    c *= mix(0.78, 1.0, v);

    // photo grain: fixed to the frame (it never moves). One render pixel, bell-shaped (-1..1); a touch stronger on the
    // dark surface around the map (bg = 1) than over the map itself (bg = 0). Subtle from afar, visible up close.
    vec2 px = floor(vUv * res);
    float grain = hash(px) + hash(px + 17.0) - 1.0;
    c += grain * 0.025 * bg;

    // zoomed right into a photo: no grade at all (no muting, tint, exposure, vignette or grain), so the pixels on screen
    // are the photo's own; only the dimming away from it stays, for the margins round it
    vec3 raw = scene(vUv) * (1.0 - 0.42 * away);
    gl_FragColor = vec4(mix(c, raw, pure), 1.0);
  }
`;

/**
 * How the map ends. "cut": a crisp straight edge with a soft shadow on the dark surface; "slab": the map is a raised
 * wooden board whose front side you can see; "fade": the ground dissolves into the grainy dark.
 */
export type EdgeMode = "cut" | "slab" | "fade";
const SLAB_H = 28; // thickness of the board in "slab" mode
const VOID = "#1d1e24"; // the dark surface the map sits on
const SHADOW_PAD = 3 * TILE; // how far the drop shadow's texture reaches past the map

/** Defaults for the hover effect on a project box (a scene can override via `scene.hover`). */
const LIFT = 4; // world px the props rise (scene.hover.lift is in these units now)
const GLOW = 0.12; // how much brighter the ground gets (white overlay opacity)

/** A prop's zoom-in behaviour (`Prop.focus`) with every field filled in. */
interface ResolvedFocus {
  sx: number;
  sy: number;
  sz: number;
  dx: number;
  dz: number;
}

function resolveFocus(f: PropFocus): ResolvedFocus {
  const sy = f.scale ?? 1;
  return { sx: f.sx ?? sy, sy, sz: f.sz ?? sy, dx: f.dx ?? 0, dz: f.dz ?? 0 };
}

const VISUAL_SCALE: Record<string, number> = {
  cone: 1.3,
  person: 1.5,
  battery: 1.5,
  laptop: 1.6,
  tirestack: 1.4,
  formula: 0.83, // about half the track width, so it sits comfortably inside the bay and the lane
  lidar: 2.0,
  estop: 2.3,
  extinguisher: 2.8,
  grill: 1.2,
  cook: 1.5,
  sit: 1.5,
  cart: 2.0,
};

function dappleTexture(): CanvasTexture {
  // soft dark-green blobs, like light filtering through leaves; tiles seamlessly enough at low opacity
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 46; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 12 + rand() * 26;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, "rgba(10,28,16,0.55)");
        g.addColorStop(1, "rgba(10,28,16,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** A soft dark blob (for a drop shadow): a blurred rectangle `inner` units wide inside a `total`-unit square. */
function blurredRectTexture(total: number, inner: number, blur: number): CanvasTexture {
  const size = 512;
  const k = size / total;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  // shadowBlur only blurs the shadow, so draw the rectangle far off-canvas and cast its shadow back in
  const far = size * 4;
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = far;
  const o = ((total - inner) / 2) * k;
  ctx.fillRect(o - far, o, inner * k, inner * k);
  return new CanvasTexture(c);
}

/** Alpha mask for the "fade" mode: opaque over the map, falling to transparent across the margin around it. */
function fadeMaskTexture(total: number, inner: number): CanvasTexture {
  const size = 512;
  const k = size / total;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const far = size * 4;
  const margin = (total - inner) / 2;
  // a white rectangle reaching halfway into the margin, blurred so it is fully opaque over the map and gone at the end
  const grow = margin * 0.5;
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = margin * 0.6 * k;
  ctx.shadowOffsetX = far;
  const o = (margin - grow) * k;
  const s = (inner + grow * 2) * k;
  ctx.fillRect(o - far, o, s, s);
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export class Renderer3D {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  private renderer: WebGLRenderer;
  private colorTarget: WebGLRenderTarget;
  private quadScene = new Scene();
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: ShaderMaterial;
  private raycaster = new Raycaster();
  private groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private center: Vector3;
  private pickables: Object3D[] = [];
  private zoneModels = new Map<string, Object3D[]>();
  private zoneGlow = new Map<string, Mesh>();
  /** Per-model animation callbacks (see `userData.animate` in models.ts) grouped by zone. */
  private animators: { fn: (c: AnimCtx) => void; zoneId: string }[] = [];
  /** Props that grow and move while their project is zoomed into (`Prop.focus`), with the placement they start from. */
  private focusProps: {
    model: Object3D;
    zoneId: string;
    wide: ResolvedFocus;
    tall: ResolvedFocus;
    baseScale: number;
    x: number;
    z: number;
  }[] = [];
  private zoneFocus = new Map<string, number>(); // per project, 0..1, eased in step with the camera
  /** A portrait screen: projects that have a stacked layout for it use that when zoomed in (see `Scene.focusAreaTall`). */
  private tall = false;
  /** Everything that is part of the map. It scales up about a project while that project is zoomed into (`Scene.zoom`). */
  private root = new Group();
  private mapZoom = { x: 0, z: 0, scale: 1 };
  private hoverAmount = new Map<string, number>();
  private frozenT = new Map<string, number>();
  private reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private wpp = 1; // world units per rendered pixel (changes while the camera zooms)
  // camera framing: `base` fits the whole map, `view` is what is on screen, `target` is where it is easing to
  private base = { wpp: 1, left: 0, top: 0 };
  private view = { wpp: 1, left: 0, top: 0 };
  private target = { wpp: 1, left: 0, top: 0 };
  private focused: { zoneId: string; panel: "left" | "right" | "bottom"; frac: number } | null = null;
  private focusAmt = 0; // 0..1, eased: how strongly the rest of the map is dimmed/blurred
  /**
   * Zoomed into something on the focused project (world points to frame), rather than the project as a whole. `normal`
   * is the way the points face: the camera looks along it, so what it shows is square-on, not foreshortened.
   */
  private focusPts: { zoneId: string; points: Vector3[]; fill: number; normal: Vector3 } | null = null;
  /** Which way the camera looks from (a unit vector from the map's centre to the camera): the map's tilt, or square-on. */
  private baseDir = new Vector3(0, 1, 0);
  private camDir = new Vector3(0, 1, 0);
  private targetDir = new Vector3(0, 1, 0);
  /** A camera used only to work out view matrices for an orientation the camera has not got to yet. */
  private scratchCam = new OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  private pureAmt = 0; // 0..1, eased: how much of the grade is skipped (it is, zoomed right into a photo)
  private lastTime = 0;
  private focusRect = new Vector4(0, 0, 0, 0);
  private dapple: CanvasTexture;
  private mapSize: number;
  private edge: EdgeMode = "cut";
  private groundMesh!: Mesh;
  private catcherMesh!: Mesh;
  private leavesMesh!: Mesh;
  private groundTex!: CanvasTexture;
  private edgeMask!: CanvasTexture;
  private edgeShadow!: Mesh;
  private slab!: Mesh;
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
    // a material may carry its own clipping planes (the light table's film is cut off at the plate while it slides)
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // alpha 0 marks "nothing drawn here" in the scene target; the post pass uses it to grain the surface around the map
    this.renderer.setClearColor(new Color(VOID), 0);

    this.colorTarget = new WebGLRenderTarget(1, 1, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      samples: 4, // multisampled, so edges are smooth rather than pixelated
    });

    this.quad = new ShaderMaterial({
      vertexShader: POST_VS,
      fragmentShader: POST_FS,
      uniforms: {
        tColor: { value: this.colorTarget.texture },
        texel: { value: new Vector2(1, 1) },
        res: { value: new Vector2(1, 1) },
        focusRect: { value: new Vector4(0, 0, 0, 0) },
        focusAmt: { value: 0 },
        pure: { value: 0 },
        voidCol: { value: new Color(VOID) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.quad));

    this.dapple = dappleTexture();
    this.buildScene();
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("edge") : null;
    this.setEdge(q === "slab" || q === "fade" ? q : "cut");
  }

  private buildScene() {
    const { scene, world, mapSize } = this;

    // low warm sun from the front-left (long soft shadows toward the back-right) plus a cool sky fill
    scene.add(new HemisphereLight("#d8e4ff", "#8d826f", 0.95));
    scene.add(new AmbientLight("#ffffff", 0.22));
    const sun = new DirectionalLight("#ffd9a6", 2.4);
    sun.position.set(mapSize / 2 - 420, 300, mapSize / 2 + 380);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.radius = 4;
    const cam = sun.shadow.camera;
    cam.left = -680;
    cam.right = 680;
    cam.top = 680;
    cam.bottom = -680;
    cam.near = 50;
    cam.far = 1700;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);

    // everything below belongs to the map and goes in `map`, which is what scales when a project is zoomed into
    const map = this.root;
    scene.add(map);

    // ground: the 2D floor drawing as a smooth texture, a shadow-catching overlay and drifting leaf-shade
    // (the texture also holds a margin of plain asphalt past the map, which only "fade" mode reveals)
    const tex = new CanvasTexture(buildGroundLayer(world));
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    this.groundTex = tex;
    const ground = new Mesh(new PlaneGeometry(mapSize, mapSize), new MeshBasicMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.copy(this.center);
    ground.renderOrder = -1;
    map.add(ground);
    this.groundMesh = ground;
    const shadowCatcher = new Mesh(new PlaneGeometry(mapSize, mapSize), new ShadowMaterial({ color: "#0b1220", opacity: 0.4 }));
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.set(this.center.x, 0.05, this.center.z);
    shadowCatcher.receiveShadow = true;
    map.add(shadowCatcher);
    this.catcherMesh = shadowCatcher;
    const leaves = new Mesh(
      new PlaneGeometry(mapSize, mapSize),
      new MeshBasicMaterial({ map: this.dapple, transparent: true, opacity: 0.34, depthWrite: false })
    );
    leaves.rotation.x = -Math.PI / 2;
    leaves.position.set(this.center.x, 0.08, this.center.z);
    leaves.renderOrder = 0.5;
    map.add(leaves);
    this.leavesMesh = leaves;

    // scene props
    for (const zone of world.zones) {
      for (const p of zone.scene.props) {
        const fp = p.solid;
        const model = sceneryModel(p.sprite, fp, p, world.zones) ?? createModel(p.sprite, fp, world.zones);
        const cx = p.x;
        let cz = p.y - 2;
        if (p.angle !== undefined) cz = p.y;
        else if (fp?.kind === "rect") cz = p.y - fp.h / 2;
        else if (fp?.kind === "circle") cz = p.y - fp.r;
        model.position.set(cx, p.elevation ?? 0, cz);
        model.userData.baseY = p.elevation ?? 0;
        if (p.angle !== undefined) model.rotation.y = -p.angle;
        model.scale.setScalar(VISUAL_SCALE[p.sprite.split("-")[0]] ?? 1);
        if (p.focus) {
          const wide = resolveFocus(p.focus);
          this.focusProps.push({
            model,
            zoneId: zone.id,
            wide,
            tall: p.focus.tall ? resolveFocus(p.focus.tall) : wide,
            baseScale: model.scale.x,
            x: model.position.x,
            z: model.position.z,
          });
        }
        model.userData.zoneId = zone.id;
        model.userData.sprite = p.sprite;
        if (p.drive) attachLap(model, p.drive);
        model.traverse((o) => {
          if (typeof o.userData.animate === "function") this.animators.push({ fn: o.userData.animate, zoneId: zone.id });
        });
        map.add(model);
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
        new MeshBasicMaterial({ color: "#fff3d6", transparent: true, opacity: 0, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(a.x + a.w / 2, 0.12, a.y + a.h / 2);
      glow.renderOrder = 1;
      glow.visible = false;
      map.add(glow);
      this.zoneGlow.set(zone.id, glow);
    }

    // yard tire piles
    for (const item of world.items) {
      const t = tireModel();
      t.position.set(item.tx * TILE + TILE / 2, 0, item.ty * TILE + TILE / 2);
      map.add(t);
    }

    // everything that is solid casts and receives soft shadows
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && !(m.material instanceof ShadowMaterial) && m !== ground && m !== leaves) {
        if (m.castShadow === undefined) m.castShadow = true;
      }
    });

    // ---- the edge of the board: drop shadow, wooden slab, fade mask (setEdge picks which are used)
    const total = mapSize + 2 * SHADOW_PAD;
    const shadow = new Mesh(
      new PlaneGeometry(total, total),
      new MeshBasicMaterial({ map: blurredRectTexture(total, mapSize, 26), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = -2;
    shadow.castShadow = false;
    map.add(shadow);
    this.edgeShadow = shadow;

    const wood = woodTexture();
    wood.wrapS = RepeatWrapping;
    wood.repeat.set(3, 1);
    const side = new MeshLambertMaterial({ map: wood });
    const slab = new Mesh(new BoxGeometry(mapSize, SLAB_H, mapSize), side);
    slab.position.set(this.center.x, -SLAB_H / 2 - 0.05, this.center.z);
    slab.castShadow = false;
    map.add(slab);
    this.slab = slab;

    this.edgeMask = fadeMaskTexture(mapSize + 2 * GROUND_MARGIN, mapSize);
  }

  /** Switch how the map ends (see EdgeMode). Safe to call at any time. */
  setEdge(mode: EdgeMode) {
    this.edge = mode;
    const { mapSize } = this;
    const fade = mode === "fade";
    const total = mapSize + 2 * GROUND_MARGIN;

    // ground, shadow catcher and leaf shade: exactly the map, or the map plus its fade margin
    const k = fade ? total / mapSize : 1;
    for (const m of [this.groundMesh, this.catcherMesh, this.leavesMesh]) m.scale.set(k, k, 1);
    this.groundTex.repeat.setScalar(fade ? 1 : mapSize / total);
    this.groundTex.offset.setScalar(fade ? 0 : GROUND_MARGIN / total);
    for (const m of [this.groundMesh, this.leavesMesh]) {
      const mat = m.material as MeshBasicMaterial;
      mat.alphaMap = fade ? this.edgeMask : null;
      mat.transparent = fade || m === this.leavesMesh;
      mat.needsUpdate = true;
    }

    this.edgeShadow.visible = !fade;
    // the light is front-left, so the shadow falls a little toward the back-right
    this.edgeShadow.position.set(this.center.x + 7, mode === "slab" ? -SLAB_H - 0.1 : -0.2, this.center.z - 7);
    this.slab.visible = mode === "slab";
    this.fitCamera();
  }

  resize(innerW: number, innerH: number) {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_RENDER_RATIO);
    this.width = Math.max(2, Math.round(innerW * ratio));
    this.height = Math.max(2, Math.round(innerH * ratio));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.colorTarget.setSize(this.width, this.height);
    this.quad.uniforms.texel.value.set(1 / this.width, 1 / this.height);
    this.quad.uniforms.res.value.set(this.width, this.height);
    this.tall = this.width < this.height * 0.9;
    this.fitCamera();
  }

  /** Orthographic camera at a fixed tilt, scaled so the whole map fits and centered on it. */
  private fitCamera() {
    const { camera, center, mapSize } = this;
    this.baseDir.set(Math.sin(YAW) * Math.cos(TILT), Math.sin(TILT), Math.cos(YAW) * Math.cos(TILT));
    const inv = this.viewInverse(this.baseDir);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    // room around the map for whatever the edge adds: the fade margin, the board's side, the drop shadow
    const pad = this.edge === "fade" ? GROUND_MARGIN : TILE * 1.25;
    for (const y of [this.edge === "slab" ? -SLAB_H : 0, 45]) {
      for (const x of [-pad, mapSize + pad]) {
        for (const z of [-pad, mapSize + pad]) {
          const v = new Vector3(x, y, z).applyMatrix4(inv);
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
    this.base = { wpp: this.wpp, left: camera.left, top: camera.top };
    this.camDir.copy(this.baseDir);
    this.targetDir.copy(this.baseDir);
    this.orient();
    this.retarget(true);
  }

  /** The world-to-view matrix of a camera looking at the map's centre from direction `dir` (without moving the camera). */
  private viewInverse(dir: Vector3) {
    const c = this.scratchCam;
    c.position.copy(this.center).addScaledVector(dir, CAM_DIST);
    c.lookAt(this.center);
    c.updateMatrixWorld(true);
    return c.matrixWorldInverse;
  }

  /** Points the camera along `camDir` (it always looks at the map's centre; the view window is what zooms and pans). */
  private orient() {
    const c = this.camera;
    c.position.copy(this.center).addScaledVector(this.camDir, CAM_DIST);
    c.lookAt(this.center);
    c.updateMatrixWorld(true);
  }

  /**
   * Zoom the camera onto a project box (or back out with null). `panel` is where the info panel sits and `frac` how much
   * of the screen it covers (0..1 of the width for left/right; the sheet's height for bottom).
   */
  focus(zoneId: string | null, panel: "left" | "right" | "bottom" = "right", frac = 0.4) {
    this.focused = zoneId ? { zoneId, panel, frac } : null;
    this.focusPts = null; // back to framing the whole project
    this.retarget(false);
  }

  /**
   * Frames these world points (a photo on the light table, say) as tightly as `fill` of the screen allows, while the
   * project is open; `null` goes back to framing the whole project. The camera eases there like it does for the project.
   */
  focusPoints(zoneId: string, points: Vector3[] | null, fill = 0.95) {
    if (!points || points.length < 4) {
      this.focusPts = null;
    } else {
      // the way the points face (the first corner, then the two next to it, span their plane): the camera will look along it
      const normal = points[1].clone().sub(points[0]).cross(points[3].clone().sub(points[0])).normalize();
      if (normal.y < 0) normal.negate();
      const ok = Number.isFinite(normal.x + normal.y + normal.z) && normal.lengthSq() > 0.5;
      this.focusPts = { zoneId, points, fill, normal: ok ? normal : this.baseDir.clone() };
    }
    this.retarget(false);
  }

  private retarget(snapNow: boolean) {
    const f = this.focused;
    // the direction the camera should end up looking from: the map's tilt, or square-on to what is being zoomed into
    this.targetDir.copy(f && this.focusPts && this.focusPts.zoneId === f.zoneId ? this.focusPts.normal : this.baseDir);
    if (!f) {
      this.target = { ...this.base };
    } else {
      const zone = this.world.zones.find((z) => z.id === f.zoneId);
      if (zone) {
        const a = this.focusFrame(zone);
        const pts = this.focusPts && this.focusPts.zoneId === f.zoneId ? this.focusPts : null;
        // framing is worked out for the camera's destination orientation, not the one it has now
        const inv = this.viewInverse(this.targetDir);
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        const take = (v: Vector3) => {
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        };
        if (pts) {
          for (const p of pts.points) take(p.clone().applyMatrix4(inv));
        } else {
          for (const y of [0, zone.scene.height ?? 26]) {
            for (const [x, z] of [
              [a.x, a.y],
              [a.x + a.w, a.y],
              [a.x, a.y + a.h],
              [a.x + a.w, a.y + a.h],
            ]) {
              take(new Vector3(x, y, z).applyMatrix4(inv));
            }
          }
        }
        // the part of the screen left over for the 3D view once the panel is open (a bottom sheet is nudged a little
        // down from the middle of what is left; with no sheet there is nothing to nudge for, and the framed area is
        // centred, so there is as much room above it as below)
        const free = 1 - f.frac;
        const region =
          f.panel === "bottom"
            ? { cx: 0.5, cy: free / 2 + (f.frac > 0 ? 0.02 : 0), w: 1, h: free }
            : f.panel === "right"
              ? { cx: free / 2, cy: 0.5, w: free, h: 1 }
              : { cx: 1 - free / 2, cy: 0.5, w: free, h: 1 };
        const fill = pts?.fill ?? zone.scene.focusFill ?? 0.82;
        const wpp = Math.min(
          this.base.wpp,
          Math.max((maxX - minX) / (this.width * region.w * fill), (maxY - minY) / (this.height * region.h * fill))
        );
        const vx = (minX + maxX) / 2;
        const vy = (minY + maxY) / 2;
        this.target = { wpp, left: vx - region.cx * this.width * wpp, top: vy + region.cy * this.height * wpp };
      }
    }
    if (snapNow) {
      this.view = { ...this.target };
      this.camDir.copy(this.targetDir);
      this.orient();
    }
    this.applyView();
  }

  private applyView() {
    const c = this.camera;
    this.wpp = this.view.wpp;
    c.left = this.view.left;
    c.right = this.view.left + this.width * this.view.wpp;
    c.top = this.view.top;
    c.bottom = this.view.top - this.height * this.view.wpp;
    c.updateProjectionMatrix();
  }

  /** Render-pixel coordinates (float) of a map point (the map may be scaled up: see `Scene.zoom`). */
  toPixel(x: number, y: number, z: number): { px: number; py: number } {
    const v = this.mapToWorld(new Vector3(x, y, z)).applyMatrix4(this.camera.matrixWorldInverse);
    return { px: (v.x - this.camera.left) / this.wpp, py: (this.camera.top - v.y) / this.wpp };
  }

  /** Dev probe: the numbers that drive the zoom (camera view, map scale, dim), to look for stalls and jumps in them. */
  debugView() {
    return { wpp: this.view.wpp, left: this.view.left, top: this.view.top, mapScale: this.mapZoom.scale, focus: this.focusAmt };
  }

  /** A project's whole-map zoom for this screen's shape, at full zoom: the point it grows about, and by how much. */
  private zoomOf(zone: Zone): { x: number; z: number; scale: number } {
    const zm = zone.scene.zoom;
    if (!zm) return { x: 0, z: 0, scale: 1 };
    return { x: zm.about.x, z: zm.about.y, scale: (this.tall ? zm.tall : undefined) ?? zm.scale };
  }

  /** Where a point of the map is in the world right now, with the map scaled up about the project being opened. */
  private mapToWorld(p: Vector3): Vector3 {
    const { x, z, scale } = this.mapZoom;
    p.x = x + (p.x - x) * scale;
    p.y *= scale;
    p.z = z + (p.z - z) * scale;
    return p;
  }

  /**
   * The rect the camera frames when zoomed into a project, for this screen's shape. It is in world coordinates once the
   * map has grown (a project with a `zoom` describes its zoomed-in layout that way).
   */
  private focusFrame(zone: Zone): Rect {
    const s = zone.scene;
    return (this.tall ? s.focusAreaTall : undefined) ?? s.focusArea ?? s.area;
  }

  /**
   * The same rect in map coordinates (what `pick` returns and what the project's own props are laid out in), which is
   * the zoomed framing shrunk back by the project's map zoom.
   */
  focusBox(zone: Zone): Rect {
    const r = this.focusFrame(zone);
    const { x, z, scale } = this.zoomOf(zone);
    if (scale === 1) return r;
    return { x: x + (r.x - x) / scale, y: z + (r.y - z) / scale, w: r.w / scale, h: r.h / scale };
  }

  /** Sends the zone's car round its lap. False when it is already out, or there is none (or motion is reduced). */
  driveCar(zoneId: string): boolean {
    if (this.reduceMotion) return false;
    for (const m of this.zoneModels.get(zoneId) ?? []) {
      if (typeof m.userData.drive === "function" && m.userData.drive()) return true;
    }
    return false;
  }

  /** Hover effect for one project box, `amount` 0..1: its props rise and its ground brightens. Works for any zone. */
  setHover(zoneId: string, amount: number) {
    this.hoverAmount.set(zoneId, amount);
    const cfg = this.world.zones.find((z) => z.id === zoneId)?.scene.hover;
    const lift = (cfg?.lift ?? LIFT / 2) * 2; // scene overrides were written in "pixels" (~2 world px each)
    for (const m of this.zoneModels.get(zoneId) ?? []) {
      if (m.userData.flat) continue; // a mat lying on the ground does not rise with the rest
      m.position.y = (m.userData.baseY ?? 0) + amount * lift;
    }
    const glow = this.zoneGlow.get(zoneId);
    if (glow) {
      glow.visible = amount > 0.001;
      (glow.material as MeshBasicMaterial).opacity = amount * (cfg?.glow ?? GLOW);
    }
  }

  /**
   * Where a click lands: the map position (px), and the zone and prop (sprite id) whose model was hit, if any, and the
   * named part of the prop (`userData.part`, e.g. a button on it) when the hit was on one.
   */
  pick(
    clientX: number,
    clientY: number
  ): {
    x: number;
    y: number;
    zoneId?: string;
    propId?: string;
    partId?: string;
    slot?: number;
    uv?: { x: number; y: number };
  } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    // three.js raycasts straight through `visible = false`, so a hidden or purely decorative mesh (a glow plane, a hover
    // ring) would otherwise be what the pointer "hits" and block the real thing under it
    const hit = this.raycaster.intersectObjects(this.pickables, true).find((h) => {
      if (h.object.userData.noPick) return false;
      for (let o: Object3D | null = h.object; o; o = o.parent) if (!o.visible) return false;
      return true;
    });
    let zoneId: string | undefined;
    let propId: string | undefined;
    let partId: string | undefined;
    let slot: number | undefined;
    for (let o: Object3D | null = hit?.object ?? null; o; o = o.parent) {
      if (!partId && o.userData.part) partId = o.userData.part;
      if (slot === undefined && typeof o.userData.slot === "number") slot = o.userData.slot;
      if (o.userData.zoneId) {
        zoneId = o.userData.zoneId;
        propId = o.userData.sprite;
        break;
      }
    }
    // the ground point is in the world; hand it back in map coordinates, so it can be tested against the project boxes
    const { x: zx, z: zz, scale } = this.mapZoom;
    // `slot` is which numbered place on the prop was hit (e.g. which photo of the light table's page)
    return {
      x: zx + (point.x - zx) / scale,
      y: zz + (point.z - zz) / scale,
      zoneId,
      propId,
      partId,
      slot,
      uv: hit?.uv ? { x: hit.uv.x, y: hit.uv.y } : undefined,
    };
  }

  /** Screen position (css px) of a map point at the given height. */
  project(x: number, height: number, z: number): { x: number; y: number } {
    const v = this.mapToWorld(new Vector3(x, height, z)).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  draw(time: number) {
    const { renderer } = this;

    // ease the camera toward its target (a gentle exponential approach: quick start, soft landing)
    const dt = Math.min(1 / 30, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const k = 1 - Math.exp(-dt * 6.5);
    const t = this.target;
    this.view.wpp += (t.wpp - this.view.wpp) * k;
    this.view.left += (t.left - this.view.left) * k;
    this.view.top += (t.top - this.view.top) * k;
    this.focusAmt += ((this.focused ? 1 : 0) - this.focusAmt) * k;
    // the camera turns to look square-on at what it is zoomed into (and back), at the same pace as it zooms
    this.camDir.lerp(this.targetDir, k).normalize();
    this.orient();
    this.pureAmt += ((this.focused && this.focusPts ? 1 : 0) - this.pureAmt) * k;
    this.applyView();

    // drifting leaf-shade (a slow breeze across the yard)
    if (!this.reduceMotion) {
      this.dapple.offset.set((time * 0.004) % 1, (time * 0.0022) % 1);
    }

    // how far into each project the camera is, per project (so one that is being left eases back while another opens)
    for (const zone of this.world.zones) {
      const cur = this.zoneFocus.get(zone.id) ?? 0;
      const goal = this.focused?.zoneId === zone.id ? 1 : 0;
      const next = cur + (goal - cur) * k;
      this.zoneFocus.set(zone.id, Math.abs(goal - next) < 0.001 ? goal : next);
    }
    // the whole map grows about the project being opened (the one furthest in, if two are easing past each other)
    let zoom = { x: 0, z: 0, scale: 1 };
    let furthest = 0;
    for (const zone of this.world.zones) {
      const full = this.zoomOf(zone);
      const amount = this.zoneFocus.get(zone.id) ?? 0;
      if (full.scale !== 1 && amount > furthest) {
        furthest = amount;
        zoom = { x: full.x, z: full.z, scale: 1 + (full.scale - 1) * amount };
      }
    }
    this.mapZoom = zoom;
    this.root.scale.setScalar(zoom.scale);
    this.root.position.set(zoom.x * (1 - zoom.scale), 0, zoom.z * (1 - zoom.scale));

    // props that grow with the zoom
    for (const f of this.focusProps) {
      const amount = this.zoneFocus.get(f.zoneId) ?? 0;
      const fx = this.tall ? f.tall : f.wide;
      f.model.scale.set(
        f.baseScale * (1 + (fx.sx - 1) * amount),
        f.baseScale * (1 + (fx.sy - 1) * amount),
        f.baseScale * (1 + (fx.sz - 1) * amount)
      );
      f.model.position.x = f.x + fx.dx * amount;
      f.model.position.z = f.z + fx.dz * amount;
    }
    // the hover glow grows from the project's box to the zoomed-in framing, so it still lies under everything
    for (const zone of this.world.zones) {
      const glow = this.zoneGlow.get(zone.id);
      if (!glow) continue;
      const a = zone.scene.area;
      // never smaller than the box itself: on a wide screen everything fits inside it and the glow just grows with the map
      const f = this.focusBox(zone);
      const x0 = Math.min(a.x, f.x);
      const y0 = Math.min(a.y, f.y);
      const b = { x: x0, y: y0, w: Math.max(a.x + a.w, f.x + f.w) - x0, h: Math.max(a.y + a.h, f.y + f.h) - y0 };
      const amount = this.zoneFocus.get(zone.id) ?? 0;
      glow.scale.set(1 + ((b.w - 2) / (a.w - 2) - 1) * amount, 1 + ((b.h - 2) / (a.h - 2) - 1) * amount, 1);
      glow.position.x = a.x + a.w / 2 + (b.x + b.w / 2 - (a.x + a.w / 2)) * amount;
      glow.position.z = a.y + a.h / 2 + (b.y + b.h / 2 - (a.y + a.h / 2)) * amount;
    }

    // animations
    const pixel = 0.7; // motion in the models is continuous now; this is just a small unit
    for (const a of this.animators) {
      const hover = this.hoverAmount.get(a.zoneId) ?? 0;
      const focus = this.zoneFocus.get(a.zoneId) ?? 0;
      const pause = this.world.zones.find((z) => z.id === a.zoneId)?.scene.animation?.pauseOnHover && hover > 0.5;
      if (!pause) this.frozenT.set(a.zoneId, time);
      a.fn({ t: this.reduceMotion ? 0 : (this.frozenT.get(a.zoneId) ?? time), hover, focus, pixel });
    }

    // where the focused project box sits on screen (uv), for the dim/blur outside it
    if (this.focused) {
      const zone = this.world.zones.find((z) => z.id === this.focused!.zoneId);
      if (zone) {
        const a = this.focusFrame(zone);
        const pts = this.focusPts && this.focusPts.zoneId === zone.id ? this.focusPts.points : null;
        let u0 = 1,
          v0 = 1,
          u1 = 0,
          v1 = 0;
        const take = (p: Vector3) => {
          const u = (p.x + 1) / 2;
          const v = (p.y + 1) / 2;
          u0 = Math.min(u0, u);
          v0 = Math.min(v0, v);
          u1 = Math.max(u1, u);
          v1 = Math.max(v1, v);
        };
        if (pts) {
          // zoomed into one thing on the project (a photo on the table): keep that sharp, and let the rest fall back
          for (const p of pts) take(p.clone().project(this.camera));
        } else {
          for (const y of [0, zone.scene.height ?? 26]) {
            for (const [x, z] of [
              [a.x, a.y],
              [a.x + a.w, a.y],
              [a.x, a.y + a.h],
              [a.x + a.w, a.y + a.h],
            ]) {
              take(new Vector3(x, y, z).project(this.camera));
            }
          }
        }
        this.focusRect.set(u0 - 0.01, v0 - 0.01, u1 + 0.01, v1 + 0.01);
      }
    }
    this.quad.uniforms.focusRect.value.copy(this.focusRect);
    this.quad.uniforms.focusAmt.value = this.focusAmt;
    // (snapped at the ends, so "none of the grade" really is none, not 99.9%)
    this.quad.uniforms.pure.value = this.pureAmt < 0.002 ? 0 : this.pureAmt > 0.998 ? 1 : this.pureAmt;

    // scene -> multisampled target, then the grade / grain pass to the screen
    renderer.setRenderTarget(this.colorTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  /** Puts a texture on the GPU now, instead of in the first frame that draws with it. */
  upload(texture: Texture) {
    this.renderer.initTexture(texture);
  }

  /**
   * Compiles the scene's shaders (in parallel, off the main thread, where the browser can) and then draws a frame, so that
   * the first one the viewer sees does not have to. Asynchronous: the page keeps painting while it compiles.
   */
  async warm() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    // (a frame between the compile and the first draw: the draw allocates the shadow map and the render targets)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
      setTimeout(resolve, 60);
    });
    this.draw(this.lastTime);
  }

  dispose() {
    this.renderer.dispose();
    this.colorTarget.dispose();
  }
}
