#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT_DIR, "dist", "native");
const args = parseArgs(process.argv.slice(2));
const target = args.target || "current";
const pkgBin = process.platform === "win32"
  ? path.join(ROOT_DIR, "node_modules", ".bin", "pkg.cmd")
  : path.join(ROOT_DIR, "node_modules", ".bin", "pkg");

if (!fssync.existsSync(pkgBin)) {
  throw new Error("Missing @yao-pkg/pkg. Run: npm install");
}

await fs.mkdir(DIST_DIR, { recursive: true });
const specs = resolveTargets(target);
for (const spec of specs) {
  await buildExecutable(spec);
  if (spec.platform === "macos" && spec.arch === process.arch) {
    await createMacApp(spec);
  }
}

function resolveTargets(value) {
  if (value === "current") return [currentSpec()];
  if (value === "all") {
    return [
      { target: "node22-macos-arm64", platform: "macos", arch: "arm64", ext: "" },
      { target: "node22-macos-x64", platform: "macos", arch: "x64", ext: "" },
      { target: "node22-win-x64", platform: "windows", arch: "x64", ext: ".exe" },
      { target: "node22-linux-x64", platform: "linux", arch: "x64", ext: "" }
    ];
  }
  if (value === "macos") return [
    { target: "node22-macos-arm64", platform: "macos", arch: "arm64", ext: "" },
    { target: "node22-macos-x64", platform: "macos", arch: "x64", ext: "" }
  ];
  if (value === "windows") return [{ target: "node22-win-x64", platform: "windows", arch: "x64", ext: ".exe" }];
  if (value === "linux") return [{ target: "node22-linux-x64", platform: "linux", arch: "x64", ext: "" }];
  throw new Error(`Unknown launcher target: ${value}`);
}

function currentSpec() {
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
  const pkgPlatform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return {
    target: `node22-${pkgPlatform}-${arch}`,
    platform,
    arch,
    ext: process.platform === "win32" ? ".exe" : ""
  };
}

async function buildExecutable(spec) {
  const output = path.join(DIST_DIR, executableName(spec));
  await fs.rm(output, { force: true });
  console.log(`Building ${spec.target} -> ${path.relative(ROOT_DIR, output)}`);
  await run(pkgBin, [
    "--targets", spec.target,
    "--compress", "Brotli",
    "--output", output,
    path.join(ROOT_DIR, "scripts", "native-launcher.cjs")
  ]);
  if (spec.platform !== "windows") await fs.chmod(output, 0o755);
}

function executableName(spec) {
  if (spec.platform === "windows") return "Galcode.exe";
  return `Galcode-${spec.platform}-${spec.arch}${spec.ext}`;
}

async function createMacApp(spec) {
  const binary = path.join(DIST_DIR, executableName(spec));
  if (!fssync.existsSync(binary)) return;

  const appDir = path.join(DIST_DIR, "Galcode.app");
  const macosDir = path.join(appDir, "Contents", "MacOS");
  const resourcesDir = path.join(appDir, "Contents", "Resources");
  const resourceProjectDir = path.join(resourcesDir, "Galcode");

  console.log(`Creating ${path.relative(ROOT_DIR, appDir)}`);
  await fs.rm(appDir, { recursive: true, force: true });
  await fs.mkdir(macosDir, { recursive: true });
  await fs.mkdir(resourcesDir, { recursive: true });

  await fs.copyFile(binary, path.join(macosDir, "Galcode"));
  await fs.chmod(path.join(macosDir, "Galcode"), 0o755);
  await fs.writeFile(path.join(appDir, "Contents", "Info.plist"), infoPlist(), "utf8");
  await copyProject(resourceProjectDir);

  const zip = path.join(DIST_DIR, `Galcode-macos-${spec.arch}.app.zip`);
  await fs.rm(zip, { force: true });
  if (process.platform === "darwin") {
    await run("ditto", ["-c", "-k", "--norsrc", "--keepParent", appDir, zip], { cwd: DIST_DIR });
    console.log(`Created ${path.relative(ROOT_DIR, zip)}`);
  }
}

async function copyProject(dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await rootEntries()) {
    await fs.cp(entry, path.join(dest, path.basename(entry)), {
      recursive: true,
      preserveTimestamps: true,
      filter: shouldCopy
    });
  }
}

async function rootEntries() {
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
  return (await fs.readdir(ROOT_DIR))
    .filter((entry) => include.has(entry))
    .map((entry) => path.join(ROOT_DIR, entry));
}

function shouldCopy(source) {
  const rel = path.relative(ROOT_DIR, source);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  const blocked = new Set([".DS_Store", ".git", ".galcode", "dist", "node_modules", "outputs", "work"]);
  return !parts.some((part) => blocked.has(part));
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Galcode</string>
  <key>CFBundleIdentifier</key>
  <string>top.huanuyn.galcode</string>
  <key>CFBundleName</key>
  <string>Galcode</string>
  <key>CFBundleDisplayName</key>
  <string>Galcode</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
</dict>
</plist>
`;
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
