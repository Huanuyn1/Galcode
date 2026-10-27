import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PINNED_CHROME_BUILD,
  RECORDER_BROWSER_KIND,
  checkInstallIntegrity,
  ensureRecorderBrowser,
  recorderBrowserStatus,
  launchArgsForMode,
  launchRecorderBrowser,
  deterministicLaunchArgs
} from "../src/recorder/browser.mjs";

// Browser-runtime management tests — hermetic: the download and the
// capability probe are stubbed, everything else runs against real fixture
// directories in tmp.

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-browser-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// Mimic an @puppeteer/browsers install(): lay down a fake binary + resources
// and return the executable path, like the real installer does.
function stubInstall({ exeName = "chrome-headless-shell", files = {} } = {}) {
  return async (options) => {
    const dir = path.join(options.cacheDir, `${RECORDER_BROWSER_KIND}-linux-${options.buildId}`, "chrome-headless-shell-linux64");
    await fs.mkdir(dir, { recursive: true });
    const allFiles = { [exeName]: 4096, "resources.pak": 2048, ...files };
    for (const [name, size] of Object.entries(allFiles)) {
      await fs.writeFile(path.join(dir, name), Buffer.alloc(size));
    }
    return { executablePath: path.join(dir, exeName), buildId: options.buildId };
  };
}

const okProbe = async () => ({ ok: true });

describe("browser pin", () => {
  it("pins a chrome-headless-shell build outside the crashing 117–120 range", () => {
    expect(PINNED_CHROME_BUILD).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    const major = Number(PINNED_CHROME_BUILD.split(".")[0]);
    expect(major).toBeGreaterThan(120);
  });
});

