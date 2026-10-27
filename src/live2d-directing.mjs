import fs from "node:fs/promises";
import path from "node:path";

const FAMILY_ALIASES = {
  idle: "idle", calm: "idle", neutral: "idle", 日常: "idle", 平静: "idle",
  smile: "smile", happy: "smile", joy: "smile", 开心: "smile", 微笑: "smile",
  kime: "kime", proud: "kime", confident: "kime", 得意: "kime",
  shy: "shy", embarrassed: "shy", 害羞: "shy", 羞涩: "shy",
  sad: "sad", 悲伤: "sad", 难过: "sad",
  cry: "cry", 哭泣: "cry",
  angry: "angry", anger: "angry", 生气: "angry", 愤怒: "angry",
  surprised: "surprised", surprise: "surprised", shock: "surprised", 惊讶: "surprised", 震惊: "surprised",
  serious: "serious", 认真: "serious", 严肃: "serious",
  thinking: "thinking", think: "thinking", confused: "thinking", 思考: "thinking", 迷茫: "thinking",
  question: "question", 疑问: "question",
  denial: "denial", deny: "denial", 否认: "denial", 摆手: "denial",
  nod: "nod", agree: "nod", 点头: "nod", 同意: "nod",
  check: "check", 确认: "check", 查看: "check",
  look: "look", 看向: "look", 回头: "look",
  bye: "bye", farewell: "bye", 道别: "bye",
  play: "play", perform: "play", 演奏: "play",
  action: "action", pose: "action", 亮相: "action",
  finish: "finish", 收尾: "finish", 落幕: "finish",
  join: "join", 合掌: "join",
  shadow: "shadow", 阴沉: "shadow",
  pale: "pale", 慌乱: "pale",
  bsmile: "bsmile"
};

function canonicalFamily(value) {
  const key = String(value || "").trim().toLowerCase();
  return FAMILY_ALIASES[key] || key;
}

function nameParts(name, kind) {
  const bare = String(name || "").split("/").pop();
  const match = bare.match(new RegExp(`^${kind === "motion" ? "mtn" : "exp"}_([a-z_]+?)(\\d+)?(?:_([LCR]))?$`, "i"));
  if (!match) return { family: canonicalFamily(bare), variant: 1, direction: "" };
  return {
    family: canonicalFamily(match[1].replace(/_+$/, "")),
    variant: Number(match[2] || 1),
    direction: String(match[3] || "").toUpperCase()
  };
}

function regionsFor(parameters) {
  const regions = new Set();
  for (const id of parameters) {
    if (/Angle|Head|Neck/i.test(id)) regions.add("head");
    if (/Eye|Brow|Mouth|Tear|eyelid|Cheek|Blush|Face|Lip/i.test(id)) regions.add("face");
    if (/Body|Breath|Arm|Hand|Sleeve|Leg|Skirt|Mune|Hara|胴体|胸|袖/i.test(id)) regions.add("body");
    if (/Hair/i.test(id)) regions.add("hair");
  }
  return [...regions].sort();
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function sharedReference(name, file) {
  return String(name || "").includes("/") || String(file || "").replaceAll("\\", "/").startsWith("..");
}

export async function inspectCharaDirecting(modelPath, modelJson) {
  const modelDir = path.dirname(modelPath);
  const references = modelJson?.FileReferences || {};
  const displayInfo = references.DisplayInfo
    ? await readJson(path.resolve(modelDir, references.DisplayInfo))
    : null;
  const modelParameters = new Set((displayInfo?.Parameters || []).map((entry) => entry.Id).filter(Boolean));

  async function entry(name, file, kind) {
    const json = await readJson(path.resolve(modelDir, file));
    const parameters = kind === "motion"
      ? (json?.Curves || []).filter((curve) => curve.Target === "Parameter").map((curve) => curve.Id).filter(Boolean)
      : (json?.Parameters || []).map((parameter) => parameter.Id).filter(Boolean);
    const uniqueParameters = [...new Set(parameters)];
    const supported = modelParameters.size
      ? uniqueParameters.filter((id) => modelParameters.has(id)).length
      : uniqueParameters.length;
    return {
      name,
      ...nameParts(name, kind),
      durationSec: Number(json?.Meta?.Duration || 0) || undefined,
      loop: kind === "motion" ? Boolean(json?.Meta?.Loop) : undefined,
      fadeInSec: Number(json?.Meta?.FadeInTime ?? json?.FadeInTime) || undefined,
      fadeOutSec: Number(json?.Meta?.FadeOutTime ?? json?.FadeOutTime) || undefined,
      parameterCount: uniqueParameters.length,
      coverage: uniqueParameters.length ? supported / uniqueParameters.length : 1,
      regions: regionsFor(uniqueParameters)
    };
  }

  const motions = [];
  const expressions = [];
  const sharedMotions = [];
  const sharedExpressions = [];
  for (const [name, entries] of Object.entries(references.Motions || {})) {
    const file = Array.isArray(entries) ? entries[0]?.File : "";
    if (!file) continue;
    const target = sharedReference(name, file) ? sharedMotions : motions;
    target.push(await entry(name, file, "motion"));
  }
  for (const item of Array.isArray(references.Expressions) ? references.Expressions : []) {
    const name = item.Name || item.name;
    const file = item.File || item.file;
    if (!name || !file) continue;
    const target = sharedReference(name, file) ? sharedExpressions : expressions;
    target.push(await entry(name, file, "expression"));
  }
  return { motions, expressions, sharedMotions, sharedExpressions };
}

export function summarizeDirecting(asset) {
  const summarize = (entries, directional = false) => {
    const families = new Map();
    for (const entry of entries || []) {
      const current = families.get(entry.family) || { id: entry.family, variants: new Set(), directions: new Set(), regions: new Set() };
      current.variants.add(entry.variant);
      if (entry.direction) current.directions.add(entry.direction);
      for (const region of entry.regions || []) current.regions.add(region);
      families.set(entry.family, current);
    }
    return [...families.values()].map((entry) => ({
      id: entry.id,
      variants: [...entry.variants].sort((a, b) => a - b),
      ...(directional ? { directions: [...entry.directions].sort() } : {}),
      regions: [...entry.regions].sort()
    }));
  };
  return {
    motionFamilies: summarize(asset.directing?.motions, true),
    expressionFamilies: summarize(asset.directing?.expressions),
    sharedMotionFamilies: [...new Set((asset.directing?.sharedMotions || []).map((entry) => entry.family))].sort(),
    sharedExpressionFamilies: [...new Set((asset.directing?.sharedExpressions || []).map((entry) => entry.family))].sort()
  };
}

function intensityValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  if (value === "high" || value === "strong") return 1;
  if (value === "medium") return 0.5;
  return 0;
}

