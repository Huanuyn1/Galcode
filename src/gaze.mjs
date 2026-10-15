// Compile-time gaze/direction pass for chara-pack Live2D figures.
//
// The chara pack's native motions come in directional variants
// mtn_<base><NN>_<L|C|R>. Suffix semantics established empirically on
// webgal-mygo (probe: same model, same position, mtn_look01_L vs _R, face
// zooms /tmp/z-{anon,taki}-{L,R}.png): the suffix names the screen side the
// variant was DESIGNED for — the pose faces INWARD. Concretely, regardless
// of where the model actually stands: _L ⇒ faces screen-RIGHT, _R ⇒ faces
// screen-LEFT, _C ⇒ faces the audience. This matches how the shipped
// anon-taki video used them (爱音 at left + _L ⇒ facing center; 立希 at
// right + _R ⇒ facing center).
//
// Rule (unless the story explicitly choreographs otherwise):
//  - the speaker faces their addressee (default: the audience → _C);
//  - every other on-stage figure faces the speaker's position.
// Retargeting is CONSERVATIVE: only plain idle bases (mtn_idleNN_* native
// bare names) are ever rewritten; an expressive motion, a cross-character
// motion, or any motion the story just set at this beat is left untouched;
// when the needed variant is missing from the model's native list, the
// figure keeps its current motion. Non-chara packs are never touched.
//
// Implemented by inserting figure actions (same model/position, retargeted
// motion) immediately before each line; inserted actions carry no duration,
// so the story timeline is unchanged.

const IDLE_BASE_PATTERN = /^mtn_idle\d+$/;
const DIRECTION_SUFFIXES = new Set(["L", "C", "R"]);

export function splitMotionDirection(motion) {
  // native bare name: mtn_<base><NN>_<L|C|R>
  const match = String(motion || "").match(/^(mtn_[a-z]+\d{2})_([LCR])$/i);
  if (!match) return null;
  const suffix = match[2].toUpperCase();
  if (!DIRECTION_SUFFIXES.has(suffix)) return null;
  return { base: match[1], suffix };
}

function canonicalSpeakerKey(name, canonicalCharacterKey) {
  return canonicalCharacterKey(name || "");
}

// Mutates story in place; returns a summary for logging/tests.
export function applyGazeDirection(story, manifest, { canonicalCharacterKey, isCharaLive2DAsset }) {
  const assetMap = new Map((manifest?.assets || []).map((asset) => [asset.id, asset]));
  const summary = { retargeted: 0, skippedExpressive: 0, skippedMissingVariant: 0, skippedExplicit: 0 };

  for (const scene of story.scenes || []) {
    const actions = Array.isArray(scene.actions) ? scene.actions : [];
    const next = [];
    // position -> { character, characterKey, asset, motion, motionIndex, explicitDirectional }
    const stage = new Map();

    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      if (action?.type === "figure") {
        const pos = action.position || "center";
        if (!action.character || action.character === "none" || action.assetId === "none") {
          stage.delete(pos);
        } else {
          const asset = assetMap.get(action.assetId);
          const parsed = splitMotionDirection(action.motion);
          stage.set(pos, {
            character: action.character,
            characterKey: canonicalCharacterKey(action.character || ""),
            asset,
            motion: String(action.motion || ""),
            expression: String(action.expression || ""),
            motionIndex: i,
            explicitDirectional: Boolean(parsed)
          });
        }
        next.push(action);
        continue;
      }

      if (action?.type === "line" && action.speaker) {
        const speakerKey = canonicalSpeakerKey(action.speaker, canonicalCharacterKey);
        let speakerEntry = null;
        for (const entry of stage.values()) {
          if (entry.characterKey && entry.characterKey === speakerKey) speakerEntry = entry;
        }
        const inserted = [];
        for (const [pos, entry] of stage) {
          if (!entry.asset || !isCharaLive2DAsset(entry.asset)) continue;
          const parsed = splitMotionDirection(entry.motion);
          // Non-idle bases (expressive motions), non-directional motions, and
          // cross-character names are never rewritten.
          if (!parsed || !IDLE_BASE_PATTERN.test(parsed.base)) {
            if (parsed) summary.skippedExpressive += 1;
            continue;
          }
          const isSpeaker = entry === speakerEntry;
          // Explicit authoring at this beat wins: a figure action immediately
          // before this line for the same figure is never rewritten.
          if (entry.motionIndex === i - 1 && entry.explicitDirectional) {
            summary.skippedExplicit += 1;
            continue;
          }
          // Target direction: speaker faces audience (C); others face the speaker.
          const targetSuffix = isSpeaker ? "C" : directionToward(pos, speakerPosition(stage, speakerEntry));
          if (!targetSuffix || targetSuffix === parsed.suffix) continue;
          const variant = `${parsed.base}_${targetSuffix}`;
          if (!(entry.asset.motions || []).includes(variant)) {
            summary.skippedMissingVariant += 1;
            continue;
          }
          inserted.push({
            type: "figure",
            character: entry.character,
            assetId: entry.asset.id,
            position: pos,
            motion: variant,
            expression: entry.expression
          });
          entry.motion = variant;
          entry.motionIndex = i;
          entry.explicitDirectional = false;
          summary.retargeted += 1;
        }
        next.push(...inserted, action);
        continue;
      }

      next.push(action);
    }
    scene.actions = next;
  }
  return summary;
}

function speakerPosition(stage, speakerEntry) {
  if (!speakerEntry) return null;
  for (const [pos, entry] of stage) {
    if (entry === speakerEntry) return pos;
  }
  return null;
}

// Which suffix makes a figure at `pos` look toward `targetPos` on screen.
// Suffix names the design side and faces INWARD (probe-established):
// _L ⇒ face screen-right, _R ⇒ face screen-left, _C ⇒ face audience.
function directionToward(pos, targetPos) {
  if (!targetPos || targetPos === pos) return "C";
  const order = { left: -1, center: 0, right: 1 };
  const delta = (order[targetPos] ?? 0) - (order[pos] ?? 0);
  if (delta < 0) return "R"; // target screen-left → face screen-left
  if (delta > 0) return "L"; // target screen-right → face screen-right
  return "C";
}
