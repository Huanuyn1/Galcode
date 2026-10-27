import { startMjpegEncoder, writeFrame, finishEncoder, abortEncoder } from "./ffmpeg.mjs";
import {
  installLanguagePreset,
  installVirtualClock,
  bodyText,
  isTitleVisible,
  clickElementByText,
  startVirtualAutoAdvance,
  readVirtualClock,
  setVirtualClockScale,
  probePageCubismCore
} from "./webgal-page.mjs";
import { live2dCoreMismatchWarning } from "../live2d-compat.mjs";

// Deterministic mode (experimental, --deterministic): chrome-headless-shell is
// launched with --enable-begin-frame-control et al., so the compositor only
// produces frames when we issue HeadlessExperimental.beginFrame. beginFrame
// alone does NOT virtualize the page's clocks (measured on 155: rAF timestamp,
// performance.now, Date.now, DOM timers all stay on the wall clock), so
// installVirtualClock unifies them on the frame counter — every pumped frame
// advances all of them by exactly 1/fps. Capture is the screenshot the
// beginFrame call hands back. <audio>/<video> stay frozen — fine, the
// soundtrack is post-mixed anyway.
//
// New Galcode scripts advance through their own timed text/wait performs.
// Legacy scripts keep the external rAF-counting Space advancer.

const TITLE_SELECTOR = ".Title_button, [class*=\"Title_button\"]";
const CANVAS_SELECTOR = "#pixiCanvas, canvas";
const LANGUAGE_CLICK_PATTERN = /简体中文|简体|中文|Chinese|CHS|日本語|English/i;
const START_CLICK_PATTERN = /开始游戏|继续游戏|COMMENCER|CONTINUER|开始|继续|START|CONTINUE/i;

