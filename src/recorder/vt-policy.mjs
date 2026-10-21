import { startMjpegEncoder, writeFrame, finishEncoder, abortEncoder } from "./ffmpeg.mjs";
import {
  installLanguagePreset,
  bodyText,
  isTitleVisible,
  clickElementByText,
  probePageCubismCore
} from "./webgal-page.mjs";
import { live2dCoreMismatchWarning } from "../live2d-compat.mjs";

// Deterministic recording via an externally-pumped in-page clock — the
// fallback driver for hosts where HeadlessExperimental.beginFrame traps the
// browser process (observed: chrome-headless-shell 131–158 on macOS 26 arm64
// dies with EXC_BREAKPOINT inside the beginFrame handler while the compositor
// itself is healthy and Page.captureScreenshot works fine).
//
// Emulation.setVirtualTimePolicy was measured NOT to drive rAF (ticks stall
// after the first few), so this driver goes one level lower: the page's whole
// clock (rAF queue, performance.now, Date.now, DOM timers) is virtualized
// in-page, and every frame is ticked explicitly from Node via CDP evaluate.
// Capture is Page.captureScreenshot per frame. No begin-frame flags, no
// virtual-time policy — only CDP calls that are alive on the affected hosts.

const TITLE_SELECTOR = ".Title_button, [class*=\"Title_button\"]";
const CANVAS_SELECTOR = "#pixiCanvas, canvas";
const LANGUAGE_CLICK_PATTERN = /简体中文|简体|中文|Chinese|CHS|日本語|English/i;
const START_CLICK_PATTERN = /开始游戏|继续游戏|COMMENCER|CONTINUER|开始|继续|START|CONTINUE/i;

// Same clock virtualization as installVirtualClock (webgal-page.mjs), but the
// frame tick is driven externally: rAF becomes a queue drained once per tick,
// and window.__galcodeTickFrame() is the entry point the driver calls each
// frame. Callbacks that re-register rAF land in the NEXT tick's queue, so a
// self-scheduling loop (PIXI ticker, our auto-advancer) cannot starve a frame.
export async function installExternalFrameClock(page, frameMs) {
  await page.evaluateOnNewDocument((frameMs) => {
    const realPerformanceNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);
    const perfBase = realPerformanceNow();
    const dateBase = realDateNow();

    let virtualMs = 0;
    let nextTimerId = 1;
    const timers = new Map();
    let rafQueue = [];
    let nextRafId = 1;

    performance.now = () => perfBase + virtualMs;
    Date.now = () => dateBase + virtualMs;
    window.__galcodeVirtualNow = () => virtualMs;

    window.requestAnimationFrame = (callback) => {
      const id = nextRafId++;
      rafQueue.push({ id, callback });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      rafQueue = rafQueue.filter((entry) => entry.id !== id);
    };

    window.setTimeout = (fn, delay = 0, ...args) => {
      const id = nextTimerId++;
      timers.set(id, { due: virtualMs + Math.max(0, Number(delay) || 0), fn, args, interval: 0 });
      return id;
    };
    window.setInterval = (fn, delay = 0, ...args) => {
      const id = nextTimerId++;
      const every = Math.max(1, Number(delay) || 0);
      timers.set(id, { due: virtualMs + every, fn, args, interval: every });
      return id;
    };
    window.clearTimeout = (id) => timers.delete(id);
    window.clearInterval = (id) => timers.delete(id);

    window.__galcodeTickFrame = () => {
      virtualMs += frameMs;
      const stamp = perfBase + virtualMs;
      // Timers first (they may schedule rAF), then drain this frame's rAF queue.
      for (const [id, timer] of [...timers]) {
        if (timer.due > virtualMs) continue;
        try {
          timer.fn(...timer.args);
        } catch (error) {
          console.error("[galcode external clock] timer callback failed:", error);
        }
        if (timer.interval) {
          timer.due += timer.interval;
          if (timer.due <= virtualMs) timer.due = virtualMs + timer.interval;
        } else {
          timers.delete(id);
        }
      }
      const queue = rafQueue;
      rafQueue = [];
      for (const { callback } of queue) {
        try {
          callback(stamp);
        } catch (error) {
          console.error("[galcode external clock] rAF callback failed:", error);
        }
      }
    };
  }, frameMs);
}

