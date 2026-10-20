// pixi-live2d-display-webgal 运行时补丁:修复 wasm heap 增长导致的立绘冻结。
//
// 背景:Cubism Core 的 wasm 内存初始 16MB,加载多个大模型(moc3 各 ~4-5MB)
// 时会增长到 33MB,底层 ArrayBuffer 被整个换掉。该库的 CubismModel 在
// initialize() 时把 parameters.values / parts.opacities 等 TypedArray 视图
// 缓存为字段;heap 一换,这些视图就指向旧 buffer —— 动作写入全部落空,
// 核心模型永远保持默认姿态(渲染"冻结"),且不抛任何错误。
// 谁先加载谁遭殃(与模型文件无关),素世/乐奈/灯只是恰好躲过了增长窗口。
//
// 补丁:CubismModel 不再缓存这四个视图,改为每次访问时从 live heap 现取。
// (pixi 渲染侧本来就每次现取 vertexPositions,physics/evaluate 也是现取,
// 所以只需要改 CubismModel 这一处。)
//
// node_modules 不进 git,本函数在每次 preview/record 启动时幂等地打补丁。

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

const MARKER = "galcode patch: fresh live-heap views";

const OLD_INIT_RE = /([ \t]*)initialize\(\) \{\n[ \t]*this\._parameterValues = this\._model\.parameters\.values;\n[ \t]*this\._partOpacities = this\._model\.parts\.opacities;\n[ \t]*this\._parameterMaximumValues = this\._model\.parameters\.maximumValues;\n[ \t]*this\._parameterMinimumValues = this\._model\.parameters\.minimumValues;\n([ \t]*)\{\n[ \t]*const parameterIds = this\._model\.parameters\.ids;/;

const CLASS_MARKER = "class CubismModel {";
const TARGET_FILES = ["index.es.js", "index.js", "cubism4.es.js", "cubism4.js"];

async function patchFile(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return "missing";
  }
  if (text.includes(MARKER) || (!OLD_INIT_RE.test(text) && text.includes("get _parameterValues"))) return "already";
  const match = text.match(OLD_INIT_RE);
  if (!match || match.index === undefined) return "no-match";
  const indent = match[1];
  const initIndex = match.index;
  const classIndex = text.lastIndexOf(CLASS_MARKER, initIndex);
  if (classIndex < 0) return "no-match";
  const getters = CLASS_MARKER + "\n" + [
    `  // ${MARKER}`,
    `  get _parameterValues() {`,
    `    return this._model.parameters.values;`,
    `  }`,
    `  get _partOpacities() {`,
    `    return this._model.parts.opacities;`,
    `  }`,
    `  get _parameterMaximumValues() {`,
    `    return this._model.parameters.maximumValues;`,
    `  }`,
    `  get _parameterMinimumValues() {`,
    `    return this._model.parameters.minimumValues;`,
    `  }`,
  ].map((l, i) => (i === 0 ? l : indent.slice(0, Math.max(0, indent.length - 2)) + l)).join("\n");
  text = text.replace(OLD_INIT_RE, `$1initialize() {\n$2{\n$2  const parameterIds = this._model.parameters.ids;`);
  const newInitIndex = text.indexOf("const parameterIds", classIndex);
  const cls = text.lastIndexOf(CLASS_MARKER, newInitIndex);
  text = text.slice(0, cls) + getters + text.slice(cls + CLASS_MARKER.length);
  await fs.writeFile(filePath, text, "utf8");
  return "patched";
}

// 核心 heap 扩容:asm.js 核的初始堆 16MB,装三个模型就会增长并把缓存视图
// 留在旧 buffer 上。把初始堆提到 256MB(纯地址空间,桌面浏览器无压力),
// 加载阶段就永远不会增长。public/lib 下的 core 文件同样不进 git。
const CORE_OLD = "b.TOTAL_MEMORY||16777216";
const CORE_NEW = "b.TOTAL_MEMORY||268435456";

async function patchCoreHeap(webgalDir, { log = () => {} } = {}) {
  const corePath = path.join(webgalDir, "public", "lib", "live2dcubismcore.min.js");
  let text;
  try {
    text = await fs.readFile(corePath, "utf8");
  } catch {
    return false; // runtime 未安装(用户需自行放置),跳过
  }
  if (text.includes(CORE_NEW)) return false;
  if (!text.includes(CORE_OLD)) {
    log("警告: live2dcubismcore.min.js 未匹配到 TOTAL_MEMORY 位置(core 版本可能已变更)");
    return false;
  }
  await fs.writeFile(corePath, text.replace(CORE_OLD, CORE_NEW), "utf8");
  log("已将 Cubism Core 初始堆 16MB → 256MB(防止加载期堆增长冻住模型)");
  return true;
}

// 返回 { patched: string[], clearedViteCache: boolean, coreHeapPatched: boolean }
export async function ensurePixiLive2DPatch(webgalWorkspaceRoot, { log = () => {} } = {}) {
  const coreHeapPatched = await patchCoreHeap(path.join(webgalWorkspaceRoot, "packages", "webgal"), { log });
  const distDir = path.join(webgalWorkspaceRoot, "node_modules", "pixi-live2d-display-webgal", "dist");
  const patched = [];
  let changed = false;
  for (const name of TARGET_FILES) {
    const result = await patchFile(path.join(distDir, name));
    if (result === "patched") {
      patched.push(name);
      changed = true;
    } else if (result === "no-match") {
      log(`警告: ${name} 未匹配到补丁位置(库版本可能已变更)`);
    }
  }
  let clearedViteCache = false;
  if (changed) {
    // vite 会把依赖预打包进 .vite/deps,补丁后必须清掉缓存重新预打包
    for (const dir of [
      path.join(webgalWorkspaceRoot, "node_modules", ".vite"),
      path.join(webgalWorkspaceRoot, "packages", "webgal", "node_modules", ".vite"),
    ]) {
      if (fssync.existsSync(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
        clearedViteCache = true;
      }
    }
    log(`已修补 pixi-live2d-display-webgal(heap 增长冻结问题): ${patched.join(", ")}`);
  }
  return { patched, clearedViteCache, coreHeapPatched };
}
