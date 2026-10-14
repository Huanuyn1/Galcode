import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { install as installBrowser, computeExecutablePath, detectBrowserPlatform, Browser as BrowserKind } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";
import { killChildTree } from "../proc.mjs";

// Browser runtime management for `galcode record` (issue-#2 lessons applied):
// "installed" means three things, not one — a manifest of the binary AND its
// key resource files must check out, and the binary must pass a live
// capability probe (launch, assert CDP HeadlessExperimental.beginFrame, close).
// Any failure triggers the repair path: wipe and re-download once.

// Pinned chrome-headless-shell build (Chrome for Testing stable). Revisions
// 117–120 crash for offscreen/headless capture workloads; never pin those.
export const RECORDER_BROWSER_KIND = BrowserKind.CHROMEHEADLESSSHELL;
export const PINNED_CHROME_BUILD = "155.0.8059.39";

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_NAME = "manifest.json";

export function recorderCacheDir(root = DEFAULT_REPO_ROOT) {
  return path.join(root, ".galcode", "browser");
}

function manifestPath(cacheDir) {
  return path.join(cacheDir, MANIFEST_NAME);
}

// Base launch flags shared by realtime and deterministic recording. These are
// the WebGAL-proven Electron switches ported to plain Chromium.
function baseLaunchArgs({ width, height }) {
  return [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=1",
    // Software WebGL (Live2D) needs SwiftShader in headless environments;
    // newer Chrome requires the explicit opt-in flag.
    "--enable-unsafe-swiftshader",
    `--window-size=${width},${height}`,
    "--hide-scrollbars"
  ];
}

// --deterministic mode: compositor only produces frames when we issue
// HeadlessExperimental.beginFrame, so rAF/PIXI follow the virtual frame clock.
export function deterministicLaunchArgs() {
  return [
    "--deterministic-mode",
    "--enable-begin-frame-control",
    "--run-all-compositor-stages-before-draw",
    "--disable-threaded-animation",
    "--disable-threaded-scrolling",
    "--disable-checker-imaging",
    "--disable-image-animation-resync",
    "--enable-surface-synchronization"
  ];
}

export function launchArgsForMode(mode, { width, height } = {}) {
  const base = baseLaunchArgs({ width: width || 1280, height: height || 720 });
  return mode === "deterministic" ? [...base, ...deterministicLaunchArgs()] : base;
}

async function defaultLaunch(executablePath, args) {
  const launchOptions = {
    executablePath,
    headless: "shell",
    args,
    defaultViewport: null,
    protocolTimeout: 300000
  };
  try {
    return await puppeteer.launch(launchOptions);
  } catch (error) {
    // Container/CI environments often lack user namespaces; retry sandboxless.
    if (!/sandbox|namespace|Operation not permitted|Seccomp/i.test(String(error?.message || error))) throw error;
    return await puppeteer.launch({
      ...launchOptions,
      args: [...args, "--no-sandbox", "--disable-setuid-sandbox"]
    });
  }
}

export async function launchRecorderBrowser({ executablePath, mode = "realtime", width, height, launchImpl }) {
  const launch = launchImpl || defaultLaunch;
  return await launch(executablePath, launchArgsForMode(mode, { width, height }));
}

// Close the browser and guarantee the whole tree is gone. @puppeteer/browsers
// spawns chrome detached on POSIX and kills the process group on close(); the
// killChildTree fallback covers a wedged renderer that ignores close().
export async function closeBrowserTree(browser, { graceMs = 5000 } = {}) {
  if (!browser) return;
  const proc = typeof browser.process === "function" ? browser.process() : null;
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, graceMs))
  ]);
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    killChildTree(proc, "SIGKILL");
  }
}

