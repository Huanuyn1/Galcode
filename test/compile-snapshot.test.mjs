import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compile snapshot: run the real CLI end to end in offline mode against a
// tiny fixture asset set, then snapshot the generated WebGAL script and the
// story JSON with volatile fields (timestamps, absolute dirs) normalized.
// Hermetic: --offline, --no-theme, fixture assets only — no network, no LLM,
// no vendor engine.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "galcode.js");
const FIXTURE_ASSETS = path.join(ROOT, "test", "fixtures", "assets");
const OUT_DIR = path.join(os.tmpdir(), `galcode-snapshot-${process.pid}`);

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, OPENAI_API_KEY: "", GALCODE_ROOT: ROOT },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`cli exited ${code}: ${stderr}\n${stdout}`));
    });
  });
}

function normalize(text) {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TIMESTAMP>");
}

// Structural normalization for the story JSON: volatile fields (timestamps,
// absolute dirs, platform-dependent id hash suffixes and path separators)
// are replaced before snapshotting, so the snapshot holds on every OS.
function sanitizeStory(story) {
  const clone = JSON.parse(JSON.stringify(story));
  if (clone.meta) {
    clone.meta.generatedAt = "<TIMESTAMP>";
    clone.meta.manifestPath = "<OUT>/asset-manifest.json";
  }
  for (const bgm of clone.bgm ?? []) {
    if (bgm.assetPath) bgm.assetPath = "<ASSETS>/bgm/" + bgm.assetName;
    delete bgm._copiedPath;
  }
  return JSON.stringify(clone, null, 2).replace(/-[0-9a-f]{10}\b/g, "-<HASH>");
}

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("offline compile snapshot", () => {
  it("cli yolo --offline produces the expected WebGAL script and story JSON", async () => {
    // --figure-dir pins the "default figure dir" to a nonexistent path so the
    // test stays hermetic even when the real figure/ contains the (gitignored)
    // chara pack or old mygo pack on a developer machine.
    await runCli(["cli", "yolo", "--offline", "--duration", "5", "--out", OUT_DIR, "--assets", FIXTURE_ASSETS, "--figure-dir", path.join(OUT_DIR, "no-such-figure"), "--no-theme"]);

    const scriptPath = path.join(OUT_DIR, "game", "scene", "start.txt");
    const storyPath = path.join(OUT_DIR, "story.json");
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(storyPath)).toBe(true);

    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("changeBg:");
    expect(script).toContain("bgm:");
    expect(script).toContain("changeFigure:");
    expect(script.trimEnd().endsWith("end;")).toBe(true);
    expect(normalize(script)).toMatchSnapshot();

    const story = JSON.parse(readFileSync(storyPath, "utf8"));
    expect(story.scenes).toHaveLength(1);
    expect(story._timeline.length).toBeGreaterThan(0);
    expect(sanitizeStory(story)).toMatchSnapshot();
  }, 120000);
});
