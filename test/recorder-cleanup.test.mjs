import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finishEncoder } from "../src/recorder/ffmpeg.mjs";
import { closeBrowserTree } from "../src/recorder/browser.mjs";

afterEach(() => {
  vi.useRealTimers();
});

describe("recorder timer cleanup", () => {
  it("cancels the ffmpeg watchdog after a successful finalize", async () => {
    vi.useFakeTimers();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-encoder-cleanup-"));
    const out = path.join(dir, "out.mp4");
    await fs.writeFile(out, "video");
    const encoder = {
      stdin: { end: vi.fn() },
      done: Promise.resolve({ code: 0, signal: null, stderr: "" }),
      child: { exitCode: 0 }
    };
    try {
      const result = await finishEncoder(encoder, { out });
      expect(result.ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels the browser close grace timer after a clean close", async () => {
    vi.useFakeTimers();
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      process: () => null
    };
    await closeBrowserTree(browser);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