// Live capability probe: launch, assert the CDP beginFrame command exists
// (our deterministic mode depends on it; its absence also flags a broken or
// mismatched binary), then close. Must leave no processes behind.
export async function probeBrowserCapabilities(executablePath, { launchImpl } = {}) {
  const launch = launchImpl || defaultLaunch;
  let browser;
  try {
    browser = await launch(executablePath, launchArgsForMode("deterministic", {}));
    const page = await browser.newPage();
    const session = await page.createCDPSession();
    await session.send("HeadlessExperimental.beginFrame", { noDisplayUpdates: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    await closeBrowserTree(browser);
  }
}

async function walkFiles(dir, base = dir, out = {}) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, base, out);
    else if (entry.isFile()) out[path.relative(base, full)] = (await fs.stat(full)).size;
  }
  return out;
}

async function readManifest(cacheDir) {
  try {
    return JSON.parse(await fs.readFile(manifestPath(cacheDir), "utf8"));
  } catch {
    return null;
  }
}

async function writeManifest(cacheDir, manifest) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(manifestPath(cacheDir), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

// Integrity = manifest exists, executable exists, and every recorded file
// (binary + key resources) is present with its recorded size.
export async function checkInstallIntegrity(cacheDir, manifest) {
  manifest = manifest ?? await readManifest(cacheDir);
  if (!manifest || !manifest.executablePath || !manifest.files) {
    return { ok: false, reason: "no-manifest", missing: [] };
  }
  const executablePath = path.join(cacheDir, manifest.executablePath);
  if (!fssync.existsSync(executablePath)) {
    return { ok: false, reason: "executable-missing", missing: [manifest.executablePath] };
  }
  const missing = [];
  const mismatched = [];
  for (const [rel, size] of Object.entries(manifest.files)) {
    const stat = fssync.statSync(path.join(cacheDir, rel), { throwIfNoEntry: false });
    if (!stat) missing.push(rel);
    else if (stat.size !== size) mismatched.push(rel);
  }
  if (missing.length || mismatched.length) return { ok: false, reason: "files-corrupt", missing, mismatched };
  return { ok: true, executablePath };
}

async function downloadBrowser(cacheDir, { log, installImpl }) {
  const install = installImpl || installBrowser;
  let lastLog = 0;
  const result = await install({
    browser: RECORDER_BROWSER_KIND,
    buildId: PINNED_CHROME_BUILD,
    cacheDir,
    baseUrl: process.env.GALCODE_CHROME_DOWNLOAD_BASE_URL || undefined,
    downloadProgressCallback: (downloaded, total) => {
      const now = Date.now();
      if (now - lastLog < 500 && downloaded < total) return;
      lastLog = now;
      const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
      log?.(`Downloading chrome-headless-shell ${PINNED_CHROME_BUILD}: ${total > 0 ? Math.round((downloaded / total) * 100) + "%" : "?"} (${mb(downloaded)}/${total > 0 ? mb(total) : "?"} MB)`);
    }
  });
  return result;
}

async function snapshotInstall(cacheDir, executablePath, probe) {
  // Snapshot the whole install directory (binary + resources), not just the
  // executable, so partial deletes/corrupt updates are caught by integrity.
  const installDir = path.dirname(executablePath);
  const files = await walkFiles(installDir, cacheDir);
  return {
    browser: RECORDER_BROWSER_KIND,
    buildId: PINNED_CHROME_BUILD,
    platform: detectBrowserPlatform(),
    executablePath: path.relative(cacheDir, executablePath),
    files,
    installedAt: new Date().toISOString(),
    probeOk: Boolean(probe?.ok),
    probedAt: probe ? new Date().toISOString() : null,
    probeError: probe && !probe.ok ? probe.error : null
  };
}

// Resolve a working browser, downloading on first use (never at npm install
// time) and repairing on integrity/probe failure. installImpl/probeImpl are
// injectable so tests stay hermetic.
export async function ensureRecorderBrowser({ cacheDir = recorderCacheDir(), log = () => {}, installImpl, probeImpl, launchImpl } = {}) {
  const probe = probeImpl || ((exe) => probeBrowserCapabilities(exe, { launchImpl }));
  const manifest = await readManifest(cacheDir);

  if (manifest) {
    const integrity = await checkInstallIntegrity(cacheDir, manifest);
    if (integrity.ok && manifest.probeOk) {
      return { executablePath: integrity.executablePath, buildId: manifest.buildId, repaired: false };
    }
    if (integrity.ok && !manifest.probeOk) {
      // Installed but never probed (or probe failed last time): probe in place
      // before deciding a re-download is needed.
      const probeResult = await probe(integrity.executablePath);
      if (probeResult.ok) {
        await writeManifest(cacheDir, { ...manifest, probeOk: true, probedAt: new Date().toISOString(), probeError: null });
        return { executablePath: integrity.executablePath, buildId: manifest.buildId, repaired: false };
      }
      log?.(`Recorder browser failed its capability probe (${probeResult.error}); repairing…`);
    } else {
      log?.(`Recorder browser install is incomplete (${integrity.reason}${integrity.missing?.length ? `: ${integrity.missing.slice(0, 3).join(", ")}` : ""}); repairing…`);
    }
  }

  // Install (first use) or repair (broken install): wipe, download, probe;
  // if a fresh download still fails the probe, retry the whole thing once.
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.mkdir(cacheDir, { recursive: true });
    log?.(`${attempt > 0 ? "Retrying download" : "Downloading"} chrome-headless-shell ${PINNED_CHROME_BUILD} → ${cacheDir}`);
    let executablePath;
    try {
      const installed = await downloadBrowser(cacheDir, { log, installImpl });
      executablePath = installed.executablePath || computeExecutablePath({
        browser: RECORDER_BROWSER_KIND,
        buildId: PINNED_CHROME_BUILD,
        cacheDir
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    log?.("Probing browser capabilities (CDP HeadlessExperimental.beginFrame)…");
    const probeResult = await probe(executablePath);
    await writeManifest(cacheDir, await snapshotInstall(cacheDir, executablePath, probeResult));
    if (probeResult.ok) {
      log?.(`Recorder browser ready: ${executablePath}`);
      return { executablePath, buildId: PINNED_CHROME_BUILD, repaired: attempt > 0 || Boolean(manifest) };
    }
    lastError = new Error(`chrome-headless-shell failed capability probe: ${probeResult.error}`);
  }
  throw new Error([
    `Could not set up the recorder browser: ${lastError?.message || "unknown error"}.`,
    `Galcode downloads a pinned chrome-headless-shell (${PINNED_CHROME_BUILD}) into .galcode/browser on first use.`,
    "Check network access to https://storage.googleapis.com (or set GALCODE_CHROME_DOWNLOAD_BASE_URL to a mirror)",
    "and retry `galcode record`."
  ].join(" "));
}

// Fast, launch-free status for `galcode doctor`.
export async function recorderBrowserStatus(cacheDir = recorderCacheDir()) {
  const manifest = await readManifest(cacheDir);
  if (!manifest) {
    return { installed: false, ok: false, detail: "not installed — downloaded on first `galcode record`" };
  }
  const integrity = await checkInstallIntegrity(cacheDir, manifest);
  if (!integrity.ok) {
    return {
      installed: true,
      ok: false,
      buildId: manifest.buildId,
      detail: `${manifest.buildId} — corrupt (${integrity.reason}${integrity.missing?.length ? ": " + integrity.missing.slice(0, 2).join(", ") : ""}); next 'galcode record' will repair`
    };
  }
  return {
    installed: true,
    ok: Boolean(manifest.probeOk),
    buildId: manifest.buildId,
    detail: `${manifest.buildId} — integrity OK, ${manifest.probeOk ? "capability probe OK" : "not yet probed (will probe on next record)"}${manifest.probeError ? `, last probe error: ${manifest.probeError}` : ""}`
  };
}
