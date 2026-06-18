#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const packageJson = JSON.parse(await fs.readFile(path.join(ROOT_DIR, "package.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const target = args.target || "universal";
const targets = target === "all" ? ["universal", "windows", "macos", "linux"] : [target];
const currentTarget = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";

if (targets.includes("current")) {
  targets.splice(targets.indexOf("current"), 1, currentTarget);
}

await fs.mkdir(DIST_DIR, { recursive: true });

for (const item of targets) {
  await createPackage(item);
}

async function createPackage(platformTarget) {
  const name = `galcode-${packageJson.version}-${platformTarget}`;
  const stageDir = path.join(DIST_DIR, name);
  const archive = platformTarget === "windows" || platformTarget === "universal"
    ? path.join(DIST_DIR, `${name}.zip`)
    : path.join(DIST_DIR, `${name}.tar.gz`);

  console.log(`Packaging ${name}...`);
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.rm(archive, { force: true });
  await fs.mkdir(stageDir, { recursive: true });

  for (const entry of await getRootEntries()) {
    await copyEntry(entry, path.join(stageDir, path.basename(entry)));
  }

  await copyNativeLaunchers(platformTarget, stageDir);
  await writeStartHere(platformTarget, stageDir);
  await archivePackage(platformTarget, stageDir, archive);
  const stat = await fs.stat(archive);
  console.log(`Created ${path.relative(ROOT_DIR, archive)} (${formatBytes(stat.size)})`);
}

async function getRootEntries() {
  const include = new Set([
    ".env.example",
    ".gitignore",
    "LICENSE",
    "README.md",
    "ROADMAP.md",
    "bin",
    "docs",
    "figure",
    "galcode",
    "galcode.bat",
    "install.bat",
    "install.sh",
    "package-lock.json",
    "package.json",
    "scripts",
    "src",
    "start.bat",
    "start.sh",
    "themes",
    "vendor"
  ]);
  const entries = await fs.readdir(ROOT_DIR);
  return entries
    .filter((entry) => include.has(entry))
    .map((entry) => path.join(ROOT_DIR, entry));
}

async function copyEntry(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    preserveTimestamps: true,
    filter: (source) => shouldCopy(source)
  });
}

async function copyNativeLaunchers(platformTarget, stageDir) {
  const nativeDir = path.join(DIST_DIR, "native");
  if (!fssync.existsSync(nativeDir)) return;

  const candidates = {
    universal: [
      ["Galcode.exe", "Galcode-windows.exe"],
      ["Galcode-macos-arm64", "Galcode-macos-arm64"],
      ["Galcode-macos-x64", "Galcode-macos-x64"],
      ["Galcode-linux-x64", "Galcode-linux-x64"]
    ],
    windows: [["Galcode.exe", "Galcode.exe"]],
    macos: [
      ["Galcode-macos-arm64", "Galcode-macos-arm64"],
      ["Galcode-macos-x64", "Galcode-macos-x64"]
    ],
    linux: [["Galcode-linux-x64", "Galcode"]]
  }[platformTarget] || [];

  for (const [sourceName, targetName] of candidates) {
    const source = path.join(nativeDir, sourceName);
    if (!fssync.existsSync(source)) continue;
    await fs.copyFile(source, path.join(stageDir, targetName));
    if (!targetName.endsWith(".exe")) await fs.chmod(path.join(stageDir, targetName), 0o755);
  }
}

function shouldCopy(source) {
  const rel = path.relative(ROOT_DIR, source);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  const blocked = new Set([
    ".DS_Store",
    ".git",
    ".galcode",
    "dist",
    "node_modules",
    "outputs",
    "work"
  ]);
  return !parts.some((part) => blocked.has(part));
}