describe("ensureRecorderBrowser", () => {
  it("downloads on first use, snapshots binary + resources, probes capability", async () => {
    let installs = 0;
    let probed = 0;
    const info = await ensureRecorderBrowser({
      cacheDir: tmp,
      installImpl: async (options) => { installs += 1; return stubInstall()(options); },
      probeImpl: async () => { probed += 1; return { ok: true }; },
      log: () => {}
    });
    expect(installs).toBe(1);
    expect(probed).toBe(1);
    expect(fssync.existsSync(info.executablePath)).toBe(true);
    const manifest = JSON.parse(await fs.readFile(path.join(tmp, "manifest.json"), "utf8"));
    expect(manifest.buildId).toBe(PINNED_CHROME_BUILD);
    expect(manifest.probeOk).toBe(true);
    // Manifest covers binary AND key resource files, not just the exe.
    const rel = (name) => path.join(path.dirname(manifest.executablePath), name);
    expect(Object.keys(manifest.files).sort()).toEqual([rel("chrome-headless-shell"), rel("resources.pak")].sort());
  });

  it("fast path: a probed, intact install is reused without download or probe", async () => {
    const deps = {
      cacheDir: tmp,
      installImpl: stubInstall(),
      probeImpl: okProbe,
      log: () => {}
    };
    await ensureRecorderBrowser(deps);
    let installs = 0;
    let probes = 0;
    const again = await ensureRecorderBrowser({
      ...deps,
      installImpl: async () => { installs += 1; throw new Error("must not reinstall"); },
      probeImpl: async () => { probes += 1; return { ok: true }; }
    });
    expect(installs).toBe(0);
    expect(probes).toBe(0);
    expect(again.repaired).toBe(false);
  });

  it("repairs (re-downloads) when a key resource file goes missing", async () => {
    const deps = { cacheDir: tmp, installImpl: stubInstall(), probeImpl: okProbe, log: () => {} };
    const first = await ensureRecorderBrowser(deps);
    await fs.rm(path.join(path.dirname(first.executablePath), "resources.pak"));
    let reinstalls = 0;
    const repaired = await ensureRecorderBrowser({
      ...deps,
      installImpl: async (options) => { reinstalls += 1; return stubInstall()(options); }
    });
    expect(reinstalls).toBe(1);
    expect(repaired.repaired).toBe(true);
    expect(fssync.existsSync(path.join(path.dirname(repaired.executablePath), "resources.pak"))).toBe(true);
  });

  it("probes in place first when the manifest predates probing", async () => {
    await ensureRecorderBrowser({ cacheDir: tmp, installImpl: stubInstall(), probeImpl: okProbe, log: () => {} });
    // Simulate an older manifest that never recorded a probe.
    const manifestFile = path.join(tmp, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    delete manifest.probeOk;
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    let installs = 0;
    let probes = 0;
    await ensureRecorderBrowser({
      cacheDir: tmp,
      installImpl: async () => { installs += 1; throw new Error("must not reinstall"); },
      probeImpl: async () => { probes += 1; return { ok: true }; },
      log: () => {}
    });
    expect(installs).toBe(0);
    expect(probes).toBe(1);
  });

  it("repairs when an intact install fails the capability probe", async () => {
    await ensureRecorderBrowser({ cacheDir: tmp, installImpl: stubInstall(), probeImpl: okProbe, log: () => {} });
    // A probeOk manifest is trusted (fast path); clear it to simulate an
    // install whose last probe failed, forcing a re-probe.
    const manifestFile = path.join(tmp, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    delete manifest.probeOk;
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    let installs = 0;
    let probes = 0;
    const info = await ensureRecorderBrowser({
      cacheDir: tmp,
      installImpl: async (options) => { installs += 1; return stubInstall()(options); },
      probeImpl: async () => {
        probes += 1;
        return probes === 1 ? { ok: false, error: "HeadlessExperimental.beginFrame wasn't found" } : { ok: true };
      },
      log: () => {}
    });
    // First probe (in place) failed → wipe + reinstall → second probe passed.
    expect(probes).toBe(2);
    expect(installs).toBe(1);
    expect(info.repaired).toBe(true);
  });

  it("throws an actionable error when a fresh install keeps failing the probe", async () => {
    await expect(ensureRecorderBrowser({
      cacheDir: tmp,
      installImpl: stubInstall(),
      probeImpl: async () => ({ ok: false, error: "beginFrame missing" }),
      log: () => {}
    })).rejects.toThrow(/capability probe/);
  });
});

describe("checkInstallIntegrity", () => {
  it("rejects a missing manifest and a size-mismatched binary", async () => {
    expect((await checkInstallIntegrity(tmp)).ok).toBe(false);
    const exe = path.join(tmp, "pkg", "chrome-headless-shell");
    await fs.mkdir(path.dirname(exe), { recursive: true });
    await fs.writeFile(exe, Buffer.alloc(100));
    const manifest = { executablePath: path.relative(tmp, exe), files: { [path.relative(tmp, exe)]: 999 } };
    const result = await checkInstallIntegrity(tmp, manifest);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("files-corrupt");
  });
});

describe("recorderBrowserStatus (doctor row)", () => {
  it("reports not-installed, healthy, and corrupt states", async () => {
    const empty = await recorderBrowserStatus(tmp);
    expect(empty.installed).toBe(false);
    expect(empty.ok).toBe(false);

    await ensureRecorderBrowser({ cacheDir: tmp, installImpl: stubInstall(), probeImpl: okProbe, log: () => {} });
    const healthy = await recorderBrowserStatus(tmp);
    expect(healthy.installed).toBe(true);
    expect(healthy.ok).toBe(true);
    expect(healthy.detail).toContain(PINNED_CHROME_BUILD);

    const manifest = JSON.parse(await fs.readFile(path.join(tmp, "manifest.json"), "utf8"));
    const someFile = Object.keys(manifest.files)[0];
    await fs.rm(path.join(tmp, someFile));
    const corrupt = await recorderBrowserStatus(tmp);
    expect(corrupt.installed).toBe(true);
    expect(corrupt.ok).toBe(false);
    expect(corrupt.detail).toMatch(/corrupt/);
  });
});

describe("launch args", () => {
  it("realtime args carry the proven WebGAL switches; deterministic adds begin-frame control", () => {
    const realtime = launchArgsForMode("realtime", { width: 1280, height: 720 });
    expect(realtime).toContain("--disable-background-timer-throttling");
    expect(realtime).toContain("--autoplay-policy=no-user-gesture-required");
    expect(realtime).toContain("--enable-unsafe-swiftshader");
    expect(realtime.join(" ")).not.toContain("begin-frame-control");

    const deterministic = launchArgsForMode("deterministic", { width: 1280, height: 720 });
    for (const flag of deterministicLaunchArgs()) expect(deterministic).toContain(flag);
    expect(deterministic.join(" ")).toContain("--enable-begin-frame-control");
    expect(deterministic.join(" ")).toContain("--deterministic-mode");
  });

  it("falls back to software rendering args when hardware launch fails", async () => {
    const previous = process.env.GALCODE_GPU;
    process.env.GALCODE_GPU = "metal";
    const calls = [];
    try {
      await launchRecorderBrowser({
        executablePath: "/fake/chrome",
        mode: "realtime",
        launchImpl: async (_exe, args) => {
          calls.push(args);
          if (calls.length === 1) throw new Error("simulated unavailable Metal driver");
          return { ok: true };
        }
      });
    } finally {
      if (previous === undefined) delete process.env.GALCODE_GPU;
      else process.env.GALCODE_GPU = previous;
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--use-angle=metal");
    expect(calls[1]).not.toContain("--use-angle=metal");
    expect(calls[1]).toContain("--enable-unsafe-swiftshader");
  });
});

describe("probe sandbox self-healing", () => {
  it("retries sandboxless when the browser crashes after launch, and remembers", async () => {
    const { probeBrowserCapabilities } = await import("../src/recorder/browser.mjs");
    const calls = [];
    const launchImpl = async (exe, args, { noSandbox } = {}) => {
      calls.push(noSandbox);
      if (!noSandbox) {
        // Launch "succeeds" then the browser dies at the first CDP command —
        // the sandbox-wrapped-host failure mode.
        return {
          newPage: async () => ({
            createCDPSession: async () => ({ send: async () => { throw new Error("Target closed"); } })
          }),
          close: async () => {},
          process: () => null
        };
      }
      return {
        newPage: async () => ({ createCDPSession: async () => ({ send: async () => ({}) }) }),
        close: async () => {},
        process: () => null
      };
    };
    const result = await probeBrowserCapabilities("/fake/exe", { launchImpl });
    expect(result.ok).toBe(true);
    expect(result.noSandbox).toBe(true);
    expect(calls).toEqual([false, true]);
  });

  it("propagates needsNoSandbox through the manifest", async () => {
    const deps = {
      cacheDir: tmp,
      installImpl: stubInstall(),
      probeImpl: async () => ({ ok: true, noSandbox: true }),
      log: () => {}
    };
    const first = await ensureRecorderBrowser(deps);
    expect(first.needsNoSandbox).toBe(true);
    const manifest = JSON.parse(await fs.readFile(path.join(tmp, "manifest.json"), "utf8"));
    expect(manifest.needsNoSandbox).toBe(true);
    // Fast path keeps the flag without re-probing.
    const second = await ensureRecorderBrowser({ ...deps, probeImpl: async () => { throw new Error("must not probe"); } });
    expect(second.needsNoSandbox).toBe(true);
  });
});
