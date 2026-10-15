import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { recordRealtime } from "../src/recorder/realtime.mjs";
import { commandExists } from "../src/recorder/ffmpeg.mjs";

// No-orphans integration test: record a trivial animated data: URL page (not
// WebGAL) with the real pinned browser, then prove the whole chrome process
// group is gone — both on clean finish and on mid-run abort.
//
// Hermetic: never downloads. Skips unless the pinned browser is already
// installed+probed (i.e. a real `galcode record` has run on this machine) and
// ffmpeg is available.

const isWindows = process.platform === "win32";
const ANIMATED_PAGE = "data:text/html," + encodeURIComponent(`<!doctype html><html><body style="margin:0">
<canvas id="c" width="320" height="180"></canvas>
<script>
  const ctx = document.getElementById("c").getContext("2d");
  let n = 0;
  function draw() {
    n += 1;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "#f48fb1"; ctx.fillRect((n * 7) % 320, 60, 40, 40);
    requestAnimationFrame(draw);
  }
  draw();
</script></body></html>`);

async function prerequisites() {
  if (isWindows) return null; // group-kill assertions below are POSIX-only
  if (!(await commandExists("ffmpeg"))) return null;
  const status = await recorderBrowserStatus();
  if (!status.installed || !status.ok) return null;
  return status;
}

// Browser tests may run concurrently in separate vitest workers (same binary
// path), so global pgrep would false-positive on a sibling test's browser.
// Scope leak detection to THIS browser's process group (chrome leads its own
// group when launched detached on POSIX).
function groupMembers(pgid) {
  const members = [];
  let entries = [];
  try {
    entries = fssync.readdirSync("/proc");
  } catch {
    return members;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fssync.readFileSync(`/proc/${entry}/stat`, "utf8");
      // /proc/<pid>/stat: pid (comm) state ppid pgrp — comm may contain spaces
      const afterComm = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      if (Number(afterComm[2]) === pgid) members.push(Number(entry));
    } catch { /* process vanished mid-read */ }
  }
  return members;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch { return false; }
}

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-orphan-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("recorder process hygiene (real browser)", () => {
  it("leaves no chromium processes after a clean recording", async (t) => {
    if (!(await prerequisites())) return t.skip("pinned browser not installed/probed or ffmpeg missing — run `galcode record` once first");

    const manifest = JSON.parse(await fs.readFile(path.join(recorderCacheDir(), "manifest.json"), "utf8"));
    const executablePath = path.join(recorderCacheDir(), manifest.executablePath);
    const browser = await launchRecorderBrowser({ executablePath, mode: "realtime", width: 320, height: 180 });
    const pid = browser.process()?.pid;

    const out = path.join(tmp, "clean.mp4");
    const stats = await recordRealtime({
      browser,
      url: ANIMATED_PAGE,
      out,
      width: 320,
      height: 180,
      fps: 10,
      durationSec: 2,
      sceneDelayMs: 100,
      startDelayMs: 50,
      autoAdvanceIntervalMs: 0,
      log: () => {}
    });
    expect(stats.frames).toBe(20);
    expect((await fs.stat(out)).size).toBeGreaterThan(0);

    await closeBrowserTree(browser);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(pidAlive(pid)).toBe(false);
    expect(groupAlive(pid)).toBe(false);
    expect(groupMembers(pid)).toEqual([]);
  }, 90000);

  it("leaves no chromium processes and a valid partial file when aborted mid-run", async (t) => {
    if (!(await prerequisites())) return t.skip("pinned browser not installed/probed or ffmpeg missing — run `galcode record` once first");

    const manifest = JSON.parse(await fs.readFile(path.join(recorderCacheDir(), "manifest.json"), "utf8"));
    const executablePath = path.join(recorderCacheDir(), manifest.executablePath);
    const browser = await launchRecorderBrowser({ executablePath, mode: "realtime", width: 320, height: 180 });
    const pid = browser.process()?.pid;

    let stop = false;
    setTimeout(() => { stop = true; }, 1200);
    const out = path.join(tmp, "partial.mp4");
    const stats = await recordRealtime({
      browser,
      url: ANIMATED_PAGE,
      out,
      width: 320,
      height: 180,
      fps: 10,
      durationSec: 60, // far longer than the abort timer
      sceneDelayMs: 100,
      startDelayMs: 50,
      autoAdvanceIntervalMs: 0,
      shouldStop: () => stop,
      log: () => {}
    });
    expect(stats.frames).toBeGreaterThan(0);
    expect(stats.frames).toBeLessThan(600);
    expect((await fs.stat(out)).size).toBeGreaterThan(0);

    await closeBrowserTree(browser);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(pidAlive(pid)).toBe(false);
    expect(groupAlive(pid)).toBe(false);
    expect(groupMembers(pid)).toEqual([]);
  }, 90000);
});