function directionValue(value) {
  const key = String(value || "audience").toLowerCase();
  if (["c", "center", "audience", "camera", "观众", "镜头"].includes(key)) return "C";
  if (["l", "right", "screen-right", "右", "右侧"].includes(key)) return "L";
  if (["r", "left", "screen-left", "左", "左侧"].includes(key)) return "R";
  return "C";
}

function exactEntry(entries, name) {
  return (entries || []).find((entry) => entry.name === name);
}

function validateExact(entry, name, field, asset) {
  if (!entry) {
    const error = new Error(`${field} '${name}' is not registered on Live2D asset ${asset.id}.`);
    error.code = "LIVE2D_ACTION_NOT_FOUND";
    throw error;
  }
  if (entry.coverage < 0.5) {
    const error = new Error(`${field} '${name}' covers only ${Math.round(entry.coverage * 100)}% of driven parameters on ${asset.id}; choose a native or more compatible action.`);
    error.code = "LIVE2D_ACTION_INCOMPATIBLE";
    throw error;
  }
  return entry;
}

function chooseEntry(entries, family, { directional, gaze, intensity, shared }) {
  const direction = directionValue(gaze);
  const wanted = intensityValue(intensity);
  const candidates = (entries || []).filter((entry) => {
    if (entry.family !== family || entry.coverage < 0.75) return false;
    if (directional && entry.direction && entry.direction !== direction) return false;
    return shared || !entry.name.includes("/");
  });
  const variants = candidates.map((entry) => entry.variant);
  const minVariant = Math.min(...variants);
  const maxVariant = Math.max(...variants);
  const targetVariant = minVariant + wanted * (maxVariant - minVariant);
  return candidates.sort((a, b) => {
    const nativeScore = Number(a.name.includes("/")) - Number(b.name.includes("/"));
    if (nativeScore) return nativeScore;
    const directionScore = Number(Boolean(b.direction)) - Number(Boolean(a.direction));
    if (directionScore) return directionScore;
    const intensityScore = Math.abs(a.variant - targetVariant) - Math.abs(b.variant - targetVariant);
    if (intensityScore) return intensityScore;
    return b.coverage - a.coverage || a.name.localeCompare(b.name);
  })[0] || null;
}

export function resolveLive2DFigure(action, asset) {
  if (asset?.pack !== "chara") return { motion: action.motion || "", expression: action.expression || "" };
  const acting = action.acting && typeof action.acting === "object" ? action.acting : null;
  const directing = asset.directing;
  if (!directing) return { motion: action.motion || "", expression: action.expression || "" };
  const allMotions = [...(directing.motions || []), ...(directing.sharedMotions || [])];
  const allExpressions = [...(directing.expressions || []), ...(directing.sharedExpressions || [])];
  const shared = Boolean(acting?.allowShared);
  const motionFamily = canonicalFamily(acting?.gesture || acting?.motion || acting?.emotion || "idle");
  const expressionFamily = canonicalFamily(acting?.expression || acting?.emotion || "idle");

  let motion;
  if (action.motion) {
    const native = exactEntry(directing.motions, action.motion);
    const donor = exactEntry(directing.sharedMotions, action.motion);
    motion = validateExact(native || donor, action.motion, "motion", asset).name;
  } else if (acting) {
    const entry = chooseEntry(allMotions, motionFamily, { directional: true, gaze: acting.gaze, intensity: acting.intensity, shared });
    if (!entry) {
      const available = [...new Set((directing.motions || []).map((item) => item.family))].sort();
      const error = new Error(`acting motion '${motionFamily}' is unavailable on ${asset.id}; native families: ${available.join(", ")}`);
      error.code = "LIVE2D_ACTING_NOT_FOUND";
      throw error;
    }
    motion = entry.name;
  }

  let expression;
  if (action.expression) {
    const native = exactEntry(directing.expressions, action.expression);
    const donor = exactEntry(directing.sharedExpressions, action.expression);
    expression = validateExact(native || donor, action.expression, "expression", asset).name;
  } else if (acting) {
    const entry = chooseEntry(allExpressions, expressionFamily, { directional: false, intensity: acting.intensity, shared });
    if (!entry) {
      const available = [...new Set((directing.expressions || []).map((item) => item.family))].sort();
      const error = new Error(`acting expression '${expressionFamily}' is unavailable on ${asset.id}; native families: ${available.join(", ")}`);
      error.code = "LIVE2D_ACTING_NOT_FOUND";
      throw error;
    }
    expression = entry.name;
  }
  return { motion: motion || "", expression: expression || "" };
}
