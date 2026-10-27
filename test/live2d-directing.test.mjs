import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectCharaDirecting, resolveLive2DFigure, summarizeDirecting } from "../src/live2d-directing.mjs";
import { validateStory } from "../src/mcp/server.mjs";

const temporaryDirs = [];
afterEach(async () => {
  while (temporaryDirs.length) await fs.rm(temporaryDirs.pop(), { recursive: true, force: true });
});

function entry(name, family, variant = 1, direction = "", coverage = 1) {
  return { name, family, variant, direction, coverage, regions: ["head"] };
}

function asset() {
  return {
    id: "chara-anon",
    kind: "live2d",
    pack: "chara",
    motions: ["mtn_idle01_C", "mtn_denial01_C", "mtn_denial02_L"],
    expressions: ["exp_idle01", "exp_shy01", "exp_shy02"],
    directing: {
      motions: [
        entry("mtn_idle01_C", "idle", 1, "C"),
        entry("mtn_denial01_C", "denial", 1, "C"),
        entry("mtn_denial02_L", "denial", 2, "L"),
        entry("mtn_check01_L", "check", 1, "L")
      ],
      expressions: [entry("exp_idle01", "idle"), entry("exp_shy01", "shy"), entry("exp_shy02", "shy", 2), entry("exp_smile05", "smile", 5)],
      sharedMotions: [entry("A05_素世/mtn_check01_L", "check", 1, "L", 0.8), entry("A03_乐奈/mtn_bye01_C", "bye", 1, "C", 0.2)],
      sharedExpressions: [entry("A05_素世/exp_smile01", "smile", 1, "", 0.9)]
    }
  };
}

describe("Live2D semantic acting resolution", () => {
  it("combines independent body gesture, expression, gaze and intensity", () => {
    expect(resolveLive2DFigure({
      acting: { gesture: "denial", expression: "shy", gaze: "right", intensity: "high" }
    }, asset())).toEqual({ motion: "mtn_denial02_L", expression: "exp_shy02" });
  });

  it("uses the highest available variant for high intensity", () => {
    expect(resolveLive2DFigure({ acting: { gesture: "idle", expression: "smile", intensity: "high" } }, asset()).expression).toBe("exp_smile05");
  });

  it("keeps exact native IDs and compatible shared IDs", () => {
    expect(resolveLive2DFigure({
      motion: "A05_素世/mtn_check01_L",
      expression: "A05_素世/exp_smile01"
    }, asset())).toEqual({ motion: "A05_素世/mtn_check01_L", expression: "A05_素世/exp_smile01" });
  });

  it("rejects unknown and low-coverage exact actions", () => {
    expect(() => resolveLive2DFigure({ motion: "mtn_dance99_C", expression: "exp_idle01" }, asset())).toThrow(/not registered/);
    expect(() => resolveLive2DFigure({ motion: "A03_乐奈/mtn_bye01_C", expression: "exp_idle01" }, asset())).toThrow(/only 20%/);
  });

  it("uses shared actions only by explicit opt-in and prefers native actions", () => {
    expect(() => resolveLive2DFigure({ acting: { gesture: "bye" } }, asset())).toThrow(/native families/);
    expect(resolveLive2DFigure({ acting: { gesture: "check", gaze: "right", allowShared: true } }, asset()).motion).toBe("mtn_check01_L");
    expect(() => resolveLive2DFigure({ acting: { gesture: "bye", allowShared: true } }, asset())).toThrow(/native families/);
  });

  it("summarizes real capabilities rather than raw filenames", () => {
    const summary = summarizeDirecting(asset());
    expect(summary.motionFamilies.find((family) => family.id === "denial")).toMatchObject({ variants: [1, 2], directions: ["C", "L"] });
    expect(summary.expressionFamilies.map((family) => family.id)).toContain("shy");
    expect(summary.sharedExpressionFamilies).toEqual(["smile"]);
  });
});

describe("Live2D metadata extraction", () => {
  it("reads duration, parameter coverage and regions from model files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-directing-test-"));
    temporaryDirs.push(dir);
    await fs.mkdir(path.join(dir, "motions"), { recursive: true });
    await fs.mkdir(path.join(dir, "expressions"), { recursive: true });
    const model = {
      FileReferences: {
        DisplayInfo: "model.cdi3.json",
        Motions: { mtn_smile01_C: [{ File: "motions/mtn_smile01_C.motion3.json" }] },
        Expressions: [{ Name: "exp_smile01", File: "expressions/exp_smile01.exp3.json" }]
      }
    };
    await fs.writeFile(path.join(dir, "model.model3.json"), JSON.stringify(model));
    await fs.writeFile(path.join(dir, "model.cdi3.json"), JSON.stringify({ Parameters: [{ Id: "ParamAngleX" }, { Id: "ParamEyeLOpen" }] }));
    await fs.writeFile(path.join(dir, "motions", "mtn_smile01_C.motion3.json"), JSON.stringify({
      Meta: { Duration: 2.2, Loop: true },
      Curves: [
        { Target: "Parameter", Id: "ParamAngleX" },
        { Target: "Parameter", Id: "ParamMissing" }
      ]
    }));
    await fs.writeFile(path.join(dir, "expressions", "exp_smile01.exp3.json"), JSON.stringify({ Parameters: [{ Id: "ParamEyeLOpen", Value: 0 }] }));

    const catalog = await inspectCharaDirecting(path.join(dir, "model.model3.json"), model);
    expect(catalog.motions[0]).toMatchObject({ name: "mtn_smile01_C", family: "smile", direction: "C", durationSec: 2.2, loop: true, parameterCount: 2, coverage: 0.5, regions: ["head"] });
    expect(catalog.expressions[0]).toMatchObject({ name: "exp_smile01", family: "smile", parameterCount: 1, coverage: 1, regions: ["face"] });
  });
});

describe("story validation with Live2D capabilities", () => {
  function storyWith(figure) {
    return {
      title: "semantic acting",
      scenes: [{ actions: [figure, { type: "line", speaker: "爱音", text: "测试", durationSec: 2 }] }]
    };
  }

  it("accepts semantic acting without raw IDs", () => {
    const result = validateStory(storyWith({ type: "figure", character: "爱音", assetId: "chara-anon", position: "center", acting: { emotion: "shy", gesture: "denial" } }), { assets: [asset()] });
    expect(result.errors).toEqual([]);
  });

  it("turns invalid chara actions into hard errors", () => {
    const result = validateStory(storyWith({ type: "figure", character: "爱音", assetId: "chara-anon", position: "center", motion: "mtn_dance99_C", expression: "exp_idle01" }), { assets: [asset()] });
    expect(result.errors.some((error) => error.includes("not registered"))).toBe(true);
  });
});
