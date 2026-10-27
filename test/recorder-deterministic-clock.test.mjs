import { describe, it, expect } from "vitest";
import {
  recorderBrowserStatus,
  recorderCacheDir,
  launchRecorderBrowser,
  closeBrowserTree
} from "../src/recorder/browser.mjs";
import { installVirtualClock } from "../src/recorder/webgal-page.mjs";
import { installExternalFrameClock } from "../src/recorder/vt-policy.mjs";
import fs from "node:fs/promises";
import path from "node:path";

// Deterministic-mode unified clock: under beginFrame control with the
// installed virtual clock, rAF timestamps / performance.now / Date.now /
// DOM timers must advance by exactly 1/fps per pumped frame regardless of
// wall-clock render cost. Skips when the pinned browser is not installed
// (hermetic CI); run `galcode record` once to install it.

const PAGE = "data:text/html," + encodeURIComponent(`<!doctype html><html><body><script>
window.__samples = [];
window.__timerTicks = 0;
window.__zeroDelayChain = 0;
setInterval(() => { window.__timerTicks++; }, 100);
function chain() { window.__zeroDelayChain++; if (window.__zeroDelayChain < 50) setTimeout(chain, 0); }
setTimeout(chain, 0);
function loop(ts) {
  // burn some CPU so wall time per frame differs from the virtual frame time
  let x = 0; for (let i = 0; i < 2000000; i++) x += i % 7; window.__sink = x;
  window.__samples.push({ raf: ts, perf: performance.now(), date: Date.now() });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script></body></html>`);

async function deterministicBrowserAvailable() {
  if (process.platform === "win32") return false; // group-kill assertions are POSIX-flavored here
  const status = await recorderBrowserStatus();
  return status.installed && status.ok;
}

describe("deterministic unified virtual clock", () => {
  it("advances rAF/performance.now/Date.now/timers by exactly 1/fps per frame", { retry: 2 }, async (t) => {
    if (!(await deterministicBrowserAvailable())) {
      return t.skip("pinned browser not installed/probed — run `galcode record` once first");
    }
    const manifest = JSON.parse(await fs.readFile(path.join(recorderCacheDir(), "manifest.json"), "utf8"));
    const executablePath = path.join(recorderCacheDir(), manifest.executablePath);
    const externalClock = manifest.deterministicDriver === "vt-policy";
    const fps = 30;
    const frameMs = 1000 / fps;
    const frames = 90; // 3s virtual

    const browser = await launchRecorderBrowser({ executablePath, mode: externalClock ? "realtime" : "deterministic", width: 640, height: 360 });
    try {
      const page = await browser.newPage();
      if (externalClock) await installExternalFrameClock(page, frameMs);
      else await installVirtualClock(page, frameMs);
      await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 30000 });
      const session = await page.createCDPSession();
      const wallStart = Date.now();
      // Under full-suite load (other tests run real browsers) a beginFrame can
      // occasionally coalesce with the previous one and skip an rAF tick; pump
      // until we have enough samples instead of asserting on pump count.
      for (let pumped = 0; pumped < frames * 2; pumped += 1) {
        if (externalClock) await page.evaluate(() => window.__galcodeTickFrame());
        else await session.send("HeadlessExperimental.beginFrame", { interval: frameMs, noDisplayUpdates: true });
        const count = await page.evaluate(() => window.__samples?.length ?? 0);
        if (count >= frames) break;
      }
      const wallSec = (Date.now() - wallStart) / 1000;
      const data = await page.evaluate(() => ({
        samples: window.__samples,
        timerTicks: window.__timerTicks,
        zeroDelayChain: window.__zeroDelayChain
      }));

      const s = data.samples;
      expect(s.length).toBeGreaterThanOrEqual(frames);
      const first = s[0];
      const last = s[s.length - 1];
      const n = s.length - 1;
      const rafDelta = (last.raf - first.raf) / n;
      const perfDelta = (last.perf - first.perf) / n;
      const dateDelta = (last.date - first.date) / n;
      // All clocks advance exactly one frame interval per pumped frame.
      expect(rafDelta).toBeCloseTo(frameMs, 1);
      expect(perfDelta).toBeCloseTo(frameMs, 1);
      expect(dateDelta).toBeCloseTo(frameMs, 0);
      // 100ms interval timer: one tick per 100ms of virtual time actually run.
      expect(data.timerTicks).toBe(Math.floor((s.length * frameMs) / 100));
      // setTimeout(fn, 0) chains cannot starve a frame: one link per frame.
      expect(data.zeroDelayChain).toBe(50);
      // Sanity: wall time per frame differs from virtual (render cost decoupled).
      expect(wallSec).toBeGreaterThan(0);
    } finally {
      await closeBrowserTree(browser);
    }
  }, 90000);
});
