// CI record smoke: downloads the pinned chrome-headless-shell (first use,
// ~120 MB; honors GALCODE_CHROME_DOWNLOAD_BASE_URL for mirrors), records a 5s
// animated data:-URL page — deliberately NOT WebGAL, the vendored engine is
// too heavy for CI — and asserts a valid h264/yuv420p mp4 plus zero leftover
// browser processes.
//
// Skip switch: GALCODE_CI_SKIP_RECORD_SMOKE=1 (documented in ci.yml).
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.GALCODE_CI_SKIP_RECORD_SMOKE === "1") {
  console.log("ci-record-smoke: skipped via GALCODE_CI_SKIP_RECORD_SMOKE=1");
  process.exit(0);
}

const { ensureRecorderBrowser, launchRecorderBrowser, closeBrowserTree, recorderCacheDir } = await import(path.join(ROOT, "src", "recorder", "browser.mjs"));
const { recordRealtime } = await import(path.join(ROOT, "src", "recorder", "realtime.mjs"));

const PAGE = "data:text/html," + encodeURIComponent(`<!doctype html><html><body style="margin:0">
<canvas id="c" width="640" height="360"></canvas>
<script>
  const ctx = document.getElementById("c").getContext("2d");
  let n = 0;
  function draw() {
    n += 1;
    ctx.fillStyle = "#101018"; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#f48fb1"; ctx.fillRect((n * 9) % 640, 140, 60, 60);
    ctx.fillStyle = "#fff"; ctx.font = "28px sans-serif"; ctx.fillText("galcode smoke " + n, 20, 40);
    requestAnimationFrame(draw);
  }
  draw();
</script></body></html>`);

function fail(message) {
  console.error(`ci-record-smoke FAILED: ${message}`);
  process.exit(1);
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-ci-record-"));
const out = path.join(tmp, "smoke.mp4");
let browser = null;
try {
  console.log("ci-record-smoke: ensuring recorder browser (downloads on first use)…");
  const { executablePath, buildId } = await ensureRecorderBrowser({ log: (line) => console.log(`[browser] ${line}`) });
  console.log(`ci-record-smoke: browser ${buildId} at ${executablePath}`);

  browser = await launchRecorderBrowser({ executablePath, mode: "realtime", width: 640, height: 360 });
  const stats = await recordRealtime({
    browser,
    url: PAGE,
    out,
    width: 640,
    height: 360,
    fps: 10,
    durationSec: 5,
    sceneDelayMs: 200,
    startDelayMs: 100,
    autoAdvanceIntervalMs: 0,
    log: (line) => console.log(`[record] ${line}`)
  });
  console.log(`ci-record-smoke: stats ${JSON.stringify({ frames: stats.frames, uniqueFrames: stats.uniqueFrames, wallSec: stats.wallSec })}`);
} finally {
  await closeBrowserTree(browser);
}

const stat = fssync.statSync(out, { throwIfNoEntry: false });
if (!stat || stat.size < 10000) fail(`output missing or suspiciously small: ${out} (${stat?.size ?? 0} bytes)`);
console.log(`ci-record-smoke: output ${stat.size} bytes`);

const ffprobe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,r_frame_rate", "-show_entries", "format=duration", "-of", "json", out], { encoding: "utf8" });
if (ffprobe.status !== 0) fail(`ffprobe failed: ${ffprobe.stderr || ffprobe.status}`);
const probe = JSON.parse(ffprobe.stdout);
const video = probe.streams?.find((s) => s.codec_type === "video");
if (!video || video.codec_name !== "h264") fail(`expected h264 video stream, got ${JSON.stringify(probe.streams)}`);
if (video.pix_fmt !== "yuv420p") fail(`expected yuv420p, got ${video.pix_fmt}`);
const duration = Number(probe.format?.duration || 0);
if (Math.abs(duration - 5) > 1) fail(`expected ~5s duration, got ${duration}`);
console.log(`ci-record-smoke: ffprobe OK — h264 ${video.pix_fmt} ${video.r_frame_rate} ${duration}s`);

if (process.platform !== "win32") {
  await new Promise((resolve) => setTimeout(resolve, 500));
  let leftovers = "";
  try {
    leftovers = execFileSync("pgrep", ["-af", "galcode/browser/chrome-headless-shell"], { encoding: "utf8" }).trim();
  } catch { /* pgrep exit 1 = no match */ }
  if (leftovers) fail(`leftover browser processes:\n${leftovers}`);
}

await fs.rm(tmp, { recursive: true, force: true });
console.log(`ci-record-smoke: PASS (browser cache kept at ${recorderCacheDir()})`);
