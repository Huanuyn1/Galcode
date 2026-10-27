import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recorderBrowserStatus,
  recorderCacheDir,
  launchRecorderBrowser,
  closeBrowserTree
} from "../src/recorder/browser.mjs";
import { recordDeterministic } from "../src/recorder/deterministic.mjs";
import { recordVtPolicy } from "../src/recorder/vt-policy.mjs";
import { commandExists } from "../src/recorder/ffmpeg.mjs";

// Deterministic --stop-on-title: a title screen appearing mid-recording ends
// the capture cleanly (after the 10s virtual grace), finalizing the mp4 there.
// Skips unless the pinned browser is installed (hermetic CI).

const PAGE = "data:text/html," + encodeURIComponent(`<!doctype html><html><body style="margin:0">
<canvas id="c" width="320" height="180"></canvas>
<div id="title" class="Title_button" style="display:none;position:absolute;top:10px;left:10px;background:#fff;padding:20px;">开始游戏</div>
<script>
  const ctx = document.getElementById("c").getContext("2d");
  let n = 0;
  function draw() {
    n++;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "#f48fb1"; ctx.fillRect((n * 7) % 320, 60, 40, 40);
    requestAnimationFrame(draw);
  }
  draw();
  setTimeout(() => { document.getElementById("title").style.display = "block"; }, 2000);
</script></body></html>`);

describe("deterministic --stop-on-title", () => {
  it("stops pumping when the title screen appears and finalizes the video", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX-only probe");
    if (!(await commandExists("ffmpeg"))) return t.skip("ffmpeg not on PATH");
    const status = await recorderBrowserStatus();
    if (!status.installed || !status.ok) return t.skip("pinned browser not installed/probed — run `galcode record` once first");

    const manifest = JSON.parse(await fs.readFile(path.join(recorderCacheDir(), "manifest.json"), "utf8"));
    const executablePath = path.join(recorderCacheDir(), manifest.executablePath);
    const externalClock = manifest.deterministicDriver === "vt-policy";
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-stop-title-"));
    const out = path.join(tmp, "stop.mp4");
    const fps = 30;
    const browser = await launchRecorderBrowser({ executablePath, mode: externalClock ? "realtime" : "deterministic", width: 320, height: 180 });
    let stats;
    try {
      const record = externalClock ? recordVtPolicy : recordDeterministic;
      stats = await record({
        browser,
        url: PAGE,
        out,
        width: 320,
        height: 180,
        fps,
        durationSec: 20, // would be 600 frames without the watchdog
        sceneDelayMs: 500,
        stopOnTitle: true,
        autoAdvanceSec: 9999,
        autoAdvanceIntervalMs: 9999000,
        log: () => {}
      });
    } finally {
      await closeBrowserTree(browser);
    }

    // Watchdog grace is 10 virtual seconds; the title appears at 2s virtual,
    // so the capture stops at the first check past 10s (~330 frames), far
    // short of the full 600.
    expect(stats.stoppedOnTitle).toBe(true);
    expect(stats.frames).toBeGreaterThanOrEqual(300);
    expect(stats.frames).toBeLessThan(400);
    expect(stats.frames).toBeLessThan(600);
    expect(fssync.statSync(out).size).toBeGreaterThan(0);
    await fs.rm(tmp, { recursive: true, force: true });
  }, 180000);
});
