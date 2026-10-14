import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readMoc3Version,
  scanMoc3Versions,
  probeCubismCoreGeneration,
  checkLive2DCompat,
  live2dCoreMismatchWarning
} from "../src/live2d-compat.mjs";

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-live2d-compat-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeMoc3(file, version) {
  const buffer = Buffer.alloc(64);
  buffer.write("MOC3", 0, "latin1");
  buffer.writeUInt32LE(version, 4);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
}

describe("readMoc3Version / scanMoc3Versions", () => {
  it("reads the uint32 version after the MOC3 magic", async () => {
    const file = path.join(tmp, "model.moc3");
    await writeMoc3(file, 5);
    expect(await readMoc3Version(file)).toBe(5);
  });

  it("returns null for non-moc3 or unreadable files", async () => {
    const bad = path.join(tmp, "not-a-model.moc3");
    await fs.writeFile(bad, "hello world");
    expect(await readMoc3Version(bad)).toBeNull();
    expect(await readMoc3Version(path.join(tmp, "missing.moc3"))).toBeNull();
  });

  it("scans a game tree and reports the max version", async () => {
    await writeMoc3(path.join(tmp, "figure", "a", "x.moc3"), 5);
    await writeMoc3(path.join(tmp, "figure", "b", "y.moc3"), 4);
    await fs.writeFile(path.join(tmp, "figure", "b", "z.png"), "png");
    const scan = await scanMoc3Versions(tmp);
    expect(scan.files).toBe(2);
    expect(scan.maxVersion).toBe(5);
    expect(scan.byVersion).toEqual({ 4: 1, 5: 1 });
  });
});

describe("probeCubismCoreGeneration (documented size heuristic)", () => {
  it("maps official core sizes to generations", async () => {
    const lib = path.join(tmp, "lib");
    await fs.mkdir(lib, { recursive: true });
    const core = path.join(lib, "live2dcubismcore.min.js");

    await fs.writeFile(core, Buffer.alloc(207155)); // 5-r.4
    expect(probeCubismCoreGeneration(lib).generation).toBe(5);

    await fs.writeFile(core, Buffer.alloc(150388)); // 4.2.0002
    expect(probeCubismCoreGeneration(lib).generation).toBe(4);

    await fs.writeFile(core, Buffer.alloc(10));
    expect(probeCubismCoreGeneration(lib).generation).toBeNull();
  });

  it("reports missing files without throwing", () => {
    const probe = probeCubismCoreGeneration(path.join(tmp, "nope"));
    expect(probe.present).toBe(false);
    expect(probe.generation).toBeNull();
  });
});

describe("checkLive2DCompat", () => {
  it("warns loudly when moc3 v5 models meet a Cubism 4 core", async () => {
    const gameDir = path.join(tmp, "game");
    const libDir = path.join(tmp, "lib");
    await writeMoc3(path.join(gameDir, "figure", "chara", "灯", "c", "m.moc3"), 5);
    await fs.mkdir(libDir, { recursive: true });
    await fs.writeFile(path.join(libDir, "live2dcubismcore.min.js"), Buffer.alloc(150388));
    const result = await checkLive2DCompat(gameDir, libDir);
    expect(result.warning).toMatch(/Cubism 5/);
    expect(result.warning).toMatch(/Cubism 4/);
    expect(result.moc.maxVersion).toBe(5);
  });

  it("stays quiet for v5 models + gen-5 core, and for v3/v4-only projects", async () => {
    const gameDir = path.join(tmp, "game");
    const libDir = path.join(tmp, "lib");
    await writeMoc3(path.join(gameDir, "m.moc3"), 5);
    await fs.mkdir(libDir, { recursive: true });
    await fs.writeFile(path.join(libDir, "live2dcubismcore.min.js"), Buffer.alloc(207155));
    expect((await checkLive2DCompat(gameDir, libDir)).warning).toBeNull();

    // old-format project: moc3 v4 only — fine with either core
    await writeMoc3(path.join(gameDir, "m.moc3"), 4);
    await fs.writeFile(path.join(libDir, "live2dcubismcore.min.js"), Buffer.alloc(150388));
    expect((await checkLive2DCompat(gameDir, libDir)).warning).toBeNull();
  });

  it("warns when the core is missing entirely but models need it", async () => {
    const gameDir = path.join(tmp, "game");
    await writeMoc3(path.join(gameDir, "m.moc3"), 5);
    const result = await checkLive2DCompat(gameDir, path.join(tmp, "no-lib"));
    expect(result.warning).toMatch(/not installed/);
  });
});

describe("live2dCoreMismatchWarning", () => {
  it("explains the authoritative in-page mismatch", () => {
    expect(live2dCoreMismatchWarning(5, 4)).toMatch(/csmGetLatestMocVersion=4/);
    expect(live2dCoreMismatchWarning(5, null)).toMatch(/not loaded/);
  });
});
