import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { killChildTree } from "../proc.mjs";
import { ensureRecorderBrowser, launchRecorderBrowser, closeBrowserTree, markRecorderQuirks } from "./browser.mjs";
import { assertFfmpegAvailable } from "./ffmpeg.mjs";
import { recordRealtime } from "./realtime.mjs";
import { recordDeterministic } from "./deterministic.mjs";
import { recordVtPolicy } from "./vt-policy.mjs";
import { mixBgm } from "./mix-bgm.mjs";
import { scanMoc3Versions } from "../live2d-compat.mjs";

// `galcode record` orchestration, ported from legacy recordProject (~:2841):
// resolve the duration contract (--duration wins, else the compiled story
// timeline), auto-start the WebGAL preview when no --url is given, record with
// the pinned headless browser, post-mix BGM, and never leave a chromium/vite
// process behind.
//
// Timeout rule (legacy): max(180s, duration*2 + 180s). On timeout the capture
// loop stops and ffmpeg finalizes whatever it has — a partial valid video
// beats a dead .mp4 without a moov atom.

export async function readStoryTiming(projectDir) {
  const storyPath = path.join(projectDir, "story.json");
  if (!fssync.existsSync(storyPath)) return { durationSec: 0, scriptTimed: false };
  try {
    const story = JSON.parse(await fs.readFile(storyPath, "utf8"));
    return {
      durationSec: Number(story._totalDurationSec || story.durationSec || 0),
      scriptTimed: Number(story._timingVersion || 0) >= 2
    };
  } catch {
    return { durationSec: 0, scriptTimed: false };
  }
}

export async function readStoryDuration(projectDir) {
  return (await readStoryTiming(projectDir)).durationSec;
}

export function resolveRecordMode(flags = {}) {
  // deterministic is the default: the virtual frame clock keeps output smooth
  // regardless of host load. realtime is the legacy wall-clock fallback.
  const raw = String(flags.mode || (flags.realtime ? "realtime" : "deterministic")).toLowerCase();
  if (raw === "realtime" || raw === "deterministic") return raw;
  throw new Error(`Unknown --mode: ${raw}. Use realtime or deterministic.`);
}

export function recordTimeoutMs(durationSec, flags = {}) {
  // realtime capture runs at wall-clock speed (duration*2 is generous);
  // deterministic mode renders as fast as SwiftShader can — observed ~10
  // virtual fps at 720p60, i.e. ~6x wall time. Give it headroom.
  const perSecond = resolveRecordMode(flags) === "deterministic" ? 8000 : 2000;
  return Number(flags.recordTimeout || Math.max(180000, durationSec * perSecond + 180000));
}

