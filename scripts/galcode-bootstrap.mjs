#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBGAL_DIR = path.join(ROOT_DIR, "vendor", "webgal-mygo");
const WEBGAL_ZIP = "https://github.com/boomwwww/webgal-mygo/archive/refs/heads/main.zip";
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const LOG_FILE = process.env.GALCODE_LOG_FILE || "";

process.chdir(ROOT_DIR);
teeConsoleToLog(LOG_FILE);

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "install";

try {
  if (command === "install") {
    await install(parseFlags(argv));
  } else if (command === "start") {
    if (argv[0] === "--") argv.shift();
    await install({ quick: true, skipCommandInstall: true });
    await run(process.execPath, [path.join(ROOT_DIR, "bin", "galcode.js"), ...argv], { cwd: ROOT_DIR });
  } else if (command === "gui") {
    if (argv[0] === "--") argv.shift();
    await install({ quick: true, skipCommandInstall: true });
    await launchGui(argv);
  } else if (command === "doctor") {
    await doctor();
  } else if (command === "help" || command === "--help") {
    printHelp();
  } else {
    throw new Error(`Unknown bootstrap command: ${command}`);
  }
} catch (error) {
  console.error(`Galcode bootstrap failed: ${error.message}`);
  if (process.env.GALCODE_DEBUG === "1") console.error(error.stack);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Galcode bootstrap

Usage:
  node scripts/galcode-bootstrap.mjs install [--force]
  node scripts/galcode-bootstrap.mjs start [galcode args...]
  node scripts/galcode-bootstrap.mjs gui
  node scripts/galcode-bootstrap.mjs doctor

The installer is shared by Windows, macOS, and Linux. It installs npm
dependencies, repairs Electron when needed, prepares WebGAL, and checks ffmpeg.
`);
}

async function install(flags = {}) {
  assertNodeVersion();
  printHeader(flags.quick ? "Galcode Quick Start" : "Galcode Installer");
  console.log(`Root: ${ROOT_DIR}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Node.js: ${process.version}`);

  await ensureRootDependencies(flags);
  await repairElectron(flags);
  await ensureWebGALEngine(flags);
  await ensureWebGALDependencies(flags);
  await ensureWebGALParser(flags);
  await checkFfmpeg();

  if (!flags.skipCommandInstall) {
    await installCommandShim();
  }

  console.log("");
  console.log("Done.");
  console.log(isWindows
    ? "Run: .\\galcode.bat --help"
    : "Run: ./galcode --help");
}

function printHeader(title) {
  console.log("========================================");
  console.log(` ${title}`);
  console.log("========================================");
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node.js 20 or newer is required. Current version: ${process.version}`);
  }
}

async function ensureRootDependencies(flags) {
  const missingNodeModules = !fssync.existsSync(path.join(ROOT_DIR, "node_modules"));
  const missingElectron = !fssync.existsSync(path.join(ROOT_DIR, "node_modules", "electron"));
  if (!flags.force && !missingNodeModules && !missingElectron) {
    console.log("[1/5] Galcode dependencies: OK");
    return;
  }

  console.log("[1/5] Installing Galcode dependencies...");
  await runNpm(["install", "--omit=dev", "--include=optional"], ROOT_DIR);
}

async function repairElectron(flags) {
  const installJs = path.join(ROOT_DIR, "node_modules", "electron", "install.js");
  if (!fssync.existsSync(installJs)) {
    console.log("[2/5] Electron runtime: skipped (electron package missing)");
    return;
  }

  const runtimePath = getExpectedElectronPath();
  const frameworkPath = path.join(
    ROOT_DIR,
    "node_modules",
    "electron",
    "dist",
    "Electron.app",
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Electron Framework"
  );
  const runtimeOK = fssync.existsSync(runtimePath) && (!isMac || fssync.existsSync(frameworkPath));

  if (!flags.force && runtimeOK) {
    console.log("[2/5] Electron runtime: OK");
    return;
  }

  console.log("[2/5] Repairing Electron runtime...");
  await fs.rm(path.join(ROOT_DIR, "node_modules", "electron", "dist"), { recursive: true, force: true });
  await fs.rm(path.join(ROOT_DIR, "node_modules", "electron", "path.txt"), { force: true });
  await run(process.execPath, ["install.js"], {
    cwd: path.join(ROOT_DIR, "node_modules", "electron")
  });
}

