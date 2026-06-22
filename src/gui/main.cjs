"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = resolveRootDir();
const NODE = process.env.GALCODE_NODE || findNode() || "node";
let mainWindow = null;
let activeChild = null;

process.chdir(ROOT_DIR);
app.setName("Galcode");

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1040,
    minHeight: 620,
    title: "Galcode",
    backgroundColor: "#101419",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("galcode:get-state", async () => {
  const config = await readConfig();
  return {
    rootDir: ROOT_DIR,
    node: NODE,
    hasApiKey: Boolean(config.openaiApiKey || process.env.OPENAI_API_KEY),
    openaiBaseUrl: config.openaiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    openaiModel: config.openaiModel || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    electronGpu: normalizeElectronGpuMode(config.electronGpu || process.env.GALCODE_ELECTRON_GPU || defaultElectronGpuMode()),
    visualTheme: normalizeVisualTheme(config.visualTheme || process.env.GALCODE_VISUAL_THEME || "dark")
  };
});

ipcMain.handle("galcode:save-config", async (_event, config) => {
  const target = path.join(ROOT_DIR, ".galcode", "config.json");
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const existing = await readConfig();
  const has = (key) => Object.prototype.hasOwnProperty.call(config || {}, key);
  const next = {
    ...existing,
    openaiBaseUrl: has("openaiBaseUrl") ? String(config.openaiBaseUrl || "").trim() || "https://api.openai.com/v1" : existing.openaiBaseUrl || "https://api.openai.com/v1",
    openaiModel: has("openaiModel") ? String(config.openaiModel || "").trim() || "gpt-4.1-mini" : existing.openaiModel || "gpt-4.1-mini",
    openaiApiKey: has("openaiApiKey") ? String(config.openaiApiKey || "").trim() || existing.openaiApiKey || "" : existing.openaiApiKey || "",
    electronGpu: has("electronGpu") ? normalizeElectronGpuMode(config.electronGpu || defaultElectronGpuMode()) : normalizeElectronGpuMode(existing.electronGpu || defaultElectronGpuMode()),
    visualTheme: has("visualTheme") ? normalizeVisualTheme(config.visualTheme) : normalizeVisualTheme(existing.visualTheme || "dark")
  };
  await fsp.writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fsp.chmod(target, 0o600).catch(() => {});
  return { ok: true, hasApiKey: Boolean(next.openaiApiKey), electronGpu: next.electronGpu, visualTheme: next.visualTheme };
});

ipcMain.handle("galcode:run", async (event, task) => {
  if (activeChild) throw new Error("已有任务正在运行，请先停止或等待完成。");
  const id = task.id || `task-${Date.now()}`;
  const command = await buildTaskCommand(task);
  sendLog(id, [
    `Root: ${ROOT_DIR}`,
    `Node: ${NODE}`,
    `Electron: ${process.execPath}`,
    `Electron GPU: ${command.electronGpu}`,
    `CWD: ${process.cwd()}`,
    `$ ${command.label}`,
    ""
  ].join("\n"));

  activeChild = spawnNormalized(command.command, command.args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      GALCODE_ROOT: ROOT_DIR,
      GALCODE_NODE: NODE,
      GALCODE_ELECTRON_GPU: command.electronGpu,
      ELECTRON: process.execPath,
      PATH: buildPath()
    }
  });

  activeChild.stdout.on("data", (chunk) => sendLog(id, chunk.toString()));
  activeChild.stderr.on("data", (chunk) => sendLog(id, chunk.toString()));
  activeChild.on("error", (error) => {
    sendLog(id, `\n[启动失败] ${error.message}\n`);
    activeChild = null;
    event.sender.send("galcode:task-done", { id, code: -1 });
  });
  activeChild.on("exit", (code, signal) => {
    sendLog(id, `\n[任务结束] ${signal || code}\n`);
    activeChild = null;
    event.sender.send("galcode:task-done", { id, code: code ?? -1, signal });
  });
  return { ok: true, id };
});

ipcMain.handle("galcode:stop", async () => {
  if (!activeChild) return { ok: true };
  activeChild.kill("SIGTERM");
  activeChild = null;
  return { ok: true };
});

ipcMain.handle("galcode:open-path", async (_event, targetPath) => {
  const resolved = path.resolve(ROOT_DIR, String(targetPath || "outputs"));
  await fsp.mkdir(resolved, { recursive: true }).catch(() => {});
  await shell.openPath(resolved);
  return { ok: true };
});

