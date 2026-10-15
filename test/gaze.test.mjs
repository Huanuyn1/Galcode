import { describe, it, expect } from "vitest";
import { applyGazeDirection, splitMotionDirection, directionSuffixToward } from "../src/gaze.mjs";

// applyGazeDirection v2 tests with stub manifests. Suffix semantics
// (parameter-verified): _L ⇒ face screen-right, _R ⇒ face screen-left,
// _C ⇒ face audience. Beat model: only lines advance the beat; figure actions
// belong to the upcoming line's beat.

const identity = (name) => String(name || "");
const deps = {
  canonicalCharacterKey: identity,
  isCharaLive2DAsset: (asset) => asset?.kind === "live2d" && asset?.pack === "chara"
};

function manifestWith(motionsById, packsById = {}) {
  return {
    assets: Object.entries(motionsById).map(([id, motions]) => ({
      id,
      kind: "live2d",
      pack: packsById[id] ?? "chara",
      motions,
      path: `chara/${id}/probe/m.model3.json`
    }))
  };
}

const FULL = ["mtn_idle01_L", "mtn_idle01_C", "mtn_idle01_R", "mtn_nod01_L", "mtn_nod01_C", "mtn_nod01_R", "mtn_nod02_L", "mtn_nod02_C", "mtn_nod02_R", "mtn_smile01_L", "mtn_smile01_C", "mtn_thinking01_C", "mtn_thinking01_L"];

const fig = (character, assetId, position, motion, expression = "exp_idle01") =>
  ({ type: "figure", character, assetId, position, motion, expression });
const line = (speaker, text = "台词") => ({ type: "line", speaker, text, durationSec: 4 });
const narr = (text = "旁白") => ({ type: "narration", text, durationSec: 3 });

function storyOf(actions) {
  return { title: "t", scenes: [{ id: "s", title: "s", actions }], bgm: [] };
}

function motionsOf(s, character) {
  return s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === character).map((a) => a.motion);
}

describe("splitMotionDirection / directionSuffixToward", () => {
  it("parses native directional names only", () => {
    expect(splitMotionDirection("mtn_idle01_L")).toEqual({ base: "mtn_idle01", suffix: "L" });
    expect(splitMotionDirection("mtn_smile02_R")).toEqual({ base: "mtn_smile02", suffix: "R" });
    expect(splitMotionDirection("mtn_idle_01")).toBeNull();
    expect(splitMotionDirection("A05_素世/mtn_idle01_L")).toBeNull();
    expect(splitMotionDirection("")).toBeNull();
  });

  it("maps positions to the facing suffix (suffix faces inward)", () => {
    expect(directionSuffixToward("left", "center")).toBe("L"); // face screen-right
    expect(directionSuffixToward("right", "center")).toBe("R"); // face screen-left
    expect(directionSuffixToward("center", "left")).toBe("R");
    expect(directionSuffixToward("center", "right")).toBe("L");
    expect(directionSuffixToward("center", "center")).toBe("C");
    expect(directionSuffixToward("left", null)).toBe("C");
  });
});

