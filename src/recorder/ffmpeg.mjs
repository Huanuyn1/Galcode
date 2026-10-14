import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { killChildTree } from "../proc.mjs";

// ffmpeg lifecycle for recording: MJPEG frame pipe → libx264, with the old
// recorder's rules — tree-kill on timeout, and tolerate a non-zero exit when
// the output file exists (partial success beats no video).

export function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore", windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function assertFfmpegAvailable(ffmpeg = "ffmpeg") {
  if (await commandExists(ffmpeg)) return;
  throw new Error([
    `ffmpeg is required for \`galcode record\` but "${ffmpeg}" was not found on PATH.`,
    "Install it with your package manager (apt/dnf install ffmpeg, brew install ffmpeg,",
    "choco install ffmpeg) or from https://ffmpeg.org/download.html, then retry.",
    "Pass --ffmpeg <path> to use a non-default binary."
  ].join(" "));
}

export function startMjpegEncoder({ ffmpeg = "ffmpeg", out, fps, crf = 18, preset = "veryfast", log = () => {} }) {
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps),
    "-i", "pipe:0",
    "-an",
    "-r", String(fps),
    // mjpeg decodes to full-range yuvj420p; normalize to strict limited-range
    // yuv420p so players/probers see exactly yuv420p.
    "-vf", "scale=out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
    out
  ];
  log(`$ ${ffmpeg} ${args.join(" ")}`);
  const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  child.on("error", () => {});
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 16000) stderr = stderr.slice(-16000);
  });
  const done = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, stderr: stderr.trim() }));
  });
  return { child, stdin: child.stdin, done, args };
}

export async function writeFrame(encoder, buffer) {
  const stream = encoder.stdin;
  if (stream.destroyed || stream.closed) throw new Error("ffmpeg stdin is closed — encoder died mid-recording");
  if (!stream.write(buffer)) {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        stream.off("drain", onDrain);
        stream.off("error", onError);
      };
      const onDrain = () => { cleanup(); resolve(); };
      const onError = (error) => { cleanup(); reject(error); };
      stream.once("drain", onDrain);
      stream.once("error", onError);
    });
  }
}

// End the frame pipe and wait for ffmpeg to finalize the mp4 (moov atom).
// Hanging past the grace window escalates to a tree-kill; a non-zero exit is
// tolerated when the output file exists and is non-empty.
export async function finishEncoder(encoder, { out, graceMs = 15000 } = {}) {
  try { encoder.stdin.end(); } catch { /* already closed */ }
  const result = await Promise.race([
    encoder.done,
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, graceMs));
      killChildTree(encoder.child);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (encoder.child.exitCode === null) killChildTree(encoder.child, "SIGKILL");
      return encoder.done;
    })()
  ]);
  return await toleratePartialSuccess(result, out);
}

export function abortEncoder(encoder) {
  try { encoder.stdin.destroy(); } catch { /* ignore */ }
  killChildTree(encoder.child, "SIGKILL");
}

async function toleratePartialSuccess(result, out) {
  const stat = fssync.statSync(out, { throwIfNoEntry: false });
  if (stat && stat.size > 0) {
    return { ok: true, partial: result.code !== 0, exitCode: result.code, bytes: stat.size, stderr: result.stderr };
  }
  const status = result.code === null || result.code === undefined ? String(result.signal || "unknown") : String(result.code);
  throw new Error(`ffmpeg exited with ${status} and wrote no output (${out}). ${result.stderr || ""}`.trim());
}

export async function runFfmpeg(args, { ffmpeg = "ffmpeg", timeoutMs = 120000 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.on("error", reject);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 16000) stderr = stderr.slice(-16000);
    });
    const timer = setTimeout(() => {
      killChildTree(child);
      reject(new Error(`ffmpeg timed out after ${timeoutMs} ms: ${args.join(" ")}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export async function probeMediaSeconds(file, ffprobe = "ffprobe") {
  try {
    const text = await new Promise((resolve, reject) => {
      const child = spawn(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      });
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { out += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`ffprobe exited with ${code}`))));
    });
    const seconds = Number.parseFloat(text.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    return 0;
  }
}

export async function statFileSize(file) {
  const stat = await fs.stat(path.resolve(file)).catch(() => null);
  return stat?.size || 0;
}