export async function recordProject(projectDir, flags = {}, deps = {}) {
  const log = flags.quiet ? () => {} : (line) => console.log(line);
  const recordStarted = Date.now();
  const profile = (name, started) => {
    if (process.env.GALCODE_RECORD_PROFILE === "1") log(`record profile: ${name}=${((Date.now() - started) / 1000).toFixed(2)}s`);
  };
  projectDir = path.resolve(projectDir);
  if (!fssync.existsSync(path.join(projectDir, "game", "scene", "start.txt")) && !flags.url) {
    throw new Error(`Not a compiled Galcode project: ${projectDir} (missing game/scene/start.txt — run \`galcode compile\` or \`galcode yolo\` first)`);
  }

  const storyTiming = await readStoryTiming(projectDir);
  const durationSec = Number(flags.duration || flags.durationSec || storyTiming.durationSec || 180);
  // --video-out is the video path. (--out belongs to make/yolo as the PROJECT
  // dir; the record command translates its own --out into --video-out.)
  const out = path.resolve(flags.videoOut || path.join(projectDir, "final.mp4"));
  const width = Number(flags.width || 1280);
  const height = Number(flags.height || 720);
  const fps = Number(flags.fps || 60);
  const mode = resolveRecordMode(flags);
  const ffmpegCommand = String(flags.ffmpeg || "ffmpeg");

  // ffmpeg is required-for-record: fail before touching the browser.
  await assertFfmpegAvailable(ffmpegCommand);

  // Everything after this point is wrapped so the preview server and the
  // browser are killed on ANY failure — a leaked detached child keeps the
  // CLI process alive and holds the port.
  let autoServer = null;
  let browser = null;
  let timedOut = false;
  const timeoutMs = recordTimeoutMs(durationSec, flags);
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    log(`Recording timed out after ${Math.round(timeoutMs / 1000)}s; finalizing partial output…`);
  }, timeoutMs);
  timeoutTimer.unref?.();
  const onSignal = (signal) => {
    log(`Received ${signal}; stopping recording…`);
    timedOut = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let stats = null;
  try {
    let url = flags.url || "";
    const previewStarted = Date.now();
    if (!url) {
      if (!deps.startWebGALPreview) throw new Error("No --url given and no WebGAL preview starter is available.");
      autoServer = await deps.startWebGALPreview(projectDir, flags);
      url = autoServer.url;
    }
    profile("preview-ready", previewStarted);

    const browserSetupStarted = Date.now();
    const ensureBrowser = deps.ensureBrowser || ensureRecorderBrowser;
    const { executablePath, needsNoSandbox, deterministicDriver } = await ensureBrowser({ cacheDir: flags.browserCacheDir ? path.resolve(flags.browserCacheDir) : undefined, log });
    profile("browser-ready", browserSetupStarted);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.rm(out, { force: true });

    // moc3 v5 (Cubism 5 / chara pack) needs a matching core; the recorder
    // probes the page authoritatively and warns when the runtime is too old.
    const mocScan = await scanMoc3Versions(path.join(projectDir, "game"));

    log(`Recording ${width}x${height} @ ${fps} fps, ${durationSec}s, mode=${mode} → ${out}`);
    const launch = deps.launchBrowser || launchRecorderBrowser;
    const recorderArgs = {
      url,
      out,
      width,
      height,
      fps,
      durationSec,
      scriptTimed: storyTiming.scriptTimed,
      ffmpeg: ffmpegCommand,
      crf: flags.crf !== undefined ? Number(flags.crf) : 18,
      startDelayMs: Number(flags.startDelay || 1500),
      sceneDelayMs: Number(flags.sceneDelay || 8000),
      autoAdvanceIntervalMs: flags.clickInterval ? Number(flags.clickInterval) : 4000,
      noAutoplay: Boolean(flags.noAutoplay),
      stopOnTitle: Boolean(flags.stopOnTitle),
      requiredMocVersion: mocScan.maxVersion || 0,
      shouldStop: () => timedOut,
      log
    };
    const isCrash = (error) => /Target closed|Session closed|Target crashed|Connection closed/i.test(String(error?.message || error));

    // deterministic has two drivers: beginFrame (default; proven smooth) and
    // vt-policy (fallback for hosts where beginFrame traps the browser process,
    // e.g. macOS 26 arm64 — the trap is inside the beginFrame handler itself,
    // and --no-sandbox does NOT help there). Crash-pattern errors walk the
    // ladder: beginFrame → beginFrame+noSandbox → vt-policy.
    let driver = mode === "deterministic" ? (deterministicDriver || "beginFrame") : "realtime";
    let noSandbox = Boolean(needsNoSandbox);
    for (;;) {
      try {
        const vt = driver === "vt-policy";
        const driverStarted = Date.now();
        browser = await launch({ executablePath, mode: vt ? "realtime" : mode, width, height, noSandbox });
        profile(`browser-launch:${driver}`, driverStarted);
        const record = vt
          ? (deps.recordVtPolicy || recordVtPolicy)
          : mode === "deterministic"
            ? (deps.recordDeterministic || recordDeterministic)
            : (deps.recordRealtime || recordRealtime);
        stats = await record({ browser, ...recorderArgs });
        profile(`driver-total:${driver}`, driverStarted);
        if (vt || (noSandbox && !needsNoSandbox)) {
          await markRecorderQuirks(flags.browserCacheDir ? path.resolve(flags.browserCacheDir) : undefined, {
            needsNoSandbox: noSandbox || undefined,
            deterministicDriver: vt ? "vt-policy" : undefined
          });
        }
        break;
      } catch (error) {
        if (!isCrash(error)) throw error;
        await closeBrowserTree(browser);
        browser = null;
        if (!noSandbox) {
          noSandbox = true;
          log("Browser died mid-record (sandbox kill); retrying with --no-sandbox…");
        } else if (mode === "deterministic" && driver !== "vt-policy") {
          driver = "vt-policy";
          log("beginFrame traps this host's browser process; falling back to the external-clock deterministic driver (in-page clock + screencast)…");
        } else {
          throw error;
        }
      }
    }
  } finally {
    const cleanupStarted = Date.now();
    clearTimeout(timeoutTimer);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await closeBrowserTree(browser);
    if (autoServer?.child) killChildTree(autoServer.child);
    profile("cleanup", cleanupStarted);
  }

  const outStat = fssync.statSync(out, { throwIfNoEntry: false });
  if (!outStat || outStat.size === 0) {
    throw new Error(`Recording produced no output: ${out}`);
  }

  const mix = await mixBgm(projectDir, out, {
    ffmpeg: ffmpegCommand,
    noBgm: flags.noBgm,
    log,
    warn: (line) => console.warn(line)
  });

  profile("total", recordStarted);
  log(`Recorded ${out} (${outStat.size} bytes${mix.mixed ? `, BGM mixed: ${mix.tracks} track(s)` : ""})`);
  if (timedOut) log("Note: recording stopped early (timeout/signal); the output is a valid partial recording.");
  return { out, durationSec, mode, ...stats, bgm: mix };
}
