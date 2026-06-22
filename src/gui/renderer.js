"use strict";

const views = [...document.querySelectorAll(".view")];
const navButtons = [...document.querySelectorAll(".nav-button")];
const logBox = document.getElementById("logBox");
const statusBadge = document.getElementById("statusBadge");
const rootPath = document.getElementById("rootPath");
const gpuCompatInput = document.getElementById("gpuCompatInput");
const gpuCompatState = document.getElementById("gpuCompatState");
const visualThemeInput = document.getElementById("visualThemeInput");
const visualThemeState = document.getElementById("visualThemeState");
let running = false;

for (const button of navButtons) {
  button.addEventListener("click", () => showView(button.dataset.view));
}

document.getElementById("doctorBtn").addEventListener("click", () => runTask({ kind: "doctor" }, "自检中"));
document.getElementById("installBtn").addEventListener("click", () => runTask({ kind: "install" }, "修复依赖中"));
document.getElementById("openOutputsBtn").addEventListener("click", () => window.galcode.openPath("outputs"));
document.getElementById("generateBtn").addEventListener("click", () => {
  runTask({
    kind: "generate",
    theme: document.getElementById("themeInput").value,
    duration: document.getElementById("durationInput").value,
    out: document.getElementById("outInput").value,
    record: document.getElementById("recordInput").checked,
    electronGpu: getElectronGpuMode()
  }, "生成中");
});
document.getElementById("offlineBtn").addEventListener("click", () => {
  runTask({
    kind: "offline",
    duration: document.getElementById("durationInput").value || 30,
    out: document.getElementById("outInput").value || "outputs/gui-offline",
    record: document.getElementById("recordInput").checked,
    electronGpu: getElectronGpuMode()
  }, "离线测试中");
});
document.getElementById("stopBtn").addEventListener("click", () => window.galcode.stop());
document.getElementById("clearLogBtn").addEventListener("click", () => { logBox.textContent = ""; });
document.getElementById("saveConfigBtn").addEventListener("click", saveConfig);
gpuCompatInput.addEventListener("change", syncGpuCompatState);
visualThemeInput.addEventListener("change", () => syncVisualTheme({ persist: true }));

window.galcode.onLog(({ text }) => appendLog(text));
window.galcode.onTaskDone(() => setRunning(false, "待命"));

init();

async function init() {
  const state = await window.galcode.getState();
  rootPath.textContent = state.rootDir;
  document.getElementById("baseUrlInput").value = state.openaiBaseUrl;
  document.getElementById("modelInput").value = state.openaiModel;
  setElectronGpuMode(state.electronGpu);
  setVisualTheme(state.visualTheme);
  appendLog(`Galcode GUI ready\nRoot: ${state.rootDir}\nNode: ${state.node}\nAPI key: ${state.hasApiKey ? "已配置" : "未配置"}\nElectron GPU: ${getElectronGpuMode()}\n\n`);
}

function showView(id) {
  for (const view of views) view.classList.toggle("active", view.id === id);
  for (const button of navButtons) button.classList.toggle("active", button.dataset.view === id);
}

async function saveConfig() {
  const result = await window.galcode.saveConfig({
    openaiBaseUrl: document.getElementById("baseUrlInput").value,
    openaiModel: document.getElementById("modelInput").value,
    openaiApiKey: document.getElementById("apiKeyInput").value,
    electronGpu: getElectronGpuMode(),
    visualTheme: getVisualTheme()
  });
  document.getElementById("apiKeyInput").value = "";
  appendLog(result.hasApiKey ? `配置已保存，API key 已就绪。Electron GPU: ${result.electronGpu}\n` : `配置已保存，但还没有 API key。Electron GPU: ${result.electronGpu}\n`);
}

async function runTask(task, label) {
  if (running) return;
  try {
    setRunning(true, label);
    showView("logs");
    await window.galcode.run({ ...task, id: `task-${Date.now()}` });
  } catch (error) {
    appendLog(`[错误] ${error.message}\n`);
    setRunning(false, "待命");
  }
}

function setRunning(value, label) {
  running = value;
  statusBadge.textContent = label;
  document.getElementById("stopBtn").disabled = !value;
  document.getElementById("generateBtn").disabled = value;
  document.getElementById("offlineBtn").disabled = value;
  document.getElementById("installBtn").disabled = value;
  document.getElementById("doctorBtn").disabled = value;
}

function appendLog(text) {
  logBox.textContent += text;
  logBox.scrollTop = logBox.scrollHeight;
}

function getElectronGpuMode() {
  return gpuCompatInput.checked ? "software" : "auto";
}

function setElectronGpuMode(mode) {
  const normalized = String(mode || "auto").toLowerCase();
  gpuCompatInput.checked = ["software", "cpu", "off", "disabled", "false", "0"].includes(normalized);
  syncGpuCompatState();
}

function syncGpuCompatState() {
  gpuCompatState.textContent = gpuCompatInput.checked
    ? "已禁用 GPU 硬件加速"
    : "GPU 硬件加速开启";
}

function getVisualTheme() {
  return visualThemeInput.checked ? "light" : "dark";
}

function setVisualTheme(theme) {
  visualThemeInput.checked = String(theme || "dark").toLowerCase() === "light";
  syncVisualTheme();
}

async function syncVisualTheme(options = {}) {
  const theme = getVisualTheme();
  document.body.dataset.visualTheme = theme;
  visualThemeState.textContent = theme === "light" ? "雨后晴空" : "雨夜浮游";
  if (!options.persist) return;
  try {
    await window.galcode.saveConfig({ visualTheme: theme });
  } catch (error) {
    appendLog(`[背景保存失败] ${error.message}\n`);
  }
}
