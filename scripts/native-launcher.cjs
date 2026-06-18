#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = fs.promises;
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const NODE_VERSION = process.env.GALCODE_NODE_VERSION || "v22.16.0";
const rawArgs = process.argv.slice(2);
const terminalChildIndex = rawArgs.indexOf("--terminal-child");
const isTerminalChild = terminalChildIndex !== -1;
if (isTerminalChild) rawArgs.splice(terminalChildIndex, 1);

main().catch((error) => {
  console.error(`Galcode launcher failed: ${error.message}`);
  if (process.env.GALCODE_DEBUG === "1") console.error(error.stack);
  pauseIfWindows();
  process.exitCode = 1;
});

async function main() {
  const rootDir = resolveRootDir();

  if (!isTerminalChild && shouldOpenTerminal()) {
    await openInTerminal(rawArgs);
    return;
  }

  printHeader(rootDir);
  if (!isProjectRoot(rootDir)) {
    throw new Error(`Could not find Galcode project files next to the launcher: ${rootDir}`);
  }

  const node = await ensureNode(rootDir);
  if (rawArgs.includes("--help") || rawArgs[0] === "help") {
    await run(node.exe, [path.join(rootDir, "bin", "galcode.js"), ...rawArgs], {
      cwd: rootDir,
      env: {
        ...process.env,
        PATH: [node.binDir, path.join(rootDir, "tools", "bin"), systemPath()].filter(Boolean).join(path.delimiter)
      },
      stdio: "inherit"
    });
    return;
  }

  const bootstrap = path.join(rootDir, "scripts", "galcode-bootstrap.mjs");
  if (!fs.existsSync(bootstrap)) throw new Error(`Missing bootstrap script: ${bootstrap}`);

  await run(node.exe, [bootstrap, "start", ...rawArgs], {
    cwd: rootDir,
    env: {
      ...process.env,
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
  const exe = process.pkg ? process.execPath : __filename;
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
  return fs.existsSync(path.join(dir, "package.json")) &&
    fs.existsSync(path.join(dir, "scripts", "galcode-bootstrap.mjs")) &&
    fs.existsSync(path.join(dir, "bin", "galcode.js"));
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
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -Force -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(destDir)}`
    ], { stdio: "inherit" });
    return;
  }

  await run("tar", ["-xJf", archive, "-C", destDir], { stdio: "inherit" });
}

async function download(url, dest) {
  console.log(`Downloading: ${url}`);
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
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
    const child = spawn(command, args, {
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

function pauseIfWindows() {
  if (process.platform !== "win32" || process.stdin.isTTY === false) return;
  console.error("");
  console.error("Press Enter to exit...");
  try {
    fs.readSync(0, Buffer.alloc(1), 0, 1);
  } catch {
    // Best effort only.
  }
}
