import { describe, it, expect } from "vitest";
import { applyGazeDirection, splitMotionDirection } from "../src/gaze.mjs";

// applyGazeDirection unit tests with a stub manifest (fixture-shaped chara
// assets). Suffix semantics (probe-established): _L ⇒ face screen-right,
// _R ⇒ face screen-left, _C ⇒ face audience.

const ANON_MOTIONS = ["mtn_idle01_L", "mtn_idle01_C", "mtn_idle01_R", "mtn_smile01_L", "mtn_smile01_C"];
const TOMORI_MOTIONS = ["mtn_idle01_L", "mtn_idle01_C", "mtn_smile01_C"]; // no _R variants

function manifest() {
  return {
    assets: [
      { id: "anon", kind: "live2d", pack: "chara", motions: ANON_MOTIONS, path: "chara/爱音/probe/m.model3.json" },
      { id: "tomori", kind: "live2d", pack: "chara", motions: TOMORI_MOTIONS, path: "chara/灯/probe/m.model3.json" },
      { id: "oldmygo", kind: "live2d", pack: "", motions: ["tomori_idle01"], path: "live2d/old/model.json" }
    ]
  };
}
const deps = {
  canonicalCharacterKey: (name) => String(name || ""),
  isCharaLive2DAsset: (asset) => asset?.kind === "live2d" && asset?.pack === "chara"
};
const fig = (character, assetId, position, motion, expression = "exp_idle01") =>
  ({ type: "figure", character, assetId, position, motion, expression });
const line = (speaker, text = "台词") => ({ type: "line", speaker, text, durationSec: 4 });

function story(actions) {
  return { title: "t", scenes: [{ id: "s", title: "s", actions }], bgm: [] };
}

describe("splitMotionDirection", () => {
  it("parses native directional names only", () => {
    expect(splitMotionDirection("mtn_idle01_L")).toEqual({ base: "mtn_idle01", suffix: "L" });
    expect(splitMotionDirection("mtn_smile02_R")).toEqual({ base: "mtn_smile02", suffix: "R" });
    expect(splitMotionDirection("mtn_idle_01")).toBeNull();
    expect(splitMotionDirection("A05_素世/mtn_idle01_L")).toBeNull(); // cross-character
    expect(splitMotionDirection("idle01")).toBeNull();
    expect(splitMotionDirection("")).toBeNull();
  });
});