async function buildTaskCommand(task) {
  if (task.kind === "doctor") {
    return {
      command: NODE,
      args: [path.join(ROOT_DIR, "scripts", "galcode-bootstrap.mjs"), "doctor"],
      label: "galcode doctor",
      electronGpu: normalizeElectronGpuMode(process.env.GALCODE_ELECTRON_GPU || defaultElectronGpuMode())
    };
  }
  if (task.kind === "install") {
    return {
      command: NODE,
      args: [path.join(ROOT_DIR, "scripts", "galcode-bootstrap.mjs"), "install", "--force"],
      label: "galcode install --force",
      electronGpu: normalizeElectronGpuMode(process.env.GALCODE_ELECTRON_GPU || defaultElectronGpuMode())
    };
  }

  const config = await readConfig();
  const electronGpu = normalizeElectronGpuMode(task.electronGpu || config.electronGpu || process.env.GALCODE_ELECTRON_GPU || defaultElectronGpuMode());
  const cliArgs = [];
  const out = String(task.out || "").trim() || path.join("outputs", timestampSlug("gui"));
  if (task.kind === "offline") {
    cliArgs.push("yolo", "--offline", "--duration", String(task.duration || 30), "--out", out);
  } else {
    const theme = String(task.theme || "").trim();
    if (!theme) throw new Error("请先输入主题。");
    cliArgs.push("make", "--theme", theme, "--duration", String(task.duration || 60), "--out", out);
  }
  if (task.record) cliArgs.push("--record", "--electron-gpu", electronGpu);
  return {
    command: NODE,
    args: [path.join(ROOT_DIR, "bin", "galcode.js"), ...cliArgs],
    label: `galcode ${cliArgs.join(" ")}`,
    electronGpu
  };
}

function sendLog(id, text) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("galcode:log", { id, text });
}

async function readConfig() {
  try {
    return JSON.parse(await fsp.readFile(path.join(ROOT_DIR, ".galcode", "config.json"), "utf8"));
  } catch {
    return {};
  }
}

function spawnNormalized(command, args, options = {}) {
  const spec = normalizeSpawnCommand(command, args);
  return spawn(spec.command, spec.args, {
    cwd: options.cwd || ROOT_DIR,
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
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

function buildPath() {
  return [
    path.dirname(NODE),
    path.join(ROOT_DIR, "tools", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || ""
  ].filter(Boolean).join(path.delimiter);
}

function defaultElectronGpuMode() {
  return process.platform === "win32" ? "auto" : "hardware";
}

function normalizeElectronGpuMode(value) {
  const mode = String(value || defaultElectronGpuMode()).trim().toLowerCase();
  if (mode === "auto") return "auto";
  if (["software", "cpu", "off", "disabled", "false", "0"].includes(mode)) return "software";
  if (["hardware", "gpu", "on", "enabled", "true", "1"].includes(mode)) return "hardware";
  if (mode === "swiftshader" || mode === "swift-shader") return "swiftshader";
  return defaultElectronGpuMode();
}

function normalizeVisualTheme(value) {
  const theme = String(value || "dark").trim().toLowerCase();
  return ["light", "day", "bright", "晴", "晴天", "浅色"].includes(theme) ? "light" : "dark";
}

function resolveRootDir() {
  const envRoot = process.env.GALCODE_ROOT || "";
  if (envRoot && isProjectRoot(envRoot)) return path.resolve(envRoot);
  return path.resolve(__dirname, "../..");
}

function isProjectRoot(dir) {
  return fs.existsSync(path.join(dir, "package.json")) &&
    fs.existsSync(path.join(dir, "bin", "galcode.js")) &&
    fs.existsSync(path.join(dir, "src", "galcode.js"));
}

function findNode() {
  const candidates = process.platform === "win32"
    ? ["node.exe", "node"]
    : ["node"];
  for (const candidate of candidates) {
    if (commandExistsSync(candidate)) return candidate;
  }
  return "";
}

function commandExistsSync(command) {
  if (command.includes(path.sep) && fs.existsSync(command)) return true;
  const pathParts = String(process.env.PATH || "").split(path.delimiter);
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathParts) {
    for (const ext of exts) {
      if (fs.existsSync(path.join(dir, command + ext))) return true;
    }
  }
  return false;
}

function timestampSlug(prefix) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `${prefix}-${stamp}`;
}
