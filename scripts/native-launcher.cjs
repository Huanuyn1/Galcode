#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = fs.promises;
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn, spawnSync } = require("node:child_process");

const NODE_VERSION = process.env.GALCODE_NODE_VERSION || "v22.16.0";
const PROJECT_ZIP_URL = process.env.GALCODE_PROJECT_ZIP || "https://github.com/Huanuyn1/Galcode/archive/refs/heads/main.zip";
const REQUIRED_PROJECT_FILES = [
  "package.json",
  path.join("scripts", "galcode-bootstrap.mjs"),
  path.join("bin", "galcode.js"),
  path.join("src", "galcode.js"),
  path.join("src", "electron-recorder.cjs"),
  path.join("src", "gui", "main.cjs"),
  path.join("src", "gui", "preload.cjs"),
  path.join("src", "gui", "index.html"),
  path.join("vendor", "webgal-mygo", "packages", "webgal", "public", "lib", "live2d.min.js"),
  path.join("vendor", "webgal-mygo", "packages", "webgal", "public", "lib", "live2dcubismcore.min.js")
];
const REQUIRED_PROJECT_TEXT = [
  [path.join("scripts", "galcode-bootstrap.mjs"), "getNpmInvocation"],
  [path.join("scripts", "galcode-bootstrap.mjs"), "extractZipWithNode"],
  [path.join("scripts", "galcode-bootstrap.mjs"), "replaceDirectorySafely"],
  [path.join("scripts", "galcode-bootstrap.mjs"), "preserveLive2DRuntimeFiles"],
  [path.join("src", "galcode.js"), "npmInvocation"],
  [path.join("src", "galcode.js"), "resolveProjectRoot"],
  [path.join("src", "gui", "main.cjs"), "resolveRootDir"],
  [path.join("src", "electron-recorder.cjs"), "startFfmpegEncoder"]
];
const PRESERVED_INSTALL_PATHS = [
  ".galcode",
  "outputs",
  path.join("tools", "runtime")
];
const rawArgs = process.argv.slice(2);
const terminalChildIndex = rawArgs.indexOf("--terminal-child");
const isTerminalChild = terminalChildIndex !== -1;
if (isTerminalChild) rawArgs.splice(terminalChildIndex, 1);
const LAUNCH_LOG = initLaunchLog();
teeConsoleToLog(LAUNCH_LOG);

main().catch(async (error) => {
  console.error(`Galcode launcher failed: ${error.message}`);
  if (LAUNCH_LOG) console.error(`Log: ${LAUNCH_LOG}`);
  if (process.env.GALCODE_DEBUG === "1") console.error(error.stack);
  openWindowsLog(LAUNCH_LOG);
  await showWindowsError(error, LAUNCH_LOG).catch(() => {});
  pauseIfWindows();
  process.exitCode = 1;
});

async function main() {
  let rootDir = resolveRootDir();

  if (!isTerminalChild && shouldOpenTerminal()) {
    await openInTerminal(rawArgs);
    return;
  }

  rootDir = await ensureProjectRoot(rootDir);
  printHeader(rootDir);

  const node = await ensureNode(rootDir);
  if (rawArgs.includes("--help") || rawArgs[0] === "help") {
    await run(node.exe, [path.join(rootDir, "bin", "galcode.js"), ...rawArgs], {
      cwd: rootDir,
      env: {
        ...process.env,
        GALCODE_ROOT: rootDir,
        GALCODE_NODE: node.exe,
        GALCODE_LOG_FILE: LAUNCH_LOG,
        PATH: [node.binDir, path.join(rootDir, "tools", "bin"), systemPath()].filter(Boolean).join(path.delimiter)
      },
      stdio: "inherit"
    });
    return;
  }

  const bootstrap = path.join(rootDir, "scripts", "galcode-bootstrap.mjs");
  if (!fs.existsSync(bootstrap)) throw new Error(`Missing bootstrap script: ${bootstrap}`);

  const cliMode = rawArgs[0] === "--cli";
  if (cliMode) rawArgs.shift();
  const bootstrapCommand = cliMode ? "start" : "gui";

  await run(node.exe, [bootstrap, bootstrapCommand, ...rawArgs], {
    cwd: rootDir,
    env: {
      ...process.env,
      GALCODE_ROOT: rootDir,
      GALCODE_NODE: node.exe,
      GALCODE_LOG_FILE: LAUNCH_LOG,
      PATH: [node.binDir, path.join(rootDir, "tools", "bin"), process.env.PATH || ""].filter(Boolean).join(path.delimiter)
    },
    stdio: "inherit"
  });
}