describe("applyGazeDirection", () => {
  it("others face the speaker: right-positioned idle figure faces screen-left (_R) toward a center speaker", () => {
    const s = story([
      fig("千早爱音", "anon", "right", "mtn_idle01_C"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("高松灯")
    ]);
    const summary = applyGazeDirection(s, manifest(), deps);
    expect(summary.retargeted).toBe(1);
    const inserted = s.scenes[0].actions.find((a) => a.type === "figure" && a.motion === "mtn_idle01_R");
    expect(inserted).toBeTruthy();
    expect(inserted.character).toBe("千早爱音");
    expect(inserted.position).toBe("right");
    // speaker (center) faces the audience → stays C variant
    const speakerFigs = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "高松灯");
    expect(speakerFigs.map((a) => a.motion)).toEqual(["mtn_idle01_C"]);
  });

  it("left-positioned idle figure faces screen-right (_L) toward a right speaker", () => {
    const s = story([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("高松灯", "tomori", "right", "mtn_idle01_C"),
      line("高松灯")
    ]);
    applyGazeDirection(s, manifest(), deps);
    const inserted = s.scenes[0].actions.find((a) => a.type === "figure" && a.motion === "mtn_idle01_L" && a.character === "千早爱音");
    // 爱音 at left must face screen-right toward 灯 at right: suffix _L.
    // (Her authored idle01_C is retargeted to idle01_L.)
    const motions = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "千早爱音").map((a) => a.motion);
    expect(motions).toContain("mtn_idle01_L");
  });

  it("an idle speaker is turned to the audience (_C) once the beat moves on", () => {
    // 爱音 enters facing screen-right (_L) toward 灯 — that same-beat
    // choreography is respected on 灯's line; when 爱音 then speaks, her pose
    // is from an earlier beat and gets retargeted to the audience (_C).
    const s = story([
      fig("千早爱音", "anon", "left", "mtn_idle01_L"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("高松灯"),
      line("千早爱音")
    ]);
    const summary = applyGazeDirection(s, manifest(), deps);
    const speakerFigs = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "千早爱音");
    expect(speakerFigs.map((a) => a.motion)).toContain("mtn_idle01_C");
    expect(summary.retargeted).toBe(1);
  });

  it("never overrides expressive (non-idle) motions", () => {
    const s = story([
      fig("千早爱音", "anon", "left", "mtn_smile01_L"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("高松灯")
    ]);
    const summary = applyGazeDirection(s, manifest(), deps);
    expect(summary.retargeted).toBe(0);
    expect(summary.skippedExpressive).toBe(1);
    const motions = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "千早爱音").map((a) => a.motion);
    expect(motions).toEqual(["mtn_smile01_L"]);
  });

  it("leaves the figure alone when the needed variant is missing on the model", () => {
    // 灯 has no _R variants at all; she stands at right, speaker at left,
    // so facing the speaker needs _R → leave her pose unchanged.
    const s = story([
      fig("高松灯", "tomori", "right", "mtn_idle01_C"),
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      line("千早爱音")
    ]);
    const summary = applyGazeDirection(s, manifest(), deps);
    expect(summary.skippedMissingVariant).toBe(1);
    const motions = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "高松灯").map((a) => a.motion);
    expect(motions).toEqual(["mtn_idle01_C"]);
  });

  it("respects an explicitly authored directional motion at the current beat", () => {
    const s = story([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("千早爱音", "anon", "left", "mtn_idle01_L"), // authored immediately before the line
      line("高松灯"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C")
    ]);
    const summary = applyGazeDirection(s, manifest(), deps);
    const motions = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "千早爱音").map((a) => a.motion);
    expect(motions).not.toContain("mtn_idle01_R");
    expect(summary.skippedExplicit).toBe(1);
  });

  it("does not touch old mygo (non-chara) figures", () => {
    const s = story([
      fig("高松灯", "oldmygo", "left", "tomori_idle01"),
      fig("千早爱音", "anon", "right", "mtn_idle01_C"),
      line("千早爱音")
    ]);
    applyGazeDirection(s, manifest(), deps);
    const oldFigs = s.scenes[0].actions.filter((a) => a.type === "figure" && a.assetId === "oldmygo");
    expect(oldFigs.map((a) => a.motion)).toEqual(["tomori_idle01"]);
  });

  it("tracks occupancy: removed figures are not retargeted, late entries are", () => {
    const s = story([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("高松灯", "tomori", "right", "mtn_idle01_C"),
      { type: "figure", character: "高松灯", assetId: "none", position: "right" },
      line("千早爱音"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("千早爱音")
    ]);
    applyGazeDirection(s, manifest(), deps);
    const tomoriFigs = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "高松灯" && a.assetId !== "none");
    // After her re-entry at center while 爱音 (left) speaks, 灯 must face
    // screen-left: no _R on her model → unchanged.
    expect(tomoriFigs.every((a) => a.motion !== "mtn_idle01_R")).toBe(true);
    // 爱音 (speaker) gets the audience C variant at both lines.
    const anonMotions = s.scenes[0].actions.filter((a) => a.type === "figure" && a.character === "千早爱音").map((a) => a.motion);
    expect(anonMotions).toContain("mtn_idle01_C");
  });

  it("inserted actions carry no duration (timeline unchanged)", () => {
    const s = story([
      fig("千早爱音", "anon", "left", "mtn_idle01_C"),
      fig("高松灯", "tomori", "center", "mtn_idle01_C"),
      line("高松灯", "一"),
      line("千早爱音", "二")
    ]);
    applyGazeDirection(s, manifest(), deps);
    const inserted = s.scenes[0].actions.filter((a) => a.type === "figure" && a.motionIndex === undefined && !("durationSec" in a));
    for (const a of s.scenes[0].actions.filter((a) => a.type === "figure")) {
      expect(a.durationSec).toBeUndefined();
    }
  });
});
