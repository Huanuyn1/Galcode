import { describe, it, expect } from "vitest";
import { runPacedCapture } from "../src/recorder/pacing.mjs";

// Frame-pacing unit tests with a fake clock: sleep() advances time, capture()
// costs a controllable amount of fake milliseconds. No browser, no ffmpeg.

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    sleep: (ms) => { t += ms; return Promise.resolve(); }
  };
}

describe("runPacedCapture", () => {
  it("captures exactly round(duration*fps) frames on the fps schedule", async () => {
    const clock = fakeClock();
    const writes = [];
    const stats = await runPacedCapture({
      fps: 30,
      durationSec: 2,
      capture: async () => { clock.advance(8); return "frame"; },
      write: async (data, index) => { writes.push({ t: clock.now(), index }); },
      now: clock.now,
      sleep: clock.sleep,
      spinForAlignment: false
    });
    expect(stats.frames).toBe(60);
    expect(writes.map((w) => w.index)).toEqual([...Array(60).keys()]);
    expect(stats.driftCorrections).toBe(0);
    // 60 frames at 33.33ms with an 8ms capture cost: ~2000ms of virtual time.
    expect(stats.wallSec).toBeGreaterThan(1.9);
    expect(stats.wallSec).toBeLessThan(2.1);
    expect(stats.stoppedEarly).toBe(false);
  });

  it("paces writes ~1/fps apart instead of bursting", async () => {
    const clock = fakeClock();
    const times = [];
    await runPacedCapture({
      fps: 30,
      durationSec: 1,
      capture: async () => { clock.advance(5); return "f"; },
      write: async () => { times.push(clock.now()); },
      now: clock.now,
      sleep: clock.sleep,
      spinForAlignment: false
    });
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // The fake capture cost (5ms) lands inside the measured gap; allow it as
    // jitter. The invariant: gaps hover at 1/fps — never near-zero (burst)
    // and never multiples of the frame interval (stall without correction).
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(1000 / 30 - 5.6);
      expect(gap).toBeLessThanOrEqual(1000 / 30 + 5.6);
    }
  });

  it("drift-corrects after a stalled capture: duplicates fill missed slots, no burst", async () => {
    const clock = fakeClock();
    let captureCalls = 0;
    const dupedAt = [];
    const stats = await runPacedCapture({
      fps: 30,
      durationSec: 1,
      capture: async () => {
        captureCalls += 1;
        // Capture #5 stalls for five frames' worth of time.
        clock.advance(captureCalls === 5 ? 33.33 * 5 : 8);
        return "f";
      },
      write: async () => {},
      now: clock.now,
      sleep: clock.sleep,
      spinForAlignment: false,
      onDuplicate: (frame) => dupedAt.push(frame)
    });
    expect(stats.frames).toBe(30);
    expect(stats.driftCorrections).toBe(1);
    expect(stats.duplicatedFrames).toBeGreaterThanOrEqual(2);
    expect(stats.uniqueFrames).toBe(stats.frames - stats.duplicatedFrames);
    // Realtime mapping: wall time stays ≈ duration, the stall does not
    // compress or stretch story time.
    expect(stats.wallSec).toBeGreaterThan(0.95);
    expect(stats.wallSec).toBeLessThan(1.25);
  });

  it("stops early when shouldStop flips (timeout path)", async () => {
    const clock = fakeClock();
    let stop = false;
    const stats = await runPacedCapture({
      fps: 30,
      durationSec: 10,
      capture: async () => { clock.advance(8); return "f"; },
      write: async () => { if (clock.now() > 500) stop = true; },
      now: clock.now,
      sleep: clock.sleep,
      spinForAlignment: false,
      shouldStop: () => stop
    });
    expect(stats.frames).toBeLessThan(300);
    expect(stats.frames).toBeGreaterThan(10);
    expect(stats.stoppedEarly).toBe(true);
  });

  it("propagates capture failures", async () => {
    const clock = fakeClock();
    let n = 0;
    await expect(runPacedCapture({
      fps: 30,
      durationSec: 1,
      capture: async () => {
        n += 1;
        if (n === 3) throw new Error("browser died");
        return "f";
      },
      write: async () => {},
      now: clock.now,
      sleep: clock.sleep,
      spinForAlignment: false
    })).rejects.toThrow("browser died");
  });
});
