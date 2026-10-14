import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { probeMediaSeconds, runFfmpeg } from "./ffmpeg.mjs";

// BGM post-mix, restored from legacy/v0.1-gui:src/galcode.js mixBGM (~:2763).
// The recorded video track is silent by construction (frames only), so the
// soundtrack is rebuilt from the compiled story timeline: story.bgm[] entries
// carry startSec/endSec/volume/fadeIn/fadeOut and the audio files were copied
// into game/bgm/ at compile time. The mix is padded/trimmed to the EXACT
// probed video duration, then muxed with `-c:v copy -c:a aac`.

export function buildBgmMixPlan(entries, videoSec) {
  const filterParts = [];
  const inputFiles = [];
  const labels = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const start = Math.min(Math.max(0, Number(entry.startSec || 0)), videoSec);
    const end = Math.min(Number(entry.endSec || videoSec), videoSec);
    const dur = end - start;
    if (dur <= 0) continue;
    const vol = Number(entry.volume ?? 0.3);
    const fadeIn = Number(entry.fadeIn ?? 1);
    const fadeOut = Number(entry.fadeOut ?? 2);
    const fadeOutStart = Math.max(0, dur - fadeOut);

    inputFiles.push(entry.src);
    const inputIndex = inputFiles.length; // 1-based; input 0 is the video
    const label = `bgm${i}`;
    labels.push(label);
    filterParts.push(
      `[${inputIndex}:a]atrim=${start}:${end},asetpts=PTS-STARTPTS,afade=t=in:d=${fadeIn},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOut},volume=${vol}[${label}]`
    );
  }

  if (!labels.length) return null;

  const mixInputs = labels.map((label) => `[${label}]`).join("");
  const exact = videoSec.toFixed(3);
  // amix → pad with silence if short → trim if long: audio length == videoSec.
  filterParts.push(`${mixInputs}amix=inputs=${labels.length}:duration=longest:normalize=0,apad=whole_dur=${exact},atrim=0:${exact}[aout]`);
  return { inputFiles, filterComplex: filterParts.join(";"), trackCount: labels.length };
}

export async function mixBgm(projectDir, videoOut, {
  ffmpeg = "ffmpeg",
  ffprobe = "ffprobe",
  noBgm = false,
  log = () => {},
  warn = () => {}
} = {}) {
  if (noBgm) return { mixed: false, reason: "disabled" };
  const storyPath = path.join(projectDir, "story.json");
  if (!fssync.existsSync(storyPath)) return { mixed: false, reason: "no-story" };
  let story;
  try {
    story = JSON.parse(await fs.readFile(storyPath, "utf8"));
  } catch {
    return { mixed: false, reason: "no-story" };
  }
  if (!Array.isArray(story.bgm) || story.bgm.length === 0) return { mixed: false, reason: "no-bgm" };

  // Prefer paths recorded at compile time; fall back to game/bgm/<basename>.
  const entries = [];
  for (const bgm of story.bgm) {
    const candidates = [
      bgm._copiedPath,
      bgm.assetPath,
      bgm.assetName ? path.join(projectDir, "game", "bgm", path.basename(String(bgm.assetName))) : ""
    ].filter(Boolean);
    const src = candidates.find((candidate) => fssync.existsSync(candidate));
    if (src) entries.push({ ...bgm, src });
  }
  if (!entries.length) return { mixed: false, reason: "no-bgm-files" };

  // Exact duration contract: probe the recorded video; the compiled timeline
  // total is the fallback when ffprobe is unavailable.
  const probed = await probeMediaSeconds(videoOut, ffprobe);
  const videoSec = probed || Number(story._totalDurationSec || story.durationSec || 60);
  const plan = buildBgmMixPlan(entries, videoSec);
  if (!plan) return { mixed: false, reason: "empty-plan" };

  const tmpOut = videoOut.replace(/\.mp4$/i, "") + ".bgm-tmp.mp4";
  const args = [
    "-y",
    "-i", videoOut,
    ...plan.inputFiles.flatMap((file) => ["-i", file]),
    "-filter_complex", plan.filterComplex,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    tmpOut
  ];

  log(`Mixing BGM: ${plan.trackCount} track(s), padded/trimmed to ${videoSec.toFixed(2)}s`);
  try {
    await runFfmpeg(args, { ffmpeg, timeoutMs: Math.max(120000, videoSec * 4000) });
    await fs.rename(tmpOut, videoOut);
    log("BGM mix complete");
    return { mixed: true, tracks: plan.trackCount, durationSec: videoSec };
  } catch (error) {
    await fs.rm(tmpOut, { force: true }).catch(() => {});
    warn(`BGM mix failed (video kept without audio): ${error.message}`);
    return { mixed: false, reason: "ffmpeg-failed", error: error.message };
  }
}
