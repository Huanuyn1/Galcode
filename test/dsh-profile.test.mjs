import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveDshHome,
  resolveProfileDir,
  profileReadiness,
  setupDshProfile,
  DSH_PROFILE_NAME,
  DSH_TUI_PACKAGE,
  DSH_BUNDLE_PACKAGE
} from "../src/dsh-profile.mjs";

// dsh-profile unit tests. Hermetic: no network and no real pnpm/dsh runs —
// setup's install/verify seams are stubbed, everything else runs against a
// scratch DSH_HOME in the temp dir.

const HOME = os.homedir();
const scratchDirs = [];

afterEach(() => {
  while (scratchDirs.length) rmSync(scratchDirs.pop(), { recursive: true, force: true });
});

function scratchDir(name) {
  const dir = path.join(os.tmpdir(), `galcode-test-${name}-${process.pid}-${scratchDirs.length}`);
  scratchDirs.push(dir);
  return dir;
}

describe("resolveDshHome", () => {
  it("prefers an explicit configured path over the environment", () => {
    expect(resolveDshHome("/configured/dsh", { DSH_HOME: "/env/dsh" })).toBe(path.resolve("/configured/dsh"));
  });

  it("uses $DSH_HOME when set", () => {
    expect(resolveDshHome(undefined, { DSH_HOME: "/env/dsh" })).toBe(path.resolve("/env/dsh"));
  });

  it("treats a blank $DSH_HOME as unset and falls back to ~/.dsh", () => {
    for (const blank of ["", "   ", "\t"]) {
      expect(resolveDshHome(undefined, { DSH_HOME: blank })).toBe(path.resolve(HOME, ".dsh"));
    }
  });

  it("defaults to ~/.dsh without the env var", () => {
    expect(resolveDshHome(undefined, {})).toBe(path.resolve(HOME, ".dsh"));
  });

  it("expands ~, ~/ and ~\\ prefixes against the OS home", () => {
    expect(resolveDshHome("~", {})).toBe(path.resolve(HOME));
    expect(resolveDshHome("~/data", {})).toBe(path.resolve(HOME, "data"));
    expect(resolveDshHome("~\\data", {})).toBe(path.resolve(HOME, "data"));
    expect(resolveDshHome(undefined, { DSH_HOME: "~/dsh" })).toBe(path.resolve(HOME, "dsh"));
  });
});

describe("profileReadiness", () => {
  it("reports a missing manifest first", () => {
    const dir = scratchDir("readiness");
    expect(profileReadiness(null, dir)).toEqual(["package.json missing"]);
  });

  it("lists missing bundles and missing installed packages", () => {
    const dir = scratchDir("readiness");
    mkdirSync(dir, { recursive: true });
    const manifest = { dependencies: {}, dsh: { profile: { bundles: [] } } };
    const problems = profileReadiness(manifest, dir);
    expect(problems.some((problem) => problem.includes("@deepseek-ai/dsh-base"))).toBe(true);
    expect(problems.some((problem) => problem.includes(DSH_TUI_PACKAGE))).toBe(true);
    expect(problems.some((problem) => problem.includes(DSH_BUNDLE_PACKAGE))).toBe(true);
  });

  it("passes when the manifest and node_modules markers are complete", () => {
    const dir = scratchDir("readiness");
    mkdirSync(path.join(dir, "node_modules", "@deepseek-harness-tui", "dsh-tui"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "dsh-galcode"), { recursive: true });
    const manifest = { dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE] } } };
    expect(profileReadiness(manifest, dir)).toEqual([]);
  });
});

describe("setupDshProfile (stubbed official install/verify)", () => {
  const fakeDsh = { jsPath: "/fake/dsh.js", version: "0.2.0-rc.2" };

  function stubOfficialInstall(profileDir) {
    const manifestPath = path.join(profileDir, "package.json");
    const existing = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8"))
      : { name: "dsh-profile-galcode", private: true };
    const bundles = ["@deepseek-ai/dsh-base"];
    for (const bundle of [DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE, ...(existing.dsh?.profile?.bundles || [])]) {
      if (!bundles.includes(bundle)) bundles.push(bundle);
    }
    const manifest = {
      ...existing,
      dependencies: {
        ...(existing.dependencies || {}),
        [DSH_TUI_PACKAGE]: "0.13.0",
        [DSH_BUNDLE_PACKAGE]: "link:/fake/dsh-galcode"
      },
      dsh: { ...(existing.dsh || {}), profile: { bundles } }
    };
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    mkdirSync(path.join(profileDir, "node_modules", "@deepseek-harness-tui", "dsh-tui"), { recursive: true });
    mkdirSync(path.join(profileDir, "node_modules", "dsh-galcode"), { recursive: true });
    if (!existsSync(path.join(profileDir, "cordis.patch.yml"))) writeFileSync(path.join(profileDir, "cordis.patch.yml"), "[]\n", "utf8");
    return Promise.resolve();
  }

  function options(home, log = () => {}) {
    return {
      dshHome: home,
      log,
      dsh: fakeDsh,
      install: stubOfficialInstall,
      verify: async () => {}
    };
  }

  it("delegates profile creation to dsh and preserves user changes on re-run", async () => {
    const home = scratchDir("dsh-home");
    const profileDir = resolveProfileDir(home);
    const lines = [];
    await setupDshProfile(options(home, (line) => lines.push(line)));
    expect(lines.some((line) => line.includes("dsh plugin"))).toBe(true);

    const manifest = JSON.parse(readFileSync(path.join(profileDir, "package.json"), "utf8"));
    expect(manifest.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE]);
    expect(manifest.dependencies[DSH_BUNDLE_PACKAGE]).toBe("link:/fake/dsh-galcode");

    writeFileSync(path.join(profileDir, "cordis.patch.yml"), "# user notes\n[]\n", "utf8");
    manifest.dependencies["some-user-plugin"] = "1.2.3";
    manifest.dsh.profile.bundles.push("some-user-plugin");
    writeFileSync(path.join(profileDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await setupDshProfile(options(home));
    expect(readFileSync(path.join(profileDir, "cordis.patch.yml"), "utf8")).toBe("# user notes\n[]\n");
    const merged = JSON.parse(readFileSync(path.join(profileDir, "package.json"), "utf8"));
    expect(merged.dependencies["some-user-plugin"]).toBe("1.2.3");
    expect(merged.dsh.profile.bundles).toEqual(["@deepseek-ai/dsh-base", DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE, "some-user-plugin"]);
    expect(merged.dsh.profile.bundles.filter((bundle) => bundle === DSH_TUI_PACKAGE)).toHaveLength(1);
  });

  it("resolves dsh through the injectable installer seam", async () => {
    const home = scratchDir("dsh-home-ensure");
    let ensured = 0;
    await setupDshProfile({
      ...options(home),
      dsh: undefined,
      ensureDsh: async () => { ensured += 1; return fakeDsh; }
    });
    expect(ensured).toBe(1);
  });

  it("fails when the official install leaves the profile incomplete", async () => {
    const home = scratchDir("dsh-home-broken");
    await expect(setupDshProfile({
      ...options(home),
      install: async () => {}
    })).rejects.toThrow("profile install incomplete");
  });
});
