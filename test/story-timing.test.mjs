import { describe, it, expect } from "vitest";
import { applyStoryTiming, buildStoryTiming, estimateReadingMs, textAnimationMs, timedActionMs } from "../src/story-timing.mjs";

// Timing is computed from the actual script and WebGAL's default text speed;
// the LLM's top-level target never participates in these calculations.

describe("story timing", () => {
  it("never advances before the text animation can finish", () => {
    const text = "这是一句故意写得比较长、需要完整显示后才能继续的台词。";
    expect(timedActionMs({ type: "line", text, durationSec: 0.1 })).toBe(textAnimationMs(text));
    expect(timedActionMs({ type: "line", text, durationSec: 30 })).toBe(30000);
  });

  it("estimates missing line durations deterministically from text", () => {
    const action = { type: "narration", text: "雨停了。她们还没有离开。" };
    expect(timedActionMs(action)).toBe(Math.max(estimateReadingMs(action.text), textAnimationMs(action.text)));
    expect(timedActionMs(action)).toBe(timedActionMs({ ...action }));
  });

  it("builds one cumulative timeline with a three-second closing beat", () => {
    const story = {
      durationSec: 999,
      scenes: [
        { actions: [
          { type: "figure", character: "爱音" },
          { type: "line", speaker: "爱音", text: "短句", durationSec: 2 },
          { type: "wait", durationSec: 1.5 }
        ] },
        { actions: [{ type: "narration", text: "下一场", durationSec: 2 }] }
      ]
    };
    const timing = buildStoryTiming(story);
    expect(timing.timeline.map((entry) => [entry.startSec, entry.endSec])).toEqual([[0, 0], [0, 2], [2, 3.5], [3.5, 5.5]]);
    expect(timing.contentDurationSec).toBe(5.5);
    expect(timing.totalDurationSec).toBe(8.5);
  });

  it("marks estimated lines and exposes the timing contract to the recorder", () => {
    const story = { scenes: [{ actions: [{ type: "line", speaker: "灯", text: "……听得到吗。" }] }] };
    applyStoryTiming(story);
    expect(story._timingVersion).toBe(2);
    expect(story._timeline[0].estimated).toBe(true);
    expect(story._timeline[0].durationSec).toBeGreaterThan(0);
    expect(story._totalDurationSec).toBe(story._contentDurationSec + 3);
  });
});
