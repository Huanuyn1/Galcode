import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildBgmMixPlan, mixBgm } from "../src/recorder/mix-bgm.mjs";
import { commandExists, probeMediaSeconds, runFfmpeg } from "../src/recorder/ffmpeg.mjs";

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-mixbgm-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("buildBgmMixPlan", () => {
  it("builds atrim/afade/volume/amix chains and pads+trims to the exact video duration", () => {
    const plan = buildBgmMixPlan([
      { src: "/a.mp3", startSec: 0, endSec: 60, volume: 0.25, fadeIn: 2, fadeOut: 3 },
      { src: "/b.mp3", startSec: 60, endSec: 120, volume: 0.4, fadeIn: 1, fadeOut: 2 }
    ], 120);
    expect(plan.inputFiles).toEqual(["/a.mp3", "/b.mp3"]);
    const fc = plan.filterComplex;
    expect(fc).toContain("[1:a]atrim=0:60");
    expect(fc).toContain("[2:a]atrim=60:120");
    expect(fc).toContain("afade=t=in:d=2");
    expect(fc).toContain("afade=t=out:st=57.00:d=3");
    expect(fc).toContain("volume=0.25");
    expect(fc).toContain("amix=inputs=2:duration=longest:normalize=0");
    // Exact-duration contract: silence-pad up to the video length, trim down to it.
    expect(fc).toContain("apad=whole_dur=120.000");
    expect(fc).toContain("atrim=0:120.000[aout]");
  });

  it("clamps entries to the video duration and drops zero-length segments", () => {
    const plan = buildBgmMixPlan([
      { src: "/a.mp3", startSec: 100, endSec: 400, volume: 0.3 },
      { src: "/b.mp3", startSec: 150, endSec: 100 }, // inverted → dropped
      { src: "/c.mp3", startSec: 300 }              // starts at/after end → dropped
    ], 120);
    expect(plan.inputFiles).toEqual(["/a.mp3"]);
    expect(plan.filterComplex).toContain("atrim=100:120");
    expect(plan.filterComplex).toContain("amix=inputs=1");
    expect(buildBgmMixPlan([{ src: "/x.mp3", startSec: 5, endSec: 5 }], 120)).toBeNull();
  });
});

describe("mixBgm", () => {
  it("skips cleanly when the project has no bgm entries", async () => {
    await fs.writeFile(path.join(tmp, "story.json"), JSON.stringify({ title: "t", bgm: [] }));
    const result = await mixBgm(tmp, path.join(tmp, "final.mp4"), {});
    expect(result.mixed).toBe(false);
    expect(result.reason).toBe("no-bgm");
  });

  it("skips when bgm entries reference missing files", async () => {
    await fs.writeFile(path.join(tmp, "story.json"), JSON.stringify({
      bgm: [{ assetName: "nope.mp3", assetPath: path.join(tmp, "nope.mp3"), startSec: 0, endSec: 10 }]
    }));
    const result = await mixBgm(tmp, path.join(tmp, "final.mp4"), {});
    expect(result).toMatchObject({ mixed: false, reason: "no-bgm-files" });
  });
});

// Real ffmpeg mux: only when ffmpeg+ffprobe are on PATH (they are a record-time
// requirement); otherwise this block skips so hermetic CI stays green.
describe("mixBgm with real ffmpeg", () => {
  it("produces an aac stream whose duration matches the video exactly", async (t) => {
    if (!(await commandExists("ffmpeg")) || !(await commandExists("ffprobe"))) {
      return t.skip("ffmpeg/ffprobe not on PATH");
    }
    // 3s silent video + a 10s 440Hz tone as "BGM".
    const video = path.join(tmp, "video.mp4");
    const tone = path.join(tmp, "tone.wav");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=10:d=3", "-pix_fmt", "yuv420p", "-c:v", "libx264", video]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", tone]);

    await fs.mkdir(path.join(tmp, "game", "bgm"), { recursive: true });
    await fs.copyFile(tone, path.join(tmp, "game", "bgm", "tone.wav"));
    await fs.writeFile(path.join(tmp, "story.json"), JSON.stringify({
      title: "t",
      _totalDurationSec: 99, // deliberately wrong: the probe must win
      bgm: [{ assetName: "tone.wav", startSec: 0, endSec: 10, volume: 0.5, fadeIn: 0.5, fadeOut: 0.5 }]
    }));

    const result = await mixBgm(tmp, video, {});
    expect(result.mixed).toBe(true);
    const duration = await probeMediaSeconds(video);
    expect(Math.abs(duration - 3)).toBeLessThan(0.35); // aac frame granularity
  }, 60000);
});
