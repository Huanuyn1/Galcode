# Galcode 更新计划

## v0.2 — TUI 化（已完成）

GUI 弃用，项目转为以 dsh（DeepSeek Harness）为主体的终端应用：

- 移除 Electron GUI、原生双击 launcher 和视频录制技术栈（存档于 `legacy/v0.1-gui` 分支）
- 裸 `galcode` 启动 dsh TUI 创作台：`galcode` agent 预设（人格移植自旧版 writer/discuss/brainstorm 提示词）+ 四个技能 + MCP 工具
- 工作流改为：对话讨论 → 生成 story JSON → 校验 → 编译 → `preview` 本地预览，在浏览器里看片
- 浏览器预览取代本地录制出片；模型配置完全交给 dsh（云端 API，无本地模型、无 GPU 要求）
- 同步完成：MCP 服务器（v0.1.2 计划）、pnpm workspace、vitest 测试套件、三平台 CI 矩阵

## v0.3 — 确定性渲染管线

让"录屏"以工程化的方式回归，不再依赖脆弱的实时录制：

- 基于 Chromium beginFrame 的确定性逐帧渲染（帧时钟由渲染器驱动，不再靠墙钟截图）
- 录制回归：从 WebGAL 预览页面直接产出成片视频
- canvas MV：为歌曲类二创提供程序化 MV 画面生成

## v0.4 — 音频域

纯 Node 技术栈（onnxruntime-node），不引入 Python 侧车：

- 音频分离（人声/伴奏/鼓组等分轨）
- RVC 变声（角色声线转换）
- 人力 UTAU（拼接式歌声合成）
- 原 v0.2 的 TTS 设想并入本阶段一并评估

## v0.5 — fork TUI 定制面板

fork 社区 `dsh-tui`，做 Galcode 专属的面板定制：

- 作品列表 / 预览状态 / 素材清单等专用面板
- 针对二创工作流的交互优化

---

## 未来方向

- **多语言支持**：中 / 日 / 英 WebGAL 模板 + AI 翻译
- **交互式选项**：WebGAL 分支选项，AI 生成多结局
- **批量投稿**：一次生成多个短篇，适合系列内容
- **AI 生图**：封面 / 场景插画 / AI 背景，自动编入素材索引
- **AI BGM**：按剧情情绪选择或生成背景音乐（当前已支持从素材库编排）
- **角色 LoRA 注入**：生图时保持角色外观一致

---

## 版本历史

| 版本 | 日期 | 内容 |
|------|------|------|
| v0.1.0 | 2026-06 | 基础 CLI、AI 剧本生成、Live2D 渲染、Electron 录制、BGM 混音 |
| v0.1.2 | 2026-10 | MCP 服务器：角色/素材/schema 资源 + 校验、编译、预览工具，接入主流 agent 工具 |
| v0.2 | 2026-10 | TUI 化：GUI 弃用，dsh 主体 TUI 创作台，preview 取代录制，测试与 CI 补齐 |
