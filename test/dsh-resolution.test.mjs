import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseDshVersion,
  compareDshVersions,
  dshVersionCompatible,
  resolveDshInstallation,
  ensureDshInstallation,
  DSH_MIN_VERSION
} from "../src/dsh-profile.mjs";

// dsh resolution unit tests — hermetic: stubbed directories and version
// probes, no real npm/dsh processes.

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-dsh-resolve-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeDshPackage(root) {
  const jsPath = path.join(root, "@deepseek-ai", "dsh", "lib", "bin.js");
  await fs.mkdir(path.dirname(jsPath), { recursive: true });
  await fs.writeFile(jsPath, "// fake dsh bin\n");
  return jsPath;
}

// PATH layout: <binDir>/dsh[.cmd] + <binDir>/node_modules/@deepseek-ai/dsh/lib/bin.js
async function makePathDsh(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  const jsPath = await makeDshPackage(path.join(binDir, "node_modules"));
  await fs.writeFile(path.join(binDir, process.platform === "win32" ? "dsh.cmd" : "dsh"), "rem fake\n");
  return jsPath;
}

const probeAs = (versionsByPath) => async (_exec, jsPath) => {
  const v = versionsByPath[jsPath];
  if (v === undefined) throw new Error("broken install");
  return v;
};

describe("parseDshVersion / compareDshVersions / dshVersionCompatible", () => {
  it("parses rc and release versions", () => {
    expect(parseDshVersion("0.2.0-rc.2")).toMatchObject({ major: 0, minor: 2, patch: 0, rc: 2 });
    expect(parseDshVersion("dsh 0.2.0-rc.10\n")).toMatchObject({ rc: 10 });
    expect(parseDshVersion("0.2.1")).toMatchObject({ patch: 1, rc: null });
    expect(parseDshVersion("garbage")).toBeNull();
  });

  it("orders rc below release and compares rc numbers", () => {
    expect(compareDshVersions(parseDshVersion("0.2.0-rc.2"), parseDshVersion("0.2.0-rc.3"))).toBeLessThan(0);
    expect(compareDshVersions(parseDshVersion("0.2.0-rc.10"), parseDshVersion("0.2.0-rc.2"))).toBeGreaterThan(0);
    expect(compareDshVersions(parseDshVersion("0.2.0"), parseDshVersion("0.2.0-rc.99"))).toBeGreaterThan(0);
  });

  it("accepts the 0.2.x line at >= 0.2.0-rc.2 only", () => {
    expect(dshVersionCompatible("0.2.0-rc.2")).toBe(true);
    expect(dshVersionCompatible("0.2.0-rc.7")).toBe(true);
    expect(dshVersionCompatible("0.2.0")).toBe(true);
    expect(dshVersionCompatible("0.2.1")).toBe(true);
    expect(dshVersionCompatible("0.2.0-rc.1")).toBe(false);
    expect(dshVersionCompatible("0.1.9")).toBe(false);
    expect(dshVersionCompatible("0.3.0")).toBe(false);
    expect(dshVersionCompatible("1.0.0")).toBe(false);
    expect(dshVersionCompatible("not-a-version")).toBe(false);
  });
});