function printHeader(rootDir) {
  console.log("========================================");
  console.log(" Galcode Native Launcher");
  console.log("========================================");
  console.log(`Root: ${rootDir}`);
}

function resolveRootDir() {
  const exe = executablePath();
  const exeDir = path.dirname(exe);

  if (process.platform === "darwin") {
    const marker = `${path.sep}Contents${path.sep}MacOS`;
    const markerIndex = exeDir.indexOf(marker);
    if (markerIndex !== -1) {
      const appDir = exeDir.slice(0, markerIndex);
      const resourceRoot = path.join(appDir, "Contents", "Resources", "Galcode");
      if (isProjectRoot(resourceRoot)) return resourceRoot;
      const besideApp = path.dirname(appDir);
      if (isProjectRoot(besideApp)) return besideApp;
    }
  }

  const candidates = [
    exeDir,
    path.resolve(exeDir, ".."),
    process.cwd(),
    path.resolve(__dirname, "..")
  ];
  for (const candidate of candidates) {
    if (isProjectRoot(candidate)) return candidate;
  }
  return exeDir;
}

function isProjectRoot(dir) {
  return missingProjectFiles(dir).length === 0;
}

function missingProjectFiles(dir) {
  const missing = REQUIRED_PROJECT_FILES.filter((file) => !fs.existsSync(path.join(dir, file)));
  for (const [file, marker] of REQUIRED_PROJECT_TEXT) {
    const target = path.join(dir, file);
    if (!fs.existsSync(target)) continue;
    try {
      if (!fs.readFileSync(target, "utf8").includes(marker)) missing.push(`${file} (outdated)`);
    } catch {
      missing.push(`${file} (unreadable)`);
    }
  }
  return missing;
}

function looksLikeGalcodeProject(dir) {
  return fs.existsSync(path.join(dir, "package.json")) ||
    fs.existsSync(path.join(dir, "scripts", "galcode-bootstrap.mjs")) ||
    fs.existsSync(path.join(dir, "bin", "galcode.js"));
}

async function ensureProjectRoot(candidateRoot) {
  if (isProjectRoot(candidateRoot)) return candidateRoot;
  reportOutdatedProject(candidateRoot);

  const installRoot = defaultProjectRoot();
  if (isProjectRoot(installRoot)) return installRoot;
  reportOutdatedProject(installRoot);

  console.log("Galcode project files were not found next to this launcher.");
  console.log(`Installing Galcode project files into: ${installRoot}`);
  await installProjectFiles(installRoot);
  return installRoot;
}

function reportOutdatedProject(dir) {
  if (!looksLikeGalcodeProject(dir)) return;
  const missing = missingProjectFiles(dir);
  if (missing.length === 0) return;
  console.log(`Existing Galcode project is out of date: ${dir}`);
  console.log(`Missing: ${missing.join(", ")}`);
  console.log("Refreshing project files before launch...");
}

function defaultProjectRoot() {
  if (process.env.GALCODE_HOME) return path.resolve(process.env.GALCODE_HOME);

  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Galcode", "app");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Galcode", "app");
  }

  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "galcode", "app");
}

