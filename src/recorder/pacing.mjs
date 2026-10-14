// Frame pacing loop ported from the deleted Electron recorder
// (legacy/v0.1-gui:src/electron-recorder.cjs) with its wall-clock semantics
// preserved: a pipelined capture — the next capture is issued immediately
// after the previous one resolves so encode time overlaps the wait — with
// sub-ms spin alignment and drift correction. When the schedule falls more
// than two frames behind (stalled capture), the missed slots are filled with
// duplicates of the last frame and the schedule is rebased onto the current
// wall clock. Content speed in the output always matches wall time; a slow
// capture path costs motion smoothness, never story timing.
//
// now/sleep/spin are injectable so tests can drive a fake clock.
export async function runPacedCapture({
  fps,
  durationSec,
  capture,
  write,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  spinForAlignment = true,
  shouldStop = () => false,
  onDuplicate = () => {}
}) {
  const frameIntervalMs = 1000 / fps;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const originAt = now();
  let startedAt = originAt;
  let pending = capture();
  let frames = 0;          // total slots written (unique + duplicates)
  let uniqueFrames = 0;    // slots that got a fresh capture
  let duplicatedFrames = 0;
  let driftCorrections = 0;
  let lastData;

  try {
    while (frames < totalFrames && !shouldStop()) {
      const slotTime = startedAt + frames * frameIntervalMs;

      if (frames > 0 && now() - slotTime > frameIntervalMs * 2) {
        // Stalled: fill the backlog slots with duplicates of the last frame
        // (wall-aligned), then rebase the schedule to the next fresh beat.
        driftCorrections += 1;
        const caughtUpFrames = Math.min(totalFrames, Math.floor((now() - startedAt) / frameIntervalMs));
        while (frames < caughtUpFrames && !shouldStop()) {
          await write(lastData, frames);
          frames += 1;
          duplicatedFrames += 1;
          onDuplicate(frames);
        }
        startedAt = now() + frameIntervalMs - frames * frameIntervalMs;
        continue;
      }

      const delay = slotTime - now();
      if (delay > 1) await sleep(delay - 0.5);
      if (spinForAlignment) {
        while (now() < slotTime) { /* sub-ms frame alignment */ }
      }
      const data = await pending;
      pending = capture();
      await write(data, frames);
      lastData = data;
      frames += 1;
      uniqueFrames += 1;
    }
  } finally {
    // Settle the pipelined capture so it cannot dangle or reject unhandled.
    try { await pending; } catch { /* capture already torn down */ }
  }

  return {
    frames,
    uniqueFrames,
    duplicatedFrames,
    driftCorrections,
    wallSec: Math.max(0.001, (now() - originAt) / 1000),
    stoppedEarly: frames < totalFrames
  };
}