function getExpectedElectronPath() {
  if (isWindows) return path.join(ROOT_DIR, "node_modules", "electron", "dist", "electron.exe");
  if (isMac) return path.join(ROOT_DIR, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
  return path.join(ROOT_DIR, "node_modules", "electron", "dist", "electron");
}

async function ensureWebGALEngine(flags) {
  const packageJson = path.join(WEBGAL_DIR, "packages", "webgal", "package.json");
  if (fssync.existsSync(packageJson)) {
    console.log("[3/5] WebGAL engine: OK");
    return;
  }
  if (flags.noWebgal || flags.skipWebgalDownload) {
    console.log("[3/5] WebGAL engine: skipped");
    return;
  }

  console.log("[3/5] Downloading WebGAL engine...");
  await fs.mkdir(path.join(ROOT_DIR, "vendor"), { recursive: true });
  const zipPath = path.join(os.tmpdir(), `galcode-webgal-${Date.now()}.zip`);
  const extractRoot = path.join(os.tmpdir(), `galcode-webgal-extract-${Date.now()}`);
  try {
    await fs.mkdir(extractRoot, { recursive: true });
    await downloadFile(WEBGAL_ZIP, zipPath);
    await extractZip(zipPath, extractRoot);
    const entries = await fs.readdir(extractRoot, { withFileTypes: true });
    const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("webgal-mygo-"));
    if (!extracted) throw new Error("Downloaded WebGAL archive did not contain a webgal-mygo directory.");
    await fs.rm(WEBGAL_DIR, { recursive: true, force: true });
    await fs.rename(path.join(extractRoot, extracted.name), WEBGAL_DIR);
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => {});
    await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function ensureWebGALDependencies(flags) {
  const packageJson = path.join(WEBGAL_DIR, "package.json");
  if (!fssync.existsSync(packageJson)) {
    console.log("[4/5] WebGAL dependencies: skipped (engine missing)");
    return;
  }
  if (!flags.force && fssync.existsSync(path.join(WEBGAL_DIR, "node_modules"))) {
    console.log("[4/5] WebGAL dependencies: OK");
    return;
  }

  console.log("[4/5] Installing WebGAL dependencies...");
  await runNpm(["install", "--legacy-peer-deps"], WEBGAL_DIR);
}

async function ensureWebGALParser(flags) {
  const parserDir = path.join(WEBGAL_DIR, "packages", "parser");
  const parserEntry = path.join(parserDir, "build", "es", "index.js");
  if (fssync.existsSync(parserEntry)) {
    console.log("[5/5] WebGAL parser: OK");
    return;
  }
  if (!fssync.existsSync(path.join(parserDir, "package.json"))) {
    console.log("[5/5] WebGAL parser: skipped (parser package missing)");
    return;
  }
  if (flags.noParserBuild) {
    console.log("[5/5] WebGAL parser: skipped");
    return;
  }

  console.log("[5/5] Building WebGAL parser...");
  await runNpm(["run", "build"], parserDir);
}

async function checkFfmpeg() {
  if (await commandExists("ffmpeg")) {
    console.log("ffmpeg: OK");
    return;
  }

  console.warn("ffmpeg: not found. Galcode can generate projects, but recording final.mp4 needs ffmpeg.");
  if (isWindows) console.warn("Install with: winget install Gyan.FFmpeg");
  if (isMac) console.warn("Install with: brew install ffmpeg");
  if (isLinux) console.warn("Install with your package manager, for example: sudo apt install ffmpeg");
}

async function installCommandShim() {
  if (isWindows) {
    console.log("Command shim: use .\\galcode.bat or .\\start.bat on Windows");
    return;
  }

  const binDir = process.env.GALCODE_BIN_DIR || path.join(os.homedir(), ".local", "bin");
  const target = path.join(binDir, "galcode");
  await fs.mkdir(binDir, { recursive: true });
  const launcher = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `ROOT_DIR=${shellQuote(ROOT_DIR)}`,
    "cd \"$ROOT_DIR\"",
    "export PATH=\"$ROOT_DIR/tools/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
    `exec ${shellQuote(process.execPath)} "$ROOT_DIR/bin/galcode.js" "$@"`,
    ""
  ].join("\n");
  await fs.writeFile(target, launcher, { mode: 0o755 });
  await fs.chmod(target, 0o755);
  console.log(`Command shim: ${target}`);
  if (!process.env.PATH.split(path.delimiter).includes(binDir)) {
    console.log(`Add to PATH if needed: export PATH="${binDir}:$PATH"`);
  }
}

