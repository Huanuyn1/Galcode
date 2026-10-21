import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordProject, resolveRecordMode, recordTimeoutMs } from "../src/recorder/index.mjs";

// Orchestration contracts: flag mapping, timeout rule, and — the regression
// that hung the CLI — the auto-started preview server is killed even when the
// record fails BEFORE the browser phase.

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-recordproject-test-"));
  await fs.mkdir(path.join(tmp, "game", "scene"), { recursive: true });
  await fs.writeFile(path.join(tmp, "game", "scene", "start.txt"), "; test\n");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("resolveRecordMode / recordTimeoutMs", () => {
  it("maps flags to modes and rejects unknown modes", () => {
    expect(resolveRecordMode({})).toBe("deterministic");
    expect(resolveRecordMode({ realtime: true })).toBe("realtime");
    expect(resolveRecordMode({ mode: "realtime" })).toBe("realtime");
    expect(resolveRecordMode({ mode: "deterministic" })).toBe("deterministic");
    expect(() => resolveRecordMode({ mode: "yolo" })).toThrow(/--mode/);
  });

  it("timeout = max(180s, duration*2 + 180s), overridable", () => {
    expect(recordTimeoutMs(15, { mode: "realtime" })).toBe(210000);
    expect(recordTimeoutMs(1, { mode: "realtime" })).toBe(182000);
    expect(recordTimeoutMs(0, { mode: "realtime" })).toBe(180000);
    expect(recordTimeoutMs(600, { mode: "realtime" })).toBe(1380000);
    expect(recordTimeoutMs(15, { recordTimeout: 5000 })).toBe(5000);
    // deterministic is the default and renders ~6x slower than wall clock — wider allowance
    expect(recordTimeoutMs(15, { mode: "deterministic" })).toBe(300000);
    expect(recordTimeoutMs(600, { mode: "deterministic" })).toBe(4980000);
    expect(recordTimeoutMs(600)).toBe(4980000);
  });
});

describe("recordProject cleanup on early failure", () => {
  it("kills the auto-started preview when the browser setup throws", async () => {
    let killed = false;
    const fakeChild = { killed: false, exitCode: null, kill: () => { killed = true; } };
    await expect(recordProject(tmp, { quiet: true }, {
      startWebGALPreview: async () => ({ child: fakeChild, url: "http://127.0.0.1:1" }),
      ensureBrowser: async () => { throw new Error("simulated browser setup failure"); }
    })).rejects.toThrow("simulated browser setup failure");
    expect(killed).toBe(true);
  });

  it("kills the preview when the recorder itself throws", async () => {
    let killed = false;
    const fakeChild = { killed: false, exitCode: null, kill: () => { killed = true; } };
    await expect(recordProject(tmp, { quiet: true, mode: "realtime" }, {
      startWebGALPreview: async () => ({ child: fakeChild, url: "http://127.0.0.1:1" }),
      ensureBrowser: async () => ({ executablePath: "/nonexistent/chrome" }),
      launchBrowser: async () => { throw new Error("simulated launch failure"); }
    })).rejects.toThrow("simulated launch failure");
    expect(killed).toBe(true);
  });

  it("rejects unknown --mode before touching anything", async () => {
    let previewStarted = false;
    await expect(recordProject(tmp, { quiet: true, mode: "bogus" }, {
      startWebGALPreview: async () => { previewStarted = true; return { child: null, url: "" }; }
    })).rejects.toThrow(/--mode/);
    expect(previewStarted).toBe(false);
  });

  it("walks beginFrame → +noSandbox → vt-policy on crash-pattern failures", async () => {
    const launches = [];
    const fakeBrowser = () => ({ process: () => null, close: async () => {} });
    await recordProject(tmp, { quiet: true, mode: "deterministic", duration: 1, noBgm: true }, {
      startWebGALPreview: async () => ({ child: null, url: "http://127.0.0.1:1" }),
      ensureBrowser: async () => ({ executablePath: "/nonexistent/chrome" }),
      launchBrowser: async ({ noSandbox, mode }) => {
        launches.push({ noSandbox, mode });
        return fakeBrowser();
      },
      recordDeterministic: async () => { throw new Error("Protocol error (HeadlessExperimental.beginFrame): Target closed"); },
      recordVtPolicy: async ({ out }) => { await fs.writeFile(out, "fake video"); return { frames: 1 }; }
    });
    // beginFrame → +noSandbox → vt-policy (vt launches with base args)
    expect(launches).toEqual([
      { noSandbox: false, mode: "deterministic" },
      { noSandbox: true, mode: "deterministic" },
      { noSandbox: true, mode: "realtime" }
    ]);
  });

  it("honors a remembered vt-policy driver without re-crashing", async () => {
    const launches = [];
    const fakeBrowser = () => ({ process: () => null, close: async () => {} });
    await recordProject(tmp, { quiet: true, mode: "deterministic", duration: 1, noBgm: true }, {
      startWebGALPreview: async () => ({ child: null, url: "http://127.0.0.1:1" }),
      ensureBrowser: async () => ({ executablePath: "/nonexistent/chrome", deterministicDriver: "vt-policy" }),
      launchBrowser: async ({ mode }) => { launches.push(mode); return fakeBrowser(); },
      recordDeterministic: async () => { throw new Error("must not be called"); },
      recordVtPolicy: async ({ out }) => { await fs.writeFile(out, "fake video"); return { frames: 1 }; }
    });
    expect(launches).toEqual(["realtime"]);
  });
});
