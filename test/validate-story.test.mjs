import { describe, it, expect } from "vitest";
import { validateStory } from "../src/mcp/server.mjs";

// Table-driven cases over the story validator the MCP server exposes through
// galcode_validate_story. Shape: { errors: string[], warnings: string[] }.

const manifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  roots: [],
  counts: {},
  assets: [
    { id: "bg-hall", kind: "background", fileName: "hall.jpg", relativePath: "背景/hall.jpg" },
    { id: "bgm-title", kind: "bgm", fileName: "s_Title.mp3", relativePath: "bgm/s_Title.mp3" },
    { id: "fig-plain", kind: "figure", fileName: "stand.png", relativePath: "tachie/stand.png" },
    {
      id: "l2d-tomori",
      kind: "live2d",
      fileName: "model.json",
      relativePath: "mygo/tomori/live_default/model.json",
      motions: ["tomori_idle01", "tomori_cry01"],
      expressions: ["default", "cry01"]
    }
  ]
};

function validStory() {
  return {
    title: "雨后还要继续",
    durationSec: 30,
    characters: ["高松灯"],
    scenes: [
      {
        id: "s1",
        title: "排练室外",
        backgroundAssetId: "bg-hall",
        bgmAssetId: "bgm-title",
        actions: [
          { type: "figure", character: "高松灯", assetId: "l2d-tomori", position: "center", motion: "tomori_idle01", expression: "default" },
          { type: "line", speaker: "高松灯", text: "……听得到吗。", durationSec: 3 },
          { type: "narration", text: "走廊的灯比平时暗一点。", durationSec: 2 },
          { type: "wait", durationSec: 1 }
        ]
      }
    ]
  };
}

const cases = [
  {
    name: "valid minimal story passes with no errors",
    story: validStory(),
    errors: 0
  },
  {
    name: "malformed input (not an object) is one hard error",
    story: "{not a story",
    errors: 1,
    errorIncludes: "Story must be an object."
  },
  {
    name: "story without scenes is one hard error",
    story: { title: "x", scenes: [] },
    errors: 1,
    errorIncludes: "at least one scene"
  },
  {
    name: "unknown backgroundAssetId is an error",
    story: { ...validStory(), scenes: [{ ...validStory().scenes[0], backgroundAssetId: "bg-missing" }] },
    errors: 1,
    errorIncludes: "backgroundAssetId does not exist"
  },
  {
    name: "wrong-kind bgmAssetId is a warning, not an error",
    story: { ...validStory(), scenes: [{ ...validStory().scenes[0], bgmAssetId: "bg-hall" }] },
    errors: 0,
    warnings: 1,
    warningIncludes: "expected bgm"
  },
  {
    name: "figure action without assetId is an error",
    story: withActions([{ type: "figure", character: "高松灯", position: "left" }]),
    errors: 1,
    errorIncludes: "assetId is required"
  },
  {
    name: "figure action with unknown assetId is an error",
    story: withActions([{ type: "figure", character: "高松灯", assetId: "l2d-missing", position: "left", motion: "idle01", expression: "default" }]),
    errors: 1,
    errorIncludes: "assetId does not exist"
  },
  {
    name: "figure action with bad position is an error",
    story: withActions([{ type: "figure", character: "高松灯", assetId: "l2d-tomori", position: "middle", motion: "tomori_idle01", expression: "default" }]),
    errors: 1,
    errorIncludes: "left, center, or right"
  },
  {
    name: "Live2D figure without motion/expression produces two errors",
    story: withActions([{ type: "figure", character: "高松灯", assetId: "l2d-tomori", position: "center" }]),
    errors: 2,
    errorIncludes: "is required for Live2D asset"
  },
  {
    name: "Live2D motion/expression outside the asset list warns twice",
    story: withActions([{ type: "figure", character: "高松灯", assetId: "l2d-tomori", position: "center", motion: "dance99", expression: "wink99" }]),
    errors: 0,
    warnings: 2,
    warningIncludes: "is not listed on asset"
  },
  {
    name: "replacing a character at a position without clearing warns",
    story: withActions([
      { type: "figure", character: "高松灯", assetId: "l2d-tomori", position: "left", motion: "tomori_idle01", expression: "default" },
      { type: "figure", character: "千早爱音", assetId: "l2d-tomori", position: "left", motion: "tomori_cry01", expression: "cry01" }
    ]),
    errors: 0,
    warnings: 1,
    warningIncludes: "character='none'"
  },
  {
    name: "character 'none' clears a position without errors",
    story: withActions([
      { type: "figure", character: "高松灯", assetId: "l2d-tomori", position: "left", motion: "tomori_idle01", expression: "default" },
      { type: "figure", character: "none", position: "left" },
      { type: "figure", character: "千早爱音", assetId: "fig-plain", position: "left" }
    ]),
    errors: 0
  },
  {
    name: "line without text is an error",
    story: withActions([{ type: "line", speaker: "高松灯" }]),
    errors: 1,
    errorIncludes: "text is required"
  },
  {
    name: "wait without a positive duration warns",
    story: withActions([{ type: "wait", durationSec: 0 }]),
    errors: 0,
    warnings: 1,
    warningIncludes: "durationSec should be greater than 0"
  },
  {
    name: "unsupported action type is an error",
    story: withActions([{ type: "sing", text: "♪" }]),
    errors: 1,
    errorIncludes: "type is unsupported"
  }
];

function withActions(actions) {
  return { ...validStory(), scenes: [{ ...validStory().scenes[0], actions }] };
}

describe("validateStory (galcode_validate_story rules)", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = validateStory(testCase.story, manifest);
      expect(result.errors, `errors: ${JSON.stringify(result.errors)}`).toHaveLength(testCase.errors ?? 0);
      if (testCase.warnings !== undefined) {
        expect(result.warnings, `warnings: ${JSON.stringify(result.warnings)}`).toHaveLength(testCase.warnings);
      }
      if (testCase.errorIncludes) {
        expect(result.errors.some((error) => error.includes(testCase.errorIncludes)), `errors: ${JSON.stringify(result.errors)}`).toBe(true);
      }
      if (testCase.warningIncludes) {
        expect(result.warnings.some((warning) => warning.includes(testCase.warningIncludes)), `warnings: ${JSON.stringify(result.warnings)}`).toBe(true);
      }
    });
  }

  it("missing title only warns", () => {
    const story = validStory();
    delete story.title;
    const result = validateStory(story, manifest);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("title"))).toBe(true);
  });
});