async function installProjectFiles(installRoot) {
  const parent = path.dirname(installRoot);
  const archive = path.join(os.tmpdir(), `galcode-project-${Date.now()}.zip`);
  const extractRoot = path.join(os.tmpdir(), `galcode-project-extract-${Date.now()}`);
  const preserveRoot = path.join(os.tmpdir(), `galcode-project-preserve-${Date.now()}`);
  await fsp.mkdir(parent, { recursive: true });
  await fsp.mkdir(extractRoot, { recursive: true });

  try {
    await preserveExistingInstall(installRoot, preserveRoot);
    await download(PROJECT_ZIP_URL, archive);
    console.log(`Project archive: ${await describeFile(archive)}`);
    await extractZip(archive, extractRoot);
    console.log(`Project archive extracted: ${await describeDirectory(extractRoot)}`);
    const extractedRoot = await findExtractedProjectRoot(extractRoot);
    if (!extractedRoot) throw new Error(`Downloaded Galcode archive did not contain a usable project folder. Extracted entries: ${await describeDirectory(extractRoot)}`);

    await replaceDirectorySafely(extractedRoot, installRoot);
    await restorePreservedInstall(preserveRoot, installRoot);
    console.log("Galcode project files are ready.");
  } finally {
    await fsp.rm(archive, { force: true }).catch(() => {});
    await fsp.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(preserveRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function replaceDirectorySafely(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rm(target, { recursive: true, force: true });
  try {
    await fsp.rename(source, target);
    return;
  } catch (error) {
    if (!isMoveFallbackError(error)) throw error;
    console.warn(`Directory rename failed (${error.code}); copying files instead.`);
  }

  await sleep(500);
  try {
    await fsp.rename(source, target);
    return;
  } catch (error) {
    if (!isMoveFallbackError(error)) throw error;
    console.warn(`Directory rename retry failed (${error.code}); using recursive copy.`);
  }

  await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
  await fsp.cp(source, target, { recursive: true, force: true });
  await fsp.rm(source, { recursive: true, force: true }).catch(() => {});
}

function isMoveFallbackError(error) {
  return ["EXDEV", "EPERM", "EACCES", "EBUSY"].includes(error?.code);
}

async function findExtractedProjectRoot(extractRoot) {
  const queue = [{ dir: extractRoot, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (isProjectRoot(current.dir)) return current.dir;
    if (current.depth >= 3) continue;

    let entries = [];
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return "";
}

async function describeDirectory(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    if (entries.length === 0) return "(empty)";
    return entries
      .slice(0, 20)
      .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`)
      .join(", ");
  } catch (error) {
    return `unable to read ${dir}: ${error.message}`;
  }
}

async function describeFile(file) {
  try {
    const stat = await fsp.stat(file);
    const fd = await fsp.open(file, "r");
    try {
      const header = Buffer.alloc(Math.min(8, stat.size));
      await fd.read(header, 0, header.length, 0);
      return `${stat.size} bytes, first bytes ${header.toString("hex") || "(none)"}`;
    } finally {
      await fd.close();
    }
  } catch (error) {
    return `unable to read ${file}: ${error.message}`;
  }
}

async function preserveExistingInstall(installRoot, preserveRoot) {
  if (!fs.existsSync(installRoot)) return;
  for (const rel of PRESERVED_INSTALL_PATHS) {
    const source = path.join(installRoot, rel);
    if (!fs.existsSync(source)) continue;
    const dest = path.join(preserveRoot, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.cp(source, dest, { recursive: true, force: true });
  }
}

async function restorePreservedInstall(preserveRoot, installRoot) {
  if (!fs.existsSync(preserveRoot)) return;
  for (const rel of PRESERVED_INSTALL_PATHS) {
    const source = path.join(preserveRoot, rel);
    if (!fs.existsSync(source)) continue;
    const dest = path.join(installRoot, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.cp(source, dest, { recursive: true, force: true });
  }
}

function shouldOpenTerminal() {
  if (process.platform === "win32") return false;
  return !process.stdin.isTTY || !process.stdout.isTTY;
}

async function openInTerminal(args) {
  const exe = process.execPath;
  const quotedArgs = ["--terminal-child", ...args].map(shellQuote).join(" ");
  const command = `${shellQuote(exe)} ${quotedArgs}`;

  if (process.platform === "darwin") {
    await run("osascript", [
      "-e", "tell application \"Terminal\" to activate",
      "-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`
    ], { stdio: "ignore", detached: true });
    return;
  }

  const terminals = [
    ["x-terminal-emulator", ["-e", command]],
    ["gnome-terminal", ["--", "sh", "-lc", command]],
    ["konsole", ["-e", "sh", "-lc", command]],
    ["xfce4-terminal", ["-e", command]],
    ["xterm", ["-e", command]]
  ];

  for (const [terminal, terminalArgs] of terminals) {
    if (!(await commandExists(terminal))) continue;
    await run(terminal, terminalArgs, { stdio: "ignore", detached: true });
    return;
  }

  console.error("No graphical terminal was found. Please run this launcher from a terminal.");
}

async function ensureNode(rootDir) {
  const portable = findPortableNode(rootDir);
  if (portable && await isUsableNode(portable.exe)) return portable;

  const systemNode = await findSystemNode();
  if (systemNode && await isUsableNode(systemNode.exe) && await commandExists(systemNode.npmCommand)) {
    console.log(`Node.js: ${await collect(systemNode.exe, ["--version"])}`);
    return systemNode;
  }

  console.log(`Node.js 20+ not found. Downloading portable Node.js ${NODE_VERSION}...`);
  return await installPortableNode(rootDir);
}

function findPortableNode(rootDir) {
  const toolsBin = path.join(rootDir, "tools", "bin");
  const directNode = path.join(toolsBin, process.platform === "win32" ? "node.exe" : "node");
  if (fs.existsSync(directNode)) return { exe: directNode, binDir: toolsBin, npmCommand: npmCommandForBin(toolsBin) };

  const runtimeDir = path.join(rootDir, "tools", "runtime");
  if (!fs.existsSync(runtimeDir)) return null;
  const entries = fs.readdirSync(runtimeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("node-"))
    .map((entry) => path.join(runtimeDir, entry.name));

  for (const dir of entries) {
    const binDir = process.platform === "win32" ? dir : path.join(dir, "bin");
    const exe = path.join(binDir, process.platform === "win32" ? "node.exe" : "node");
    if (fs.existsSync(exe)) return { exe, binDir, npmCommand: npmCommandForBin(binDir) };
  }
  return null;
}

async function findSystemNode() {
  const nodeNames = process.platform === "win32" ? ["node.exe", "node"] : ["node"];
  const candidateDirs = [
    process.env.GALCODE_NODE ? path.dirname(process.env.GALCODE_NODE) : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin"
  ].filter(Boolean);

  const candidates = [];
  if (process.env.GALCODE_NODE) candidates.push(process.env.GALCODE_NODE);
  for (const dir of candidateDirs) {
    for (const name of nodeNames) candidates.push(path.join(dir, name));
  }
  for (const name of nodeNames) candidates.push(name);

  for (const exe of unique(candidates)) {
    const isBareCommand = !exe.includes(path.sep);
    if (!isBareCommand && !fs.existsSync(exe)) continue;
    if (isBareCommand && !(await commandExists(exe))) continue;
    if (!(await isUsableNode(exe))) continue;
    const binDir = isBareCommand ? "" : path.dirname(exe);
    const npmCommand = npmCommandForBin(binDir);
    if (await commandExists(npmCommand)) return { exe, binDir, npmCommand };
  }
  return null;
}

async function isUsableNode(exe) {
  try {
    const majorText = await collect(exe, ["-e", "process.stdout.write(process.versions.node.split('.')[0])"]);
    const major = Number(majorText.trim());
    return Number.isFinite(major) && major >= 20;
  } catch {
    return false;
  }
}

async function installPortableNode(rootDir) {
  const spec = nodeDownloadSpec();
  const runtimeDir = path.join(rootDir, "tools", "runtime");
  const archive = path.join(os.tmpdir(), `${spec.folder}.${spec.ext}`);
  await fsp.mkdir(runtimeDir, { recursive: true });

  try {
    await download(spec.url, archive);
    await extractArchive(archive, runtimeDir, spec.ext);
  } finally {
    await fsp.rm(archive, { force: true }).catch(() => {});
  }

  const extracted = path.join(runtimeDir, spec.folder);
  const binDir = process.platform === "win32" ? extracted : path.join(extracted, "bin");
  const exe = path.join(binDir, process.platform === "win32" ? "node.exe" : "node");
  if (!fs.existsSync(exe)) throw new Error(`Portable Node.js extraction did not create ${exe}`);

  console.log(`Portable Node.js ready: ${exe}`);
  return { exe, binDir, npmCommand: npmCommandForBin(binDir) };
}

function nodeDownloadSpec() {
  const arch = mapArch(process.arch);
  const platform = mapPlatform(process.platform);
  const folder = `node-${NODE_VERSION}-${platform}-${arch}`;
  const ext = process.platform === "win32" ? "zip" : "tar.xz";
  return {
    folder,
    ext,
    url: `https://nodejs.org/dist/${NODE_VERSION}/${folder}.${ext}`
  };
}

function mapPlatform(platform) {
  if (platform === "win32") return "win";
  if (platform === "darwin") return "darwin";
  if (platform === "linux") return "linux";
  throw new Error(`Unsupported platform: ${platform}`);
}

function mapArch(arch) {
  if (arch === "x64") return "x64";
  if (arch === "arm64") return "arm64";
  throw new Error(`Unsupported architecture: ${arch}`);
}

function npmCommandForBin(binDir) {
  if (!binDir) return process.platform === "win32" ? "npm.cmd" : "npm";
  const npm = path.join(binDir, process.platform === "win32" ? "npm.cmd" : "npm");
  if (fs.existsSync(npm)) return npm;
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function extractArchive(archive, destDir, ext) {
  if (ext === "zip") {
    await extractZip(archive, destDir);
    return;
  }

  await run("tar", ["-xJf", archive, "-C", destDir], { stdio: "inherit" });
}

async function extractZip(archive, destDir) {
  await extractZipWithNode(archive, destDir);
  if ((await directoryHasEntries(destDir))) return;

  console.warn(`Node zip extraction produced no files. Falling back to system extractor for ${archive}`);
  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -Force -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(destDir)}`
    ], { stdio: "inherit" });
    return;
  }

  if (process.platform === "darwin" && await commandExists("ditto")) {
    await run("ditto", ["-x", "-k", archive, destDir], { stdio: "inherit" });
    return;
  }

  if (await commandExists("unzip")) {
    await run("unzip", ["-qo", archive, "-d", destDir], { stdio: "inherit" });
    return;
  }

  throw new Error("Need unzip to extract Galcode project files on this platform.");
}

async function download(url, dest) {
  const errors = [];
  const methods = [
    ["node:https", downloadWithNode],
    ["curl", downloadWithCurl],
    ["powershell", downloadWithPowerShell]
  ];

  for (const [name, method] of methods) {
    try {
      await fsp.rm(dest, { force: true }).catch(() => {});
      console.log(`Downloading: ${url}`);
      if (name !== "node:https") console.log(`Download fallback: ${name}`);
      await method(url, dest);
      await validateDownloadedFile(dest);
      console.log(`Download ready: ${await describeFile(dest)}`);
      return;
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }

  throw new Error(`Download failed or produced an invalid archive. ${errors.join(" | ")}`);
}

async function downloadWithNode(url, dest, redirects = 0) {
  if (redirects > 5) throw new Error("Too many redirects");
  await new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "Galcode Launcher",
        "Accept": "application/zip,application/octet-stream,*/*"
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadWithNode(new URL(response.headers.location, url).toString(), dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on("finish", () => file.close((error) => error ? reject(error) : resolve()));
      file.on("error", (error) => {
        response.destroy();
        reject(error);
      });
    });
    request.on("error", reject);
    request.setTimeout(60000, () => request.destroy(new Error("Download timed out")));
  });
}

async function downloadWithCurl(url, dest) {
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  if (!(await commandExists(command))) throw new Error(`${command} not found`);
  await run(command, ["-L", "--fail", "--retry", "3", "--connect-timeout", "30", "-o", dest, url], { stdio: "inherit" });
}

async function downloadWithPowerShell(url, dest) {
  if (process.platform !== "win32") throw new Error("PowerShell fallback is Windows-only");
  if (!(await commandExists("powershell"))) throw new Error("powershell not found");
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri ${psQuote(url)} -OutFile ${psQuote(dest)}`
  ], { stdio: "inherit" });
}

