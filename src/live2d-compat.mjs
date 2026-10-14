import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

// Live2D runtime compatibility checks.
//
// Background: the chara pack (figure/chara/) ships Cubism 5 models — .moc3
// files with format version 5 (magic "MOC3" + uint32 LE at offset 4). The
// bundled-by-user live2dcubismcore.min.js must be the Cubism 5 core to load
// them; the old 4.2 core throws _CubismMoc.create "Unknown error" and the
// stage shows backgrounds/dialogue with NO models.
//
// Two layers of detection:
//  - Static (compile time / doctor): moc3 version-byte reads are exact; the
//    core file has NO static version marker and evaluating its emscripten
//    factory in Node blocks the event loop (verified), so the core side is a
//    documented size heuristic (official SDK for Web: 4.2.0002 ≈ 150 KB,
//    5-r.4 ≈ 207 KB).
//  - Authoritative (record time): once the page is up we read
//    Live2DCubismCore.Version.csmGetLatestMocVersion() in the browser.

const CORE_FILE_NAME = "live2dcubismcore.min.js";
// Official Cubism SDK for Web core sizes: 4.2.0002 = 150388 B, 5-r.4 = 207155 B.
const CUBISM5_CORE_MIN_BYTES = 200_000;
const CUBISM4_CORE_MIN_BYTES = 100_000;

export async function readMoc3Version(filePath) {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(8);
      const { bytesRead } = await handle.read(buffer, 0, 8, 0);
      if (bytesRead < 8 || buffer.toString("latin1", 0, 4) !== "MOC3") return null;
      return buffer.readUInt32LE(4);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

// Scan a compiled game/ tree (or any directory) for .moc3 models.
export async function scanMoc3Versions(rootDir) {
  const byVersion = {};
  let files = 0;
  let maxVersion = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".moc3")) {
        const version = await readMoc3Version(full);
        if (version === null) continue;
        files += 1;
        byVersion[version] = (byVersion[version] || 0) + 1;
        if (version > maxVersion) maxVersion = version;
      }
    }
  }
  await walk(rootDir);
  return { files, maxVersion, byVersion };
}

// Static, documented heuristic — see module header. Never throws.
export function probeCubismCoreGeneration(libDirOrFile) {
  const file = libDirOrFile.endsWith(".js") ? libDirOrFile : path.join(libDirOrFile, CORE_FILE_NAME);
  const stat = fssync.statSync(file, { throwIfNoEntry: false });
  if (!stat) {
    return { file, present: false, bytes: 0, generation: null, heuristic: true, note: "live2dcubismcore.min.js not installed" };
  }
  const generation = stat.size >= CUBISM5_CORE_MIN_BYTES ? 5 : stat.size >= CUBISM4_CORE_MIN_BYTES ? 4 : null;
  const note = generation === 5
    ? `Cubism 5 core (heuristic: ${stat.size} B; supports moc3 v3–v5)`
    : generation === 4
      ? `Cubism 4.x core (heuristic: ${stat.size} B; moc3 v5 models will NOT render)`
      : `unrecognized core size (${stat.size} B)`;
  return { file, present: true, bytes: stat.size, generation, heuristic: true, note };
}

// Compile-time/CLI-level check: which moc3 versions does this game tree use,
// and does the installed core plausibly support them? Returns a loud warning
// string when incompatible, null when fine (or nothing to check).
export async function checkLive2DCompat(gameDir, webgalLibDir) {
  const moc = await scanMoc3Versions(gameDir);
  if (!moc.files || moc.maxVersion < 5) return { moc, core: null, warning: null };
  const core = probeCubismCoreGeneration(webgalLibDir);
  if (!core.present) {
    return {
      moc,
      core,
      warning: `This project uses Cubism 5 Live2D models (moc3 v5, ${moc.files} file(s)) but ${CORE_FILE_NAME} is not installed in the WebGAL engine — models will not render. Install the core from the Live2D Cubism 5 SDK for Web (see the live2d-licensing skill / galcode doctor).`
    };
  }
  if (core.generation !== null && core.generation < 5) {
    return {
      moc,
      core,
      warning: `This project uses Cubism 5 Live2D models (moc3 v5, ${moc.files} file(s)) but the installed ${CORE_FILE_NAME} looks like a Cubism 4.x core (heuristic: ${core.bytes} B). moc3 v5 will fail with _CubismMoc.create errors and NO models will render. Replace it with the core from the Live2D Cubism 5 SDK for Web.`
    };
  }
  return { moc, core, warning: null };
}

// The warning text shown when the authoritative in-page probe disagrees with
// the models the project uses.
export function live2dCoreMismatchWarning(requiredMocVersion, detectedLatest) {
  const detected = detectedLatest === null || detectedLatest === undefined
    ? "Live2DCubismCore not loaded at all"
    : `csmGetLatestMocVersion=${detectedLatest}`;
  return [
    `LIVE2D RUNTIME MISMATCH: this project uses moc3 v${requiredMocVersion} models but the page reports ${detected}.`,
    "Models will silently fail to render (backgrounds and dialogue still record).",
    `Replace vendor/webgal-mygo/packages/webgal/public/lib/${CORE_FILE_NAME} with the core from the Live2D Cubism 5 SDK for Web, then re-record.`
  ].join(" ");
}
