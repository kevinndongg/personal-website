// Turns the raw clips and stills in scratch_media/ (gitignored: the masters stay on this machine) into what the project pages
// use. Needs ffmpeg on the PATH. Run it again after changing a setting here:
//
//   node scripts/encode-media.mjs [path/to/scratch_media]
//
// Videos become small H.264 files with no audio (they autoplay muted, and the raw clips have people talking in the
// background) and a poster frame, both in public/media/<project>/, which is served as it is. Stills go in
// src/content/projects/, where Astro optimizes them. Everything is encoded once and committed: git keeps every version
// of a binary for good, so do not re-encode casually.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(process.argv[2] ?? resolve(ROOT, "scratch_media"));
const PUBLIC = resolve(ROOT, "public/media");
const STILLS = resolve(ROOT, "src/content/projects");

/** `at` is the second a poster is taken from; `filter` is an ffmpeg video filter chain (scaling, frame rate). */
const videos = [
  { from: "blucru/hang.MOV", to: "ftc/hang", filter: "scale=-2:1280", at: 1 }, // (ffmpeg applies the phone's rotation)
  { from: "blucru/object_detection_demo_1.mp4", to: "ftc/object-detection", filter: "scale=-2:960", at: 1 },
  { from: "cmr/skidpad_full_run_1.MOV", to: "cmr/skidpad-run", filter: "scale=-2:720", at: 3 },
  { from: "cmr/skidpad_full_run_vis.mp4", to: "cmr/skidpad-foxglove", filter: "fps=30", at: 2 }, // (a 120 fps screen recording)
];

/** Not encoded (the match plays from YouTube): only the frame its click-to-play facade shows. */
const posters = [{ from: "blucru/mti_submission.mp4", to: "ftc/match-poster.jpg", filter: "scale=1280:-2", at: 6 }];

/** `filter` for a still; the sketch's right half is empty black, so it is cropped to the drawing. */
const stills = [
  { from: "blucru/obj_det_camera.jpg", to: "ftc-object-detection-camera.jpg" },
  { from: "blucru/obj_det_topdown.png", to: "ftc-object-detection-topdown.jpg" },
  { from: "blucru/kinematics_sketch.jpg", to: "ftc-arm-kinematics.jpg", filter: "crop=1100:1080:0:0" },
];

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`ffmpeg failed (${run.error ?? `exit ${run.status}`}): ffmpeg ${args.join(" ")}`);
    process.exit(1);
  }
}

function input(from) {
  const file = resolve(SRC, from);
  if (!existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  return file;
}

function poster({ from, to, filter, at }, out) {
  mkdirSync(dirname(out), { recursive: true });
  const vf = filter ? ["-vf", filter] : [];
  ffmpeg(["-ss", String(at), "-i", input(from), ...vf, "-frames:v", "1", "-q:v", "4", out]);
}

for (const v of videos) {
  const out = resolve(PUBLIC, `${v.to}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  console.log(`${v.from} -> ${v.to}.mp4`);
  ffmpeg([
    ...["-i", input(v.from), "-vf", v.filter, "-an"],
    ...["-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
  ]);
  poster(v, resolve(PUBLIC, `${v.to}.jpg`));
}

for (const p of posters) {
  console.log(`${p.from} -> ${p.to}`);
  poster(p, resolve(PUBLIC, p.to));
}

for (const s of stills) {
  console.log(`${s.from} -> ${s.to}`);
  const vf = s.filter ? ["-vf", s.filter] : [];
  ffmpeg(["-i", input(s.from), ...vf, "-frames:v", "1", "-q:v", "3", resolve(STILLS, s.to)]);
}