async function doctor() {
  assertNodeVersion();
  printHeader("Galcode Doctor");
  const checks = [
    ["Root", ROOT_DIR, true],
    ["Node.js >=20", process.version, true],
    ["npm", getNpmCommand(), await commandExists(getNpmCommand())],
    ["ffmpeg", "ffmpeg", await commandExists("ffmpeg")],
    ["Galcode node_modules", "node_modules", fssync.existsSync(path.join(ROOT_DIR, "node_modules"))],
    ["Electron runtime", getExpectedElectronPath(), fssync.existsSync(getExpectedElectronPath())],
    ["WebGAL engine", WEBGAL_DIR, fssync.existsSync(path.join(WEBGAL_DIR, "packages", "webgal", "package.json"))],
    ["WebGAL node_modules", path.join(WEBGAL_DIR, "node_modules"), fssync.existsSync(path.join(WEBGAL_DIR, "node_modules"))],
    ["WebGAL parser", path.join(WEBGAL_DIR, "packages", "parser", "build", "es", "index.js"), fssync.existsSync(path.join(WEBGAL_DIR, "packages", "parser", "build", "es", "index.js"))]
  ];
  for (const [name, value, ok] of checks) {
    console.log(`${ok ? "[OK]  " : "[MISS]"} ${name}: ${value}`);
  }
}

async function launchGui(args = []) {
  const electron = findElectronBinary();
  if (!electron) {
    throw new Error("Electron runtime was not found after install. Run `npm install --omit=dev --include=optional`, then retry.");
  }
  const mainScript = path.join(ROOT_DIR, "src", "gui", "main.cjs");
  if (!fssync.existsSync(mainScript)) throw new Error(`GUI entry was not found: ${mainScript}`);

  await run(electron, [mainScript, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      GALCODE_ROOT: ROOT_DIR,
      GALCODE_NODE: process.execPath,
      PATH: buildPath()
    }
  });
}

function findElectronBinary() {
  const candidates = isWindows
    ? [
      path.join(ROOT_DIR, "node_modules", "electron", "dist", "electron.exe"),
      path.join(ROOT_DIR, "node_modules", ".bin", "electron.cmd")
    ]
    : isMac
    ? [
      path.join(ROOT_DIR, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
      path.join(ROOT_DIR, "node_modules", ".bin", "electron")
    ]
    : [
      path.join(ROOT_DIR, "node_modules", "electron", "dist", "electron"),
      path.join(ROOT_DIR, "node_modules", ".bin", "electron")
    ];
  return candidates.find((candidate) => fssync.existsSync(candidate)) || "";
}

function getNpmCommand() {
  const toolsNpm = path.join(ROOT_DIR, "tools", "bin", isWindows ? "npm.cmd" : "npm");
  if (fssync.existsSync(toolsNpm)) return toolsNpm;
  return isWindows ? "npm.cmd" : "npm";
}

async function runNpm(args, cwd) {
  await run(getNpmCommand(), args, { cwd });
}

async function commandExists(command) {
  return new Promise((resolve) => {
    if (command.includes(path.sep)) {
      resolve(fssync.existsSync(command));
      return;
    }
    const child = isWindows
      ? spawn("where", [command], { stdio: "ignore" })
      : spawn("sh", ["-c", `command -v ${shellQuote(command)} >/dev/null 2>&1`], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function run(commandPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const commandSpec = normalizeSpawnCommand(commandPath, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: options.cwd || ROOT_DIR,
      env: {
        ...process.env,
        PATH: buildPath(),
        ...(options.env || {})
      },
      stdio: options.stdio || "inherit",
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandPath} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}

function normalizeSpawnCommand(commandPath, args = []) {
  if (!isWindows) return { command: commandPath, args };
  const base = path.basename(commandPath).toLowerCase();
  const usesCmd = base === "npm" ||
    base === "npm.cmd" ||
    base === "npx" ||
    base === "npx.cmd" ||
    base.endsWith(".cmd") ||
    base.endsWith(".bat");
  if (!usesCmd) return { command: commandPath, args };

  const commandLine = [commandPath, ...args].map(quoteWindowsArg).join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine]
  };
}

function quoteWindowsArg(value) {
  const text = String(value);
  return `"${text.replace(/"/g, '\\"')}"`;
}

function buildPath() {
  const parts = [
    path.join(ROOT_DIR, "tools", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || ""
  ];
  return parts.filter(Boolean).join(path.delimiter);
}

async function downloadFile(url, dest) {
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      const file = fssync.createWriteStream(dest);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function extractZip(zipPath, destDir) {
  if (isWindows) {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -Force -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destDir)}`
    ]);
    return;
  }
  if (isMac && await commandExists("ditto")) {
    await run("ditto", ["-x", "-k", zipPath, destDir]);
    return;
  }
  if (await commandExists("unzip")) {
    await run("unzip", ["-qo", zipPath, "-d", destDir]);
    return;
  }
  throw new Error("Need unzip to extract WebGAL on this platform.");
}

function parseFlags(values) {
  const flags = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    flags[key] = true;
  }
  return flags;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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
    fssync.mkdirSync(path.dirname(file), { recursive: true });
    fssync.appendFileSync(file, `${text}\n`, "utf8");
  } catch {
    // Logging should never make bootstrap fail.
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
