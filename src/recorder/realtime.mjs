import { startMjpegEncoder, writeFrame, finishEncoder, abortEncoder } from "./ffmpeg.mjs";
import { installLanguagePreset, prepareWebGALPage, isTitleVisible, sleep } from "./webgal-page.mjs";
import { runPacedCapture } from "./pacing.mjs";

// Realtime mode (default, parity with the deleted Electron recorder): the
// page runs on the wall clock while we pull JPEG frames out over CDP at the
// target fps and pipe them into `ffmpeg -f image2pipe -c:v mjpeg`.
//
// Two capture strategies, measured on WebGAL @1280x720 (SwiftShader):
//  - "screencast" (DEFAULT): Page.startScreencast pushes compositor frames
//    with ack; we sample the latest frame on the paced fps clock. Measured
//    ~18.6 unique fps — about 3x the screenshot path — and wall time stays
//    exactly on duration.
//  - "screenshot" (GALCODE_CAPTURE=screenshot): paced Page.captureScreenshot,
//    the direct port of the old pipelined capturePage loop with drift
//    correction. Measured ~6.5 unique fps at 720p.
// Both fill missed slots by repeating the last frame, so story timing always
// maps 1:1 to wall time.

const TITLE_CHECK_INTERVAL_MS = 2000;
const TITLE_CHECK_GRACE_MS = 10000;

export async function recordRealtime({
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
  startDelayMs = 1500,
  sceneDelayMs = 8000,
  autoAdvanceIntervalMs = 4000,
  noAutoplay = false,
  stopOnTitle = false,
  shouldStop = () => false,
  log = () => {}
} = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await installLanguagePreset(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await prepareWebGALPage(page, {
    width, height, startDelayMs, sceneDelayMs, noAutoplay, autoAdvanceIntervalMs, log
  });

  const session = await page.createCDPSession();
  const encoder = startMjpegEncoder({ ffmpeg, out, fps, crf, log });

  // Ported title-screen watchdog: after the first 10s, check every 2s whether
  // we fell back to the title screen; log (or stop, with --stop-on-title).
  let titleSeen = false;
  let stoppedOnTitle = false;
  const captureStart = Date.now();
  const titleTimer = setInterval(() => {
    if (titleSeen || Date.now() - captureStart < TITLE_CHECK_GRACE_MS) return;
    isTitleVisible(page).then((onTitle) => {
      if (!onTitle || titleSeen) return;
      titleSeen = true;
      const atSec = Math.round((Date.now() - captureStart) / 1000);
      if (stopOnTitle) {
        stoppedOnTitle = true;
        log(`Title screen detected at ${atSec}s; stopping early (--stop-on-title)`);
      } else {
        log(`Title screen detected at ${atSec}s; continuing until requested duration (${durationSec}s)`);
      }
    }).catch(() => {});
  }, TITLE_CHECK_INTERVAL_MS);

  const useScreencast = process.env.GALCODE_SCREENCAST === "1";
  let stats;
  try {
    stats = useScreencast
      ? await captureViaScreencast({ session, encoder, fps, durationSec, width, height, jpegQuality, shouldStop: () => shouldStop() || stoppedOnTitle, log })
      : await captureViaScreenshots({ session, encoder, fps, durationSec, jpegQuality, shouldStop: () => shouldStop() || stoppedOnTitle, log });
  } catch (error) {
    abortEncoder(encoder);
    throw error;
  } finally {
    clearInterval(titleTimer);
    await page.close().catch(() => {});
  }

  const result = await finishEncoder(encoder, { out });
  const effectiveFps = stats.frames / stats.wallSec;
  const uniqueFps = (stats.uniqueFrames ?? stats.frames) / stats.wallSec;
  log(`Captured ${stats.frames} frames in ${stats.wallSec.toFixed(2)}s wall time (${effectiveFps.toFixed(2)} fps written, ${uniqueFps.toFixed(2)} fps unique, ${stats.duplicatedFrames || 0} duplicated slot(s))`);
  if (result.partial) log(`ffmpeg exited with ${result.exitCode} but the output video exists — keeping it (partial success)`);
  return { ...stats, effectiveFps, bytes: result.bytes, partial: result.partial };
}

async function captureViaScreenshots({ session, encoder, fps, durationSec, jpegQuality, shouldStop, log }) {
  const capture = async () => {
    const { data } = await session.send("Page.captureScreenshot", { format: "jpeg", quality: jpegQuality });
    return Buffer.from(data, "base64");
  };
  let lastDupLog = 0;
  return await runPacedCapture({
    fps,
    durationSec,
    capture,
    write: (frame) => writeFrame(encoder, frame),
    shouldStop,
    onDuplicate: (frame) => {
      const now = Date.now();
      if (now - lastDupLog > 5000) {
        lastDupLog = now;
        log(`Capture is behind the ${fps}fps schedule; duplicating the last frame to keep story timing (frame ${frame})`);
      }
    }
  });
}

async function captureViaScreencast({ session, encoder, fps, durationSec, width, height, jpegQuality, shouldStop, log }) {
  let latest = null;
  let received = 0;
  const waiters = [];
  const onFrame = (event) => {
    latest = Buffer.from(event.data, "base64");
    received += 1;
    session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    const waiter = waiters.shift();
    if (waiter) waiter();
  };
  session.on("Page.screencastFrame", onFrame);

  const frameMs = 1000 / fps;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  let frames = 0;
  let duplicated = 0;
  try {
    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: jpegQuality,
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: 1
    });
    const started = Date.now();
    // First frame can take a moment; without one there is nothing to write.
    const firstDeadline = started + 5000;
    while (!latest && Date.now() < firstDeadline) {
      await Promise.race([new Promise((resolve) => waiters.push(resolve)), sleep(250)]);
    }
    if (!latest) throw new Error("Page.startScreencast produced no frames within 5s");
    for (let frame = 0; frame < totalFrames && !shouldStop(); frame += 1) {
      const target = started + frame * frameMs;
      const delay = target - Date.now();
      if (delay > 1) await sleep(delay - 0.5);
      await writeFrame(encoder, latest);
      frames += 1;
    }
    const wallSec = Math.max(0.001, (Date.now() - started) / 1000);
    log(`Screencast delivered ${received} frames over ${wallSec.toFixed(2)}s (${(received / wallSec).toFixed(2)} fps delivered)`);
    return { frames, driftCorrections: 0, wallSec, deliveredFrames: received, duplicatedFrames: duplicated };
  } finally {
    session.off("Page.screencastFrame", onFrame);
    await session.send("Page.stopScreencast").catch(() => {});
  }
}
