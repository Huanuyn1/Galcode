const DEFAULT_TEXT_SPEED = 30;
const CLOSING_SEC = 3;

export function textAnimationMs(text, textSpeed = DEFAULT_TEXT_SPEED) {
  const delayPerCharacter = 3 + (100 - textSpeed) * 1.5;
  return Math.round(delayPerCharacter * Array.from(String(text || "")).length);
}

export function estimateReadingMs(text) {
  const characters = Array.from(String(text || "").replace(/\s+/g, ""));
  const punctuationPauses = (String(text || "").match(/[。！？!?；;…]/g) || []).length * 350;
  return 1200 + characters.length * 145 + punctuationPauses;
}

export function timedActionMs(action) {
  if (action?.type === "wait") return Math.max(0, Math.round(Number(action.durationSec || 0) * 1000));
  if (action?.type !== "line" && action?.type !== "narration") return 0;
  const supplied = Number(action.durationSec);
  const requested = Number.isFinite(supplied) && supplied > 0
    ? Math.round(supplied * 1000)
    : estimateReadingMs(action.text);
  return Math.max(requested, textAnimationMs(action.text));
}

export function buildStoryTiming(story) {
  let clockMs = 0;
  const timeline = [];
  for (const scene of story.scenes || []) {
    for (const action of scene.actions || []) {
      const durationMs = timedActionMs(action);
      const entry = {
        ...action,
        startSec: clockMs / 1000,
        endSec: (clockMs + durationMs) / 1000
      };
      if ((action.type === "line" || action.type === "narration") && !(Number(action.durationSec) > 0)) {
        entry.durationSec = durationMs / 1000;
        entry.estimated = true;
      }
      timeline.push(entry);
      clockMs += durationMs;
    }
  }
  return {
    timeline,
    contentDurationSec: clockMs / 1000,
    totalDurationSec: clockMs / 1000 + CLOSING_SEC
  };
}

export function applyStoryTiming(story) {
  const timing = buildStoryTiming(story);
  story._timeline = timing.timeline;
  story._contentDurationSec = timing.contentDurationSec;
  story._totalDurationSec = timing.totalDurationSec;
  story._timingVersion = 2;
  return timing;
}