describe("applyGazeDirection v2", () => {
  it("nods on speaker change when the bystander already faces the speaker", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("千早爱音"),
      line("高松灯", "换人了")
    ]);
    const summary = applyGazeDirection(s, manifestWith({ anon: FULL, taki: FULL, tomori: FULL }), deps);
    expect(summary.nods).toBe(1);
    // 立希 (right, already facing center via _R) nods toward the center speaker
    expect(motionsOf(s, "椎名立希")).toContain("mtn_nod01_R");
  });

  it("does nothing when the same speaker continues (cadence)", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      line("千早爱音"),
      line("千早爱音", "还是她"),
      line("千早爱音", "继续说")
    ]);
    const summary = applyGazeDirection(s, manifestWith({ anon: FULL, taki: FULL }), deps);
    expect(summary.nods).toBe(0);
    expect(summary.turns).toBe(0);
  });

  it("turns a stale expressive base by swapping only the suffix (emotion preserved)", () => {
    const s2 = storyOf([
      fig("高松灯", "tomori", "center", "mtn_thinking01_C"),
      fig("千早爱音", "anon", "left", "mtn_smile01_L"),
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      line("千早爱音"),
      line("椎名立希")
    ]);
    const m = manifestWith({ anon: FULL, taki: FULL, tomori: FULL });
    const summary = applyGazeDirection(s2, m, deps);
    // 灯's thinking01_C is stale at 立希's line; direction to right = _L.
    expect(summary.turns).toBeGreaterThanOrEqual(1);
    expect(motionsOf(s2, "高松灯")).toContain("mtn_thinking01_L");
  });

  it("nod fallback chain: nod01 missing → nod02; both missing → replay current base; nothing → leave", () => {
    const baseStory = () => storyOf([
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("千早爱音"),
      line("高松灯", "换人")
    ]);

    // nod01_R missing, nod02_R present → nod02_R
    const sA = baseStory();
    const mA = manifestWith({
      anon: FULL,
      taki: ["mtn_idle01_R", "mtn_nod02_R"],
      tomori: FULL
    });
    applyGazeDirection(sA, mA, deps);
    expect(motionsOf(sA, "椎名立希")).toContain("mtn_nod02_R");

    // neither nod variant → replay the current base_D as the attention cue
    const sB = baseStory();
    const mB = manifestWith({
      anon: FULL,
      taki: ["mtn_idle01_R"],
      tomori: FULL
    });
    applyGazeDirection(sB, mB, deps);
    expect(motionsOf(sB, "椎名立希")).toEqual(["mtn_idle01_R", "mtn_idle01_R"]); // entry + replay

    // nothing usable (no nods, and current base variant gone) → leave + count
    const sC = baseStory();
    const mC = manifestWith({
      anon: FULL,
      taki: ["mtn_idle01_L"], // note: authored suffix R is not even in the list; base replay impossible
      tomori: FULL
    });
    sC.scenes[0].actions[0] = fig("椎名立希", "taki", "right", "mtn_idle01_R");
    const summaryC = applyGazeDirection(sC, mC, deps);
    expect(summaryC.nods).toBe(0);
    expect(summaryC.skippedMissingVariant).toBeGreaterThanOrEqual(1);
    expect(motionsOf(sC, "椎名立希")).toEqual(["mtn_idle01_R"]);
  });

  it("preserves anything authored at the current beat, no exceptions", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      line("千早爱音"),
      fig("椎名立希", "taki", "right", "mtn_idle01_C"), // authored right before 灯's line
      line("高松灯")
    ]);
    const summary = applyGazeDirection(s, manifestWith({ anon: FULL, taki: FULL, tomori: FULL }), deps);
    expect(summary.preservedAuthoredBeat).toBeGreaterThanOrEqual(1);
    expect(motionsOf(s, "椎名立希")).toEqual(["mtn_idle01_R", "mtn_idle01_C"]); // no turn/nod inserted
  });

  it("turns the idle speaker to the audience (_C), preserves expressive speaker motion", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_L"),
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      line("椎名立希"),
      line("千早爱音")
    ]);
    const summary = applyGazeDirection(s, manifestWith({ anon: FULL, taki: FULL }), deps);
    // both speakers were on idle-family directional motions → both turned _C
    expect(summary.speakerTurns).toBe(2);
    expect(motionsOf(s, "千早爱音")).toContain("mtn_idle01_C");
    expect(motionsOf(s, "椎名立希")).toContain("mtn_idle01_C");
    // and when 爱音 speaks, 立希 (stale audience-facing idle) turns back to face her
    expect(motionsOf(s, "椎名立希").at(-1)).toBe("mtn_idle01_R");

    const s2 = storyOf([
      fig("千早爱音", "anon", "left", "mtn_smile01_L"),
      fig("椎名立希", "taki", "right", "mtn_idle01_R"),
      line("椎名立希"),
      line("千早爱音")
    ]);
    const summary2 = applyGazeDirection(s2, manifestWith({ anon: FULL, taki: FULL }), deps);
    expect(summary2.speakerTurns).toBe(1); // only 立希 (idle); 爱音's smile01_L preserved
    expect(motionsOf(s2, "千早爱音")).toEqual(["mtn_smile01_L"]);
  });

  it("center speaker: left bystander turns _L (faces right), right bystander turns _R (faces left)", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("椎名立希", "taki", "right", "mtn_idle01_C"),
      fig("高松灯", "tomori", "center", "mtn_thinking01_C"),
      line("千早爱音"),
      line("高松灯")
    ]);
    applyGazeDirection(s, manifestWith({ anon: FULL, taki: FULL, tomori: FULL }), deps);
    expect(motionsOf(s, "千早爱音")).toContain("mtn_idle01_L");
    expect(motionsOf(s, "椎名立希")).toContain("mtn_idle01_R");
  });

  it("never touches old mygo pack figures or cross-character motion names", () => {
    const s = storyOf([
      fig("高松灯", "oldmygo", "left", "tomori_idle01"),
      fig("千早爱音", "anon", "right", "A05_素世/mtn_idle01_R"),
      line("千早爱音"),
      line("高松灯")
    ]);
    const m = manifestWith({ anon: FULL }, { anon: "chara" });
    m.assets.push({ id: "oldmygo", kind: "live2d", pack: "", motions: ["tomori_idle01"], path: "live2d/old/model.json" });
    const summary = applyGazeDirection(s, m, deps);
    expect(summary.retargeted).toBe(0);
    expect(motionsOf(s, "高松灯")).toEqual(["tomori_idle01"]);
    expect(motionsOf(s, "千早爱音")).toEqual(["A05_素世/mtn_idle01_R"]);
  });

  it("narration does not drive attention (no beat advance, no change)", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      narr(),
      narr("第二段"),
      line("千早爱音")
    ]);
    const summary = applyGazeDirection(s, manifestWith({ anon: FULL }), deps);
    expect(summary.turns).toBe(0);
    expect(summary.nods).toBe(0);
    // speaker's own idle01_C already C — and nothing else happened
    expect(motionsOf(s, "千早爱音")).toEqual(["mtn_idle01_C"]);
  });

  it("leaves the pose when the needed turn variant is missing on the model", () => {
    // 灯 at right must face screen-left (_R) toward 立希 at left; her model
    // has no _R variants → pose unchanged, counted as missing.
    const s = storyOf([
      fig("高松灯", "tomori", "right", "mtn_idle01_C"),
      fig("椎名立希", "taki", "left", "mtn_idle01_L"),
      line("椎名立希"),
      line("椎名立希", "第二句") // second line: 灯's pose is stale now
    ]);
    const m = manifestWith({
      tomori: ["mtn_idle01_C", "mtn_idle01_L"], // no _R
      taki: FULL
    });
    const summary = applyGazeDirection(s, m, deps);
    expect(summary.skippedMissingVariant).toBeGreaterThanOrEqual(1);
    expect(motionsOf(s, "高松灯")).toEqual(["mtn_idle01_C"]);
  });

  it("inserted actions carry no duration (timeline unchanged)", () => {
    const s = storyOf([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("椎名立希", "taki", "right", "mtn_idle01_C"),
      line("千早爱音"),
      line("椎名立希"),
      line("千早爱音")
    ]);
    applyGazeDirection(s, manifestWith({ anon: FULL, taki: FULL }), deps);
    for (const a of s.scenes[0].actions.filter((a) => a.type === "figure")) {
      expect(a.durationSec).toBeUndefined();
    }
  });
});