// Time-based auto-advancer for the external clock (performance.now is
// virtualized, so this cadence is fps-independent). Space goes out inside the
// tick so it lands between frames exactly like realtime mode.
export async function startExternalAutoAdvance(page, intervalMs) {
  await page.evaluate((interval) => {
    function sendKey() {
      const make = (type) => new KeyboardEvent(type, { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true });
      document.dispatchEvent(make("keydown"));
      document.dispatchEvent(make("keyup"));
    }
    window.__galcodeVirtualAdvances = window.__galcodeVirtualAdvances || 0;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      if (now - last >= interval) {
        last = now;
        window.__galcodeVirtualAdvances += 1;
        sendKey();
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }, Math.max(250, Number(intervalMs) || 4000)).catch(() => {});
}

export async function readExternalClock(page) {
  return await page.evaluate(() => ({
    virtualMs: window.__galcodeVirtualNow?.() ?? 0,
    advances: window.__galcodeVirtualAdvances || 0
  })).catch(() => ({ virtualMs: 0, advances: 0 }));
}

export async function recordVtPolicy({
  browser,
  url,
  out,
  width,
  height,
  fps,
  durationSec,
  ffmpeg = "ffmpeg",
  crf = 18,
  jpegQuality = 92,
  sceneDelayMs = 8000,
  autoAdvanceIntervalMs = 4000,
  requiredMocVersion = 0,
  stopOnTitle = false,
  shouldStop = () => false,
  log = () => {}
} = {}) {
  const frameMs = 1000 / fps;
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const session = await page.createCDPSession();

  // Tick the page's clock by exactly one frame, then (optionally) capture.
  const pumpFrame = async (screenshot) => {
    try {
      await page.evaluate(() => window.__galcodeTickFrame());
      if (!screenshot) return null;
      const shot = await session.send("Page.captureScreenshot", { format: "jpeg", quality: jpegQuality });
      return shot?.data ?? null;
    } catch (error) {
      throw new Error(`external-clock recording failed: ${error.message}`);
    }
  };
  const pump = async (frames) => {
    for (let i = 0; i < frames; i += 1) await pumpFrame(false);
  };
  const pumpUntil = async (predicate, maxFrames, label) => {
    for (let i = 0; i < maxFrames; i += 1) {
      await pumpFrame(false);
      if (await predicate()) return true;
    }
    const body = (await bodyText(page)).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`external-clock mode: timed out waiting for ${label} after ${maxFrames} frames. Body: ${body}`);
  };
  const isVisible = async (selector) => await page.evaluate((quoted) => {
    const element = document.querySelector(JSON.parse(quoted));
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, JSON.stringify(selector)).catch(() => false);
  const clickAt = async (x, y) => {
    await page.mouse.click(Math.round(x), Math.round(y)).catch(() => {});
  };

  try {
    await installLanguagePreset(page);
    await installExternalFrameClock(page, frameMs);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pump(Math.round(fps / 2));
      const text = await bodyText(page);
      if (!/LANGUAGE SELECT|语言选择|Language Select/i.test(text)) break;
      if (!(await clickElementByText(page, LANGUAGE_CLICK_PATTERN))) await clickAt(width * 0.11, height * 0.55);
      log("external-clock: selected language on WebGAL language screen");
    }

    await clickAt(width / 2, height / 2);
    await pumpUntil(
      async () => (await isVisible(TITLE_SELECTOR)) || (await isVisible(CANVAS_SELECTOR)),
      fps * 45,
      "title screen or stage canvas"
    );
    if (await isTitleVisible(page)) {
      await pump(Math.round(fps / 2));
      await page.keyboard.press("Space").catch(() => {});
      await pump(Math.max(2, Math.round(fps / 5)));
      if (!(await clickElementByText(page, START_CLICK_PATTERN))) await clickAt(width * 0.095, height * 0.26);
      await pump(Math.max(2, Math.round(fps / 5)));
      if (await isTitleVisible(page)) await clickAt(width * 0.095, height * 0.26);
    }

    await pumpUntil(() => isVisible(CANVAS_SELECTOR), fps * 45, "stage canvas");

    if (requiredMocVersion >= 5) {
      const latest = await probePageCubismCore(page);
      if (latest === null || latest < requiredMocVersion) {
        log(`WARNING: ${live2dCoreMismatchWarning(requiredMocVersion, latest)}`);
      }
    }

    // rAF liveness self-check: with the external clock, rAF ticks only inside
    // __galcodeTickFrame — this verifies the page actually consumes them.
    await startExternalAutoAdvance(page, autoAdvanceIntervalMs);
    await pump(Math.max(4, Math.round(fps)));
    const tickProbe = await page.evaluate(() => {
      window.__galcodeRafProbe = 0;
      window.requestAnimationFrame(() => { window.__galcodeRafProbe += 1; });
      return true;
    });
    await pumpFrame(false);
    const rafOk = await page.evaluate(() => window.__galcodeRafProbe === 1);
    if (!tickProbe || !rafOk) {
      throw new Error([
        "external-clock mode self-check failed: the in-page rAF queue did not drain on tick.",
        "Report the full log; do not work around with realtime."
      ].join(" "));
    }

    const settleFrames = Math.round((sceneDelayMs / 1000) * fps);
    log(`external-clock: pumping ${settleFrames} settle frames (${sceneDelayMs} ms virtual)`);
    await pump(settleFrames);

    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const encoder = startMjpegEncoder({ ffmpeg, out, fps, crf, log });
    let frames = 0;
    let stoppedOnTitle = false;
    const started = Date.now();
    try {
      while (frames < totalFrames && !shouldStop() && !stoppedOnTitle) {
        const data = await pumpFrame(true);
        if (!data) throw new Error("external-clock: Page.captureScreenshot returned no data");
        await writeFrame(encoder, Buffer.from(data, "base64"));
        frames += 1;

        if (stopOnTitle && frames % Math.max(1, Math.round(fps)) === 0 && frames * frameMs > 10000) {
          if (await isTitleVisible(page)) {
            stoppedOnTitle = true;
            log(`Title screen detected at ${(frames * frameMs / 1000).toFixed(1)}s virtual; stopping early (--stop-on-title)`);
          }
        }
      }
    } catch (error) {
      abortEncoder(encoder);
      throw error;
    }
    const finalClock = await readExternalClock(page).catch(() => null);
    await page.close().catch(() => {});

    const result = await finishEncoder(encoder, { out });
    const wallSec = Math.max(0.001, (Date.now() - started) / 1000);
    log(`external-clock: captured ${frames}/${totalFrames} frames in ${wallSec.toFixed(2)}s wall time; virtual advances: ${finalClock?.advances ?? "?"}`);
    if (result.partial) log(`ffmpeg exited with ${result.exitCode} but the output video exists — keeping it (partial success)`);
    return { frames, duplicatedFrames: 0, wallSec, effectiveFps: frames / wallSec, bytes: result.bytes, partial: result.partial, stoppedOnTitle };
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}
