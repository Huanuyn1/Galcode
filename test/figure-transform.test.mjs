import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStory } from "../src/mcp/server.mjs";

// Live2D default bust-shot framing: chara-pack figure actions must compile to
// changeFigure with the tuned -transform (scale 1.9 / y 505 / x ∓200); an
// explicit action.transform overrides it; static figures and removals get none.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "galcode.js");
// Separate fixture root so the offline-yolo snapshot fixture set (static PNG
// figures only) is unaffected by the chara live2d probe model.
const FIXTURES = path.join(ROOT, "test", "fixtures", "assets-chara");
const TMP = path.join(os.tmpdir(), `galcode-transform-${process.pid}`);

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, OPENAI_API_KEY: "", GALCODE_ROOT: ROOT },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`cli exited ${code}: ${stderr}`))));
  });
}

let manifest;
let script;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const manifestPath = path.join(TMP, "manifest.json");
  await runCli(["cli", "index", "--assets", FIXTURES, "--out", manifestPath]);
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const live2d = manifest.assets.find((a) => a.kind === "live2d" && a.pack === "chara");
  const staticFigure = manifest.assets.find((a) => a.kind === "figure");
  expect(live2d).toBeTruthy();
  expect(staticFigure).toBeTruthy();

  const story = {
    title: "framing test",
    description: "transform compile test",
    durationSec: 30,
    characters: ["高松灯"],
    scenes: [{
      id: "s1",
      title: "s1",
      actions: [
        { type: "figure", character: "高松灯", assetId: live2d.id, position: "left", motion: "mtn_idle01_C", expression: "exp_idle01" },
        { type: "figure", character: "高松灯", assetId: live2d.id, position: "right", motion: "mtn_smile01_C", expression: "exp_idle01" },
        { type: "figure", character: "高松灯", assetId: live2d.id, position: "center", motion: "mtn_idle01_C", expression: "exp_idle01", transform: { x: 50, y: 600, scale: 2.2 } },
        { type: "figure", character: "anon", assetId: staticFigure.id, position: "center" },
        { type: "figure", character: "none", position: "left" }
      ]
    }],
    video: {},
    bgm: []
  };
  const storyPath = path.join(TMP, "story.json");
  writeFileSync(storyPath, JSON.stringify(story));
  await runCli(["cli", "compile", storyPath, "--manifest", manifestPath, "--out", path.join(TMP, "proj"), "--no-theme", "--no-live2d-runtime-check"]);
  script = readFileSync(path.join(TMP, "proj", "game", "scene", "start.txt"), "utf8");
}, 90000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Live2D bust-shot default transform", () => {
  it("emits scale 1.9 / y 505 / x ∓200 for chara figures by position", () => {
    expect(script).toContain('changeFigure:chara/灯/probe/adv_live2d_probe.model3.json -left -id=gal-left -motion=mtn_idle01_C -expression=exp_idle01 -transform={"position":{"x":-200,"y":505},"scale":{"x":1.9,"y":1.9}} -next;');
    expect(script).toContain('-right -id=gal-right -motion=mtn_smile01_C -expression=exp_idle01 -transform={"position":{"x":200,"y":505},"scale":{"x":1.9,"y":1.9}} -next;');
  });

  it("honors an explicit action.transform override", () => {
    expect(script).toContain('-transform={"position":{"x":50,"y":600},"scale":{"x":2.2,"y":2.2}}');
  });

  it("emits no transform for static figures or removals", () => {
    const staticLine = script.split("\n").find((line) => line.includes(".png") && line.startsWith("changeFigure:"));
    expect(staticLine).toBeTruthy();
    expect(staticLine).not.toContain("-transform");
    const removal = script.split("\n").find((line) => line.startsWith("changeFigure:none"));
    expect(removal).toBeTruthy();
    expect(removal).not.toContain("-transform");
  });
});

describe("validator accepts the transform override", () => {
  it("passes a well-formed transform and rejects a malformed one", () => {
    const base = { title: "t", scenes: [] };
    const mk = (transform) => ({
      ...base,
      scenes: [{
        id: "s",
        actions: [{ type: "figure", character: "高松灯", assetId: "x", position: "left", motion: "m", expression: "e", transform }]
      }]
    });
    const manifestLike = { assets: [] };
    expect(validateStory(mk({ x: 0, y: 505, scale: 1.9 }), manifestLike).errors.filter((e) => e.includes("transform"))).toEqual([]);
    expect(validateStory(mk({ position: { x: 0, y: 505 }, scale: { x: 1.9, y: 1.9 } }), manifestLike).errors.filter((e) => e.includes("transform"))).toEqual([]);
    expect(validateStory(mk("big"), manifestLike).errors.some((e) => e.includes("transform"))).toBe(true);
  });
});
