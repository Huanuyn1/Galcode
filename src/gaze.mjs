// Compile-time gaze/direction pass for chara-pack Live2D figures — v2.
//
// Suffix semantics (verified at the parameter level via ParamAngleX curves in
// the chara pack's motion3.json files, and visually on webgal-mygo): the
// suffix names the screen side the variant was DESIGNED for and the pose
// faces INWARD — _L ⇒ faces screen-right, _R ⇒ faces screen-left,
// _C ⇒ faces the audience. Turns are sustained (idle01_L holds
// ParamAngleX≈21°), so a figure already facing the speaker shows no motion
// event; attention needs a visible beat cue (turn or nod).
//
// Beat model: only `line` actions drive attention; a figure action's beat is
// the number of lines seen before it. Anything authored at the CURRENT beat
// is deliberate choreography and is never rewritten.
//
// Rules at each line (speaker S at position P):
//  - Speaker: idle-family current motion (idle01/nod01/nod02/look01/look02)
//    → same base with _C (face the audience). Expressive motions are kept.
//  - Bystander B with a chara-native directional motion:
//      · authored at this beat → preserve, no exceptions;
//      · current suffix ≠ D (direction to speaker) → retarget to same base
//        with suffix D — a visible head turn, emotion preserved;
//      · suffix already D but the speaker CHANGED vs the previous line →
//        replace with mtn_nod01_D (the "I'm listening" cue); fallbacks:
//        nod01_D → nod02_D → replay current base_D → leave unchanged;
//      · same speaker continuing and already facing → leave unchanged.
//  - Narration / no speaker → no change.
//  - Old mygo pack, cross-character (slash) motion names, and variants
//    missing from the model's native list are never touched.
//
// Implemented by inserting figure actions (same model/position, new motion)
// immediately before each line; inserted actions carry no duration, so the
// story timeline is unchanged.

const IDLE_FAMILY = new Set(["mtn_idle01", "mtn_nod01", "mtn_nod02", "mtn_look01", "mtn_look02"]);
const NOD_FALLBACK_BASES = ["mtn_nod01", "mtn_nod02"];
const DIRECTION_SUFFIXES = new Set(["L", "C", "R"]);

export function splitMotionDirection(motion) {
  // native bare name: mtn_<base><NN>_<L|C|R>
  const match = String(motion || "").match(/^(mtn_[a-z]+\d{2})_([LCR])$/i);
  if (!match) return null;
  const suffix = match[2].toUpperCase();
  if (!DIRECTION_SUFFIXES.has(suffix)) return null;
  return { base: match[1], suffix };
}

// Which suffix makes a figure at `pos` look toward `targetPos` on screen.
// _L ⇒ face screen-right, _R ⇒ face screen-left, _C ⇒ face audience.
export function directionSuffixToward(pos, targetPos) {
  if (!targetPos || targetPos === pos) return "C";
  const order = { left: -1, center: 0, right: 1 };
  const delta = (order[targetPos] ?? 0) - (order[pos] ?? 0);
  if (delta < 0) return "R"; // target screen-left → face screen-left
  if (delta > 0) return "L"; // target screen-right → face screen-right
  return "C";
}

// Mutates story in place; returns a summary for logging/tests.
export function applyGazeDirection(story, manifest, { canonicalCharacterKey, isCharaLive2DAsset }) {
  const assetMap = new Map((manifest?.assets || []).map((asset) => [asset.id, asset]));
  const summary = { turns: 0, nods: 0, speakerTurns: 0, preservedAuthoredBeat: 0, skippedMissingVariant: 0 };

  for (const scene of story.scenes || []) {
    const actions = Array.isArray(scene.actions) ? scene.actions : [];
    const next = [];
    // position -> { character, characterKey, asset, base, suffix, expression, authoredBeat }
    const stage = new Map();
    let beat = 0;
    let prevSpeakerKey = null;

    const variantExists = (entry, base, suffix) => (entry.asset.motions || []).includes(`${base}_${suffix}`);
    const insertMotion = (entry, pos, base, suffix, counterName) => {
      const variant = `${base}_${suffix}`;
      entry.base = base;
      entry.suffix = suffix;
      next.push({
        type: "figure",
        character: entry.character,
        assetId: entry.asset.id,
        position: pos,
        motion: variant,
        expression: entry.expression
      });
      summary[counterName] += 1;
    };

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
            base: parsed?.base || "",
            suffix: parsed?.suffix || "",
            expression: String(action.expression || ""),
            explicitDirection: Boolean(action.acting?.gaze),
            authoredBeat: beat
          });
        }
        next.push(action);
        continue;
      }

      if (action?.type === "line" && action.speaker) {
        const speakerKey = canonicalCharacterKey(action.speaker || "");
        let speakerEntry = null;
        let speakerPos = null;
        for (const [pos, entry] of stage) {
          if (entry.characterKey && entry.characterKey === speakerKey) {
            speakerEntry = entry;
            speakerPos = pos;
          }
        }
        const speakerChanged = prevSpeakerKey !== speakerKey;

        // Bystanders first, speaker last (all instant -next chains anyway).
        for (const [pos, entry] of stage) {
          if (entry === speakerEntry) continue;
          if (!entry.asset || !isCharaLive2DAsset(entry.asset) || !entry.suffix) continue;
          if (entry.authoredBeat === beat) {
            summary.preservedAuthoredBeat += 1;
            continue;
          }
          const targetSuffix = directionSuffixToward(pos, speakerPos);
          if (entry.suffix !== targetSuffix) {
            // visible turn toward the speaker (emotion base preserved)
            if (variantExists(entry, entry.base, targetSuffix)) {
              insertMotion(entry, pos, entry.base, targetSuffix, "turns");
            } else {
              summary.skippedMissingVariant += 1;
            }
          } else if (speakerChanged) {
            // already facing: the "I'm listening" nod cue, with fallbacks
            let done = false;
            for (const nodBase of NOD_FALLBACK_BASES) {
              if (variantExists(entry, nodBase, targetSuffix)) {
                insertMotion(entry, pos, nodBase, targetSuffix, "nods");
                done = true;
                break;
              }
            }
            if (!done && variantExists(entry, entry.base, targetSuffix)) {
              // replay the current base_D as the attention cue
              insertMotion(entry, pos, entry.base, targetSuffix, "nods");
            } else if (!done) {
              summary.skippedMissingVariant += 1;
            }
          }
        }

        if (speakerEntry && !speakerEntry.explicitDirection && speakerEntry.asset && isCharaLive2DAsset(speakerEntry.asset)
          && speakerEntry.suffix && IDLE_FAMILY.has(speakerEntry.base) && speakerEntry.suffix !== "C"
          && variantExists(speakerEntry, speakerEntry.base, "C")) {
          insertMotion(speakerEntry, speakerPos, speakerEntry.base, "C", "speakerTurns");
        } else if (speakerEntry && !speakerEntry.explicitDirection && speakerEntry.asset && isCharaLive2DAsset(speakerEntry.asset)
          && speakerEntry.suffix && IDLE_FAMILY.has(speakerEntry.base) && speakerEntry.suffix !== "C") {
          summary.skippedMissingVariant += 1;
        }

        prevSpeakerKey = speakerKey;
        beat += 1;
        next.push(action);
        continue;
      }

      next.push(action);
    }
    scene.actions = next;
  }
  summary.retargeted = summary.turns + summary.nods + summary.speakerTurns;
  return summary;
}