async function writeStartHere(platformTarget, stageDir) {
  const isWin = platformTarget === "windows";
  const isUnix = platformTarget === "macos" || platformTarget === "linux" || platformTarget === "universal";
  if (platformTarget === "universal") {
    await fs.writeFile(path.join(stageDir, "START_HERE.txt"), [
      "Galcode quick start",
      "",
      "1. Install prerequisites:",
      "   Binary launchers can download portable Node.js automatically.",
      "   Recording final.mp4 still needs FFmpeg:",
      "   Windows: winget install Gyan.FFmpeg",
      "   macOS:   brew install ffmpeg",
      "   Linux:   install ffmpeg, curl, and unzip/tar with your package manager.",
      "",
      "2. Double-click the matching launcher:",
      "   Windows: Galcode-windows.exe",
      "   macOS Apple Silicon: Galcode-macos-arm64, or use the separate Galcode.app package",
      "   macOS Intel: Galcode-macos-x64",
      "   Linux x64: ./Galcode-linux-x64",
      "",
      "   Fallback script launchers:",
      "   Windows: start.bat",
      "   macOS/Linux: chmod +x start.sh install.sh galcode && ./start.sh",
      "",
      "3. To generate and record directly:",
      "   Windows: .\\galcode.bat make --theme \"灯和爱音雨夜和解\" --record --duration 60",
      "   macOS/Linux: ./galcode make --theme \"灯和爱音雨夜和解\" --record --duration 60",
      "",
      "The first run needs internet access. It installs Galcode, Electron/Playwright, WebGAL dependencies, downloads portable Node.js if needed, and downloads the WebGAL engine if needed.",
      ""
    ].join(os.EOL), "utf8");
    return;
  }
  const lines = [
    "Galcode quick start",
    "",
    "1. Install prerequisites:",
    isWin
      ? "   Binary launchers can download portable Node.js. For recording: winget install Gyan.FFmpeg"
      : platformTarget === "macos"
      ? "   Binary launchers can download portable Node.js. For recording: brew install ffmpeg"
      : "   Binary launchers can download portable Node.js. For recording, install ffmpeg, curl, and unzip/tar.",
    "",
    "2. Run the one-click starter from this folder:",
    isWin ? "   Double-click Galcode.exe, or run start.bat" : "   Double-click the Galcode binary, or run ./start.sh",
    "",
    "3. To generate and record directly:",
    isWin
      ? "   .\\galcode.bat make --theme \"灯和爱音雨夜和解\" --record --duration 60"
      : "   ./galcode make --theme \"灯和爱音雨夜和解\" --record --duration 60",
    "",
    "The first run needs internet access. It installs Galcode, Electron/Playwright, WebGAL dependencies, downloads portable Node.js if needed, and downloads the WebGAL engine if needed.",
    isUnix ? "If start.sh is not executable, run: chmod +x start.sh install.sh galcode" : ""
  ].filter(Boolean);
  await fs.writeFile(path.join(stageDir, "START_HERE.txt"), `${lines.join(os.EOL)}${os.EOL}`, "utf8");
}

async function archivePackage(platformTarget, stageDir, archive) {
  if (platformTarget === "windows" || platformTarget === "universal") {
    if (process.platform === "win32") {
      await run("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Compress-Archive -Force -Path ${psQuote(path.join(stageDir, "*"))} -DestinationPath ${psQuote(archive)}`
      ]);
      return;
    }
    if (process.platform === "darwin" && await commandExists("ditto")) {
      await run("ditto", ["-c", "-k", "--norsrc", "--keepParent", stageDir, archive], { cwd: path.dirname(stageDir) });
      return;
    }
    await run("zip", ["-qry", archive, path.basename(stageDir)], { cwd: path.dirname(stageDir) });
    return;
  }
  await run("tar", ["-czf", archive, "-C", path.dirname(stageDir), path.basename(stageDir)]);
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = process.platform === "win32"
      ? spawn("where", [command], { stdio: "ignore" })
      : spawn("sh", ["-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || ROOT_DIR,
      stdio: "inherit",
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${commandArgs.join(" ")} failed with ${signal || code}`));
    });
  });
}

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
