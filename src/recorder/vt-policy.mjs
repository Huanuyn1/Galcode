import { startMjpegEncoder, writeFrame, finishEncoder, abortEncoder } from "./ffmpeg.mjs";
import {
  installLanguagePreset,
  bodyText,
  isTitleVisible,
  clickElementByText,
  setVirtualClockScale,
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
// Frames arrive through Page.startScreencast by default; static frames reuse
// the previous image and Page.captureScreenshot remains a compatibility
// fallback. No begin-frame flags or virtual-time policy are required.

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
    let clockScale = 1;
    let nextTimerId = 1;
    const timers = new Map();
    let rafQueue = [];
    let nextRafId = 1;

    performance.now = () => perfBase + virtualMs;
    Date.now = () => dateBase + virtualMs;
    window.__galcodeVirtualNow = () => virtualMs;
    window.__galcodeSetClockScale = (value) => { clockScale = value > 0 ? 1 : 0; };

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
      virtualMs += frameMs * clockScale;
      const stamp = perfBase + virtualMs;
      if (clockScale > 0) {
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

async function startScreencastCapture(session, { width, height, quality, frameMs }) {
  const state = { delivered: 0, latest: null, waiters: [] };
  const onFrame = (event) => {
    state.delivered += 1;
    state.latest = event.data;
    session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    for (const waiter of state.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  };
  session.on("Page.screencastFrame", onFrame);
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1
  });
  return {
    get delivered() { return state.delivered; },
    async next(before) {
      if (state.delivered === before) {
        await new Promise((resolve) => {
          const waiter = { resolve, timer: null };
          waiter.timer = setTimeout(() => {
            state.waiters = state.waiters.filter((item) => item !== waiter);
            resolve();
          }, Math.max(60, frameMs * 4));
          state.waiters.push(waiter);
        });
      }
      return state.latest;
    },
    async stop() {
      session.off("Page.screencastFrame", onFrame);
      for (const waiter of state.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
      await session.send("Page.stopScreencast").catch(() => {});
    }
  };
}

export async function recordVtPolicy({
  browser,
  url,
  out,
  width,
  height,
  fps,
  durationSec,
  scriptTimed = false,
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
  const recordStarted = Date.now();
  const frameMs = 1000 / fps;
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const session = await page.createCDPSession();
  const profile = { tickMs: 0, captureMs: 0, decodeMs: 0, writeMs: 0 };
  let screencast = null;

  // Tick the page's clock by exactly one frame, then (optionally) capture.
  const pumpFrame = async (screenshot) => {
    try {
      const before = screencast?.delivered || 0;
      const tickStarted = performance.now();
      await page.evaluate(() => window.__galcodeTickFrame());
      profile.tickMs += performance.now() - tickStarted;
      if (!screenshot) return null;
      const captureStarted = performance.now();
      if (screencast) {
        const data = await screencast.next(before);
        profile.captureMs += performance.now() - captureStarted;
        if (data) return data;
      }
      const shot = await session.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: jpegQuality,
        captureBeyondViewport: false,
        optimizeForSpeed: true
      });
      profile.captureMs += performance.now() - captureStarted;
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

    if (!scriptTimed) {
      await startExternalAutoAdvance(page, autoAdvanceIntervalMs);
      await pump(Math.max(4, Math.round(fps)));
    }
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
    if (scriptTimed) {
      await setVirtualClockScale(page, 0);
      const warmupFrames = Math.max(2, Math.round(fps / 4));
      log(`external-clock: warming up ${warmupFrames} frames with story clock held, then waiting for assets`);
      await pump(warmupFrames);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.max(1000, sceneDelayMs) }).catch((error) => {
        log(`external-clock: asset wait ended early (${error.message}); starting with the story clock held no longer`);
      });
      await setVirtualClockScale(page, 1);
    } else {
      log(`external-clock: pumping ${settleFrames} settle frames (${sceneDelayMs} ms virtual)`);
      await pump(settleFrames);
    }

    if (process.env.GALCODE_VT_CAPTURE !== "screenshot") {
      screencast = await startScreencastCapture(session, { width, height, quality: jpegQuality, frameMs });
      log("external-clock: using screencast frame delivery");
    }
    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const encoder = startMjpegEncoder({ ffmpeg, out, fps, crf, log });
    let frames = 0;
    let stoppedOnTitle = false;
    const started = Date.now();
    try {
      while (frames < totalFrames && !shouldStop() && !stoppedOnTitle) {
        const data = await pumpFrame(true);
        if (!data) throw new Error("external-clock: Page.captureScreenshot returned no data");
        const decodeStarted = performance.now();
        const buffer = Buffer.from(data, "base64");
        profile.decodeMs += performance.now() - decodeStarted;
        const writeStarted = performance.now();
        await writeFrame(encoder, buffer);
        profile.writeMs += performance.now() - writeStarted;
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
    } finally {
      if (screencast) await screencast.stop();
    }
    const finalClock = await readExternalClock(page).catch(() => null);
    await page.close().catch(() => {});

    const result = await finishEncoder(encoder, { out });
    const wallSec = Math.max(0.001, (Date.now() - started) / 1000);
    log(`external-clock: captured ${frames}/${totalFrames} frames in ${wallSec.toFixed(2)}s wall time; virtual advances: ${finalClock?.advances ?? "?"}`);
    if (process.env.GALCODE_RECORD_PROFILE === "1") {
      log(`external-clock profile: init=${((started - recordStarted) / 1000).toFixed(2)}s tick=${(profile.tickMs / 1000).toFixed(2)}s capture=${(profile.captureMs / 1000).toFixed(2)}s decode=${(profile.decodeMs / 1000).toFixed(2)}s ffmpeg-write=${(profile.writeMs / 1000).toFixed(2)}s`);
    }
    if (result.partial) log(`ffmpeg exited with ${result.exitCode} but the output video exists — keeping it (partial success)`);
    return { frames, duplicatedFrames: 0, wallSec, effectiveFps: frames / wallSec, bytes: result.bytes, partial: result.partial, stoppedOnTitle, profile };
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}