async function validateDownloadedFile(file) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat || stat.size < 1024) throw new Error(`downloaded file is too small (${stat ? stat.size : 0} bytes)`);
  if (path.extname(file).toLowerCase() !== ".zip") return;

  const fd = await fsp.open(file, "r");
  try {
    const header = Buffer.alloc(4);
    await fd.read(header, 0, 4, 0);
    if (header.toString("latin1", 0, 2) !== "PK") {
      throw new Error(`downloaded file is not a zip archive; first bytes: ${header.toString("hex")}`);
    }
  } finally {
    await fd.close();
  }
}

async function extractZipWithNode(archive, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const zip = await fsp.readFile(archive);
  const eocdOffset = findEndOfCentralDirectory(zip);
  if (eocdOffset < 0) throw new Error(`Invalid zip archive: EOCD not found in ${archive}`);

  const totalEntries = zip.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = zip.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0xffff) throw new Error("Zip64 archives are not supported by the built-in extractor.");

  let offset = centralDirectoryOffset;
  let extracted = 0;
  const destRoot = path.resolve(destDir);

  for (let i = 0; i < totalEntries; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid zip central directory at offset ${offset}`);

    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const fileNameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const fileName = zip
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString((flags & 0x800) ? "utf8" : "utf8")
      .replace(/\\/g, "/");

    offset += 46 + fileNameLength + extraLength + commentLength;
    if (!fileName || fileName.endsWith("/")) continue;

    const target = path.resolve(destRoot, fileName);
    if (target !== destRoot && !target.startsWith(`${destRoot}${path.sep}`)) {
      throw new Error(`Unsafe zip entry path: ${fileName}`);
    }

    if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid zip local header for ${fileName}`);
    }
    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported zip compression method ${method} for ${fileName}`);

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    extracted += 1;
  }

  console.log(`Node zip extractor wrote ${extracted} files.`);
}

function findEndOfCentralDirectory(zip) {
  const min = Math.max(0, zip.length - 0xffff - 22);
  for (let offset = zip.length - 22; offset >= min; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function directoryHasEntries(dir) {
  try {
    const entries = await fsp.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function commandExists(command) {
  return new Promise((resolve) => {
    if (command.includes(path.sep)) {
      resolve(fs.existsSync(command));
      return;
    }
    const child = process.platform === "win32"
      ? spawn("where", [command], { stdio: "ignore" })
      : spawn("sh", ["-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
        env: { ...process.env, PATH: systemPath() },
        stdio: "ignore"
      });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const commandSpec = normalizeSpawnCommand(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: options.cwd || undefined,
      env: options.env || process.env,
      stdio: options.stdio || "inherit",
      detached: Boolean(options.detached),
      shell: false
    });
    if (options.detached) child.unref();
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0 || options.detached) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}

function normalizeSpawnCommand(command, args = []) {
  if (process.platform !== "win32") return { command, args };
  const base = path.basename(command).toLowerCase();
  const usesCmd = base === "npm" ||
    base === "npm.cmd" ||
    base === "npx" ||
    base === "npx.cmd" ||
    base.endsWith(".cmd") ||
    base.endsWith(".bat");
  if (!usesCmd) return { command, args };

  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")]
  };
}

function quoteWindowsArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function collect(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PATH: systemPath() },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

function systemPath() {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    process.env.PATH || ""
  ].filter(Boolean).join(path.delimiter);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function initLaunchLog() {
  const candidates = process.platform === "win32"
    ? [
      path.join(path.dirname(executablePath()), "Galcode-launcher.log"),
      path.join(defaultLogDir(), "Galcode-launcher.log")
    ]
    : [path.join(defaultLogDir(), `launcher-${timestampForFile()}.log`)];

  for (const file of candidates) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `\nGalcode launcher log\n${new Date().toISOString()}\n\n`, "utf8");
      return file;
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

function defaultLogDir() {
  if (process.env.GALCODE_LOG_DIR) return path.resolve(process.env.GALCODE_LOG_DIR);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Galcode", "logs");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Logs", "Galcode");
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "galcode", "logs");
}

function teeConsoleToLog(file) {
  if (!file) return;
  for (const method of ["log", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      appendLogLine(file, args.map(formatLogArg).join(" "));
    };
  }
}

function appendLogLine(file, text) {
  try {
    fs.appendFileSync(file, `${text}\n`, "utf8");
  } catch {
    // Logging must never block launch.
  }
}

function formatLogArg(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function executablePath() {
  return process.pkg ? process.execPath : __filename;
}

function openWindowsLog(logFile) {
  if (process.platform !== "win32" || !logFile || !fs.existsSync(logFile)) return;
  try {
    const child = spawn("notepad.exe", [logFile], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
  } catch {
    // Best effort only.
  }
}

function showWindowsError(error, logFile) {
  if (process.platform !== "win32") return Promise.resolve();
  const message = [
    "Galcode 启动失败。",
    "",
    error.message,
    "",
    logFile ? `日志文件：${logFile}` : "",
    logFile ? "日志已经尝试用记事本打开；也可以在 exe 同目录找 Galcode-launcher.log。" : "",
    "如果之前运行过旧版，请重新双击新版 Galcode-windows.exe，它会自动刷新本地项目缓存。"
  ].filter(Boolean).join("\n");
  const script = [
    "Add-Type -AssemblyName PresentationFramework",
    `[System.Windows.MessageBox]::Show(${psQuote(message)}, ${psQuote("Galcode 启动失败")}, 'OK', 'Error') | Out-Null`
  ].join("; ");

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], { stdio: "ignore", windowsHide: true });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

function pauseIfWindows() {
  if (process.platform !== "win32") return;
  console.error("");
  console.error("Press Enter to exit...");
  try {
    fs.readSync(0, Buffer.alloc(1), 0, 1);
  } catch {
    spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "pause"], { stdio: "inherit" });
  }
}