export async function recordDeterministic({
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
  autoAdvanceSec = 4,
  requiredMocVersion = 0,
  stopOnTitle = false,
  shouldStop = () => false,
  log = () => {}
} = {}) {
  const frameMs = 1000 / fps;
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const session = await page.createCDPSession();

  const pumpFrame = async (screenshot) => {
    const params = screenshot
      ? { interval: frameMs, screenshot: { format: "jpeg", quality: jpegQuality } }
      : { interval: frameMs, noDisplayUpdates: true };
    try {
      return await session.send("HeadlessExperimental.beginFrame", params);
    } catch (error) {
      throw new Error([
        `HeadlessExperimental.beginFrame failed: ${error.message}.`,
        "If this is 'Target closed'/'Session closed', the browser died mid-record — galcode retries once with --no-sandbox automatically.",
        "Do NOT fall back to realtime for this; report the log if the retry also fails."
      ].join(" "));
    }
  };
  const pump = async (frames) => {
    for (let i = 0; i < frames; i += 1) await pumpFrame(null);
  };
  const pumpUntil = async (predicate, maxFrames, label) => {
    for (let i = 0; i < maxFrames; i += 1) {
      await pumpFrame(null);
      if (await predicate()) return true;
    }
    const body = (await bodyText(page)).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Deterministic mode: timed out waiting for ${label} after ${maxFrames} frames. Body: ${body}`);
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
    // Unified virtual clock BEFORE any page script: beginFrame controls when
    // rAF fires but not the clocks it reads — see installVirtualClock.
    // GALCODE_NO_VIRTUAL_CLOCK=1 is a debug escape hatch (A/B measurement).
    if (process.env.GALCODE_NO_VIRTUAL_CLOCK !== "1") {
      await installVirtualClock(page, frameMs);
    }
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // LANGUAGE SELECT screen: pump + click loop (DOM probes work between
    // beginFrames; layout is forced synchronously by getBoundingClientRect).
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pump(Math.round(fps / 2));
      const text = await bodyText(page);
      if (!/LANGUAGE SELECT|语言选择|Language Select/i.test(text)) break;
      if (!(await clickElementByText(page, LANGUAGE_CLICK_PATTERN))) await clickAt(width * 0.11, height * 0.55);
      log("Deterministic: selected language on WebGAL language screen");
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
      const startButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("[class]"))
          .filter((element) => {
            const className = String(element.className || "");
            return className.includes("Title_button")
              && !className.includes("Title_buttonList")
              && !className.includes("Title_button_text")
              && !className.includes("Title_button_disabled");
          })
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter((item) => item.rect.width > 0 && item.rect.height > 0)
          .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
        const target = buttons[0]?.element;
        if (!target) return null;
        const rect = target.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      }).catch(() => null);
      if (startButton) await clickAt(startButton.x, startButton.y);
      else if (!(await clickElementByText(page, START_CLICK_PATTERN))) await clickAt(width * 0.095, height * 0.26);
      await pump(Math.max(2, Math.round(fps / 5)));
      if (await isTitleVisible(page)) await clickAt(width * 0.095, height * 0.26);
    }

    await pumpUntil(() => isVisible(CANVAS_SELECTOR), fps * 45, "stage canvas");

    // Authoritative Live2D core check (in-page), same as realtime mode.
    if (requiredMocVersion >= 5) {
      const latest = await probePageCubismCore(page);
      if (latest === null || latest < requiredMocVersion) {
        log(`WARNING: ${live2dCoreMismatchWarning(requiredMocVersion, latest)}`);
      }
    }

    if (!scriptTimed) {
      await startVirtualAutoAdvance(page, Math.max(1, Math.round(autoAdvanceSec * fps)));
    }
    await page.evaluate(() => {
      window.__galcodeRafProbe = 0;
      window.requestAnimationFrame(() => { window.__galcodeRafProbe += 1; });
    });
    await pumpFrame(false);
    const rafTicks = await page.evaluate(() => window.__galcodeRafProbe || 0);
    if (rafTicks === 0) {
      throw new Error([
        "Deterministic mode self-check failed: requestAnimationFrame did not advance under",
        "HeadlessExperimental.beginFrame on this build, so WebGAL's PIXI stage would stay frozen.",
        "Drop --deterministic to use realtime mode."
      ].join(" "));
    }

    const settleFrames = Math.round((sceneDelayMs / 1000) * fps);
    if (scriptTimed) {
      await setVirtualClockScale(page, 0);
      const warmupFrames = Math.max(2, Math.round(fps / 4));
      log(`Deterministic: warming up ${warmupFrames} frames with story clock held, then waiting for assets`);
      await pump(warmupFrames);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.max(1000, sceneDelayMs) }).catch((error) => {
        log(`Deterministic: asset wait ended early (${error.message}); starting with the story clock held no longer`);
      });
      await setVirtualClockScale(page, 1);
    } else {
      log(`Deterministic: pumping ${settleFrames} settle frames (${sceneDelayMs} ms virtual)`);
      await pump(settleFrames);
    }

    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const encoder = startMjpegEncoder({ ffmpeg, out, fps, crf, log });
    let frames = 0;
    let duplicated = 0;
    let lastBuffer = null;
    let stoppedOnTitle = false;
    const started = Date.now();
    try {
      // Loop on written frames (not pumps): a beginFrame that returns no
      // screenshot is re-pumped so the output keeps the exact frame count.
      let guard = totalFrames * 3;
      while (frames < totalFrames && !shouldStop() && !stoppedOnTitle && guard > 0) {
        guard -= 1;
        const result = await pumpFrame(true);
        if (result?.screenshotData) {
          lastBuffer = Buffer.from(result.screenshotData, "base64");
        } else if (lastBuffer) {
          duplicated += 1;
        } else {
          continue; // no frame produced yet and nothing to duplicate
        }
        await writeFrame(encoder, lastBuffer);
        frames += 1;

        // Title-screen watchdog (ported from realtime mode): after the first
        // 10 virtual seconds, check once per virtual second; with
        // --stop-on-title a re-appearing title screen ends the recording
        // cleanly at the story end instead of overshooting into the menu.
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
    const finalClock = await readVirtualClock(page).catch(() => null);
    await page.close().catch(() => {});

    const result = await finishEncoder(encoder, { out });
    const wallSec = Math.max(0.001, (Date.now() - started) / 1000);
    log(`Deterministic: captured ${frames}/${totalFrames} frames (${duplicated} duplicated) in ${wallSec.toFixed(2)}s wall time; virtual advances: ${finalClock?.advances ?? "?"}`);
    if (result.partial) log(`ffmpeg exited with ${result.exitCode} but the output video exists — keeping it (partial success)`);
    return { frames, duplicatedFrames: duplicated, wallSec, effectiveFps: frames / wallSec, bytes: result.bytes, partial: result.partial, virtualAdvances: finalClock?.advances, stoppedOnTitle };
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}