describe("resolveDshInstallation — source order", () => {
  it("prefers repo-local node_modules over PATH and global", async () => {
    const repoRoot = path.join(tmp, "repo");
    const repoJs = await makeDshPackage(path.join(repoRoot, "node_modules"));
    const binDir = path.join(tmp, "bin");
    const pathJs = await makePathDsh(binDir);
    const globalRoot = path.join(tmp, "global");
    const globalJs = await makeDshPackage(globalRoot);

    const found = await resolveDshInstallation({
      repoRoot,
      env: { PATH: binDir },
      npmGlobalRoot: async () => globalRoot,
      probeVersion: probeAs({ [repoJs]: "0.2.0-rc.2", [pathJs]: "0.2.0-rc.3", [globalJs]: "0.2.0-rc.4" })
    });
    expect(found.source).toBe("repo-dev");
    expect(found.jsPath).toBe(repoJs);
    expect(found.version).toBe("0.2.0-rc.2");
    expect(found.compatible).toBe(true);
  });

  it("falls back to PATH, then to the npm global root", async () => {
    const binDir = path.join(tmp, "bin");
    const pathJs = await makePathDsh(binDir);
    const globalRoot = path.join(tmp, "global");
    const globalJs = await makeDshPackage(globalRoot);

    const fromPath = await resolveDshInstallation({
      repoRoot: path.join(tmp, "no-repo"),
      env: { PATH: binDir },
      npmGlobalRoot: async () => globalRoot,
      probeVersion: probeAs({ [pathJs]: "0.2.0-rc.2", [globalJs]: "0.2.0-rc.2" })
    });
    expect(fromPath.source).toBe("PATH");

    const fromGlobal = await resolveDshInstallation({
      repoRoot: path.join(tmp, "no-repo"),
      env: { PATH: path.join(tmp, "empty-bin") },
      npmGlobalRoot: async () => globalRoot,
      probeVersion: probeAs({ [globalJs]: "0.2.0-rc.2" })
    });
    expect(fromGlobal.source).toBe("global");
    expect(fromGlobal.jsPath).toBe(globalJs);
  });

  it("returns null when nothing is found anywhere", async () => {
    const found = await resolveDshInstallation({
      repoRoot: path.join(tmp, "no-repo"),
      env: { PATH: path.join(tmp, "empty") },
      npmGlobalRoot: async () => path.join(tmp, "no-global"),
      probeVersion: async () => "0.2.0-rc.2"
    });
    expect(found).toBeNull();
  });

  it("skips a broken install and uses the next source", async () => {
    const repoRoot = path.join(tmp, "repo");
    const repoJs = await makeDshPackage(path.join(repoRoot, "node_modules"));
    const binDir = path.join(tmp, "bin");
    const pathJs = await makePathDsh(binDir);
    const found = await resolveDshInstallation({
      repoRoot,
      env: { PATH: binDir },
      npmGlobalRoot: async () => "",
      probeVersion: probeAs({ [repoJs]: undefined, [pathJs]: "0.2.0-rc.2" })
    });
    expect(found.source).toBe("PATH");
  });

  it("warns loudly but returns an incompatible dsh as fallback", async () => {
    const repoRoot = path.join(tmp, "repo");
    const repoJs = await makeDshPackage(path.join(repoRoot, "node_modules"));
    const found = await resolveDshInstallation({
      repoRoot,
      env: { PATH: "" },
      npmGlobalRoot: async () => "",
      probeVersion: probeAs({ [repoJs]: "0.2.0-rc.1" })
    });
    expect(found.compatible).toBe(false);
    expect(found.warning).toMatch(/npm i -g/);
    expect(found.warning).toMatch(DSH_MIN_VERSION);
  });
});

describe("ensureDshInstallation", () => {
  it("auto-installs when nothing is found, then resolves the new install", async () => {
    const globalRoot = path.join(tmp, "global");
    let installs = 0;
    const found = await ensureDshInstallation({
      repoRoot: path.join(tmp, "no-repo"),
      env: { PATH: path.join(tmp, "empty") },
      npmGlobalRoot: async () => globalRoot,
      probeVersion: async () => "0.2.0-rc.2",
      installImpl: async () => {
        installs += 1;
        await makeDshPackage(globalRoot); // simulate npm i -g landing
        return { code: 0, output: "added 1 package" };
      },
      log: () => {}
    });
    expect(installs).toBe(1);
    expect(found.source).toBe("global");
    expect(found.compatible).toBe(true);
  });

  it("does not install when an existing dsh resolves", async () => {
    const repoRoot = path.join(tmp, "repo");
    const repoJs = await makeDshPackage(path.join(repoRoot, "node_modules"));
    let installs = 0;
    const found = await ensureDshInstallation({
      repoRoot,
      env: { PATH: "" },
      npmGlobalRoot: async () => "",
      probeVersion: probeAs({ [repoJs]: "0.2.0-rc.2" }),
      installImpl: async () => { installs += 1; return { code: 0, output: "" }; },
      log: () => {}
    });
    expect(installs).toBe(0);
    expect(found.source).toBe("repo-dev");
  });

  it("gives an actionable EACCES message when npm install fails on permissions", async () => {
    await expect(ensureDshInstallation({
      repoRoot: path.join(tmp, "no-repo"),
      env: { PATH: path.join(tmp, "empty") },
      npmGlobalRoot: async () => path.join(tmp, "no-global"),
      probeVersion: async () => "0.2.0-rc.2",
      installImpl: async () => ({ code: 1, output: "npm ERR! Error: EACCES: permission denied, mkdir '/usr/lib/node_modules'" }),
      log: () => {}
    })).rejects.toThrow(/npm config set prefix/);
  });

  it("throws when npm succeeds but dsh is still unresolvable", async () => {
    await expect(ensureDshInstallation({
      repoRoot: path.join(tmp, "no-repo"),
      env: { PATH: path.join(tmp, "empty") },
      npmGlobalRoot: async () => path.join(tmp, "no-global"),
      probeVersion: async () => "0.2.0-rc.2",
      installImpl: async () => ({ code: 0, output: "ok" }),
      log: () => {}
    })).rejects.toThrow(/still not resolvable/);
  });
});
