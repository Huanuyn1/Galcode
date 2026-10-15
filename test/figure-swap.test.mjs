import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStory } from "../src/mcp/server.mjs";

// Character-swap flicker regression: an explicit removal intent
// ({type:'figure', assetId:'none'}) must survive story repair — it used to be
// rewritten to the character's best model, making removed characters re-enter
// for a beat before their replacement entered (the visible flicker).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "galcode.js");
const FIXTURES = path.join(ROOT, "test", "fixtures", "assets-chara");
const TMP = path.join(os.tmpdir(), `galcode-swap-${process.pid}`);

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

let script;
let story;
let manifest;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const manifestPath = path.join(TMP, "manifest.json");
  await runCli(["cli", "index", "--assets", FIXTURES, "--out", manifestPath]);
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const anon = manifest.assets.find((a) => a.kind === "live2d" && a.pack === "chara" && a.id.includes("爱音"));
  const tomori = manifest.assets.find((a) => a.kind === "live2d" && a.pack === "chara" && a.id.includes("灯"));
  expect(anon).toBeTruthy();
  expect(tomori).toBeTruthy();

  story = {
    title: "swap flicker regression",
    description: "",
    durationSec: 20,
    characters: ["千早爱音", "高松灯"],
    scenes: [
      {
        id: "s1",
        title: "s1",
        actions: [
          { type: "figure", character: "千早爱音", assetId: anon.id, position: "left", motion: "mtn_idle01_L", expression: "exp_idle01" },
          { type: "figure", character: "高松灯", assetId: tomori.id, position: "center", motion: "mtn_idle01_C", expression: "exp_idle01" },
          { type: "line", speaker: "千早爱音", text: "第一场。", durationSec: 3 }
        ]
      },
      {
        id: "s2",
        title: "s2",
        actions: [
          { type: "figure", character: "千早爱音", assetId: "none", position: "left" },
          { type: "figure", character: "高松灯", assetId: "none", position: "center" },
          { type: "figure", character: "高松灯", assetId: tomori.id, position: "right", motion: "mtn_idle01_R", expression: "exp_idle01" },
          { type: "line", speaker: "高松灯", text: "第二场。", durationSec: 3 }
        ]
      }
    ],
    video: {},
    bgm: []
  };
  const storyPath = path.join(TMP, "story.json");
  writeFileSync(storyPath, JSON.stringify(story));
  await runCli(["cli", "compile", storyPath, "--manifest", manifestPath, "--out", path.join(TMP, "proj"), "--no-theme"]);
  script = readFileSync(path.join(TMP, "proj", "game", "scene", "start.txt"), "utf8");
}, 90000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("explicit figure removals survive compile (swap flicker fix)", () => {
  it("emits changeFigure:none for removals and never re-enters the removed character", () => {
    const scene2 = script.split("; Scene: s2")[1] || "";
    expect(scene2).toContain("changeFigure:none -left -next;");
    expect(scene2).not.toContain("changeFigure:chara/爱音/");
    expect(scene2).toContain("changeFigure:chara/灯/probe/adv_live2d_probe.model3.json -right -id=fig-right");
  });

  it("still re-enters when the story actually wants the character back with a real assetId", () => {
    // scene 1 used 爱音's real model — repair must keep repairing real ids
    const scene1 = script.split("; Scene: s1")[1].split("; Scene: s2")[0];
    expect(scene1).toContain("changeFigure:chara/爱音/probe/adv_live2d_probe_anon.model3.json -left");
  });

  it("validator accepts assetId:'none' as a removal (no unknown-asset error)", () => {
    const scene = story.scenes[1];
    const result = validateStory({ title: "t", scenes: [scene] }, manifest);
    expect(result.errors.filter((e) => e.includes("none"))).toEqual([]);
  });
});
