# Changelog

## [1.1.0] — 2026-10-27

### DSH 与创作编排

- 按官方规范改用 `dsh plugin --profile galcode add` 创建和维护 profile/bundle，补充 `engines.dsh`，保留用户已有依赖、加载顺序和 patch 配置。
- 为主要角色补充写作约束；新增角色弧线、场景目标/阻力/转折/离场状态与台词潜台词，生成前增加人物和因果复核。
- chara Live2D 新增真实能力目录和语义 `acting`：独立身体动作、表情、视线和强度，支持参数覆盖校验及安全的跨角色动作解析。

### 录制

- 用编译后的逐句时间线驱动 WebGAL 推进，不再每 4 秒猜测按键；LLM 的目标时长与实际录制时长分离，支持程序估算阅读时长。
- macOS 的 realtime/vt-policy 链默认尝试 ANGLE Metal 硬件渲染，vt-policy 默认使用 screencast 推送帧，同步截图保留为回退。
- 修复 ffmpeg 与浏览器关闭后看门狗计时器未取消导致的约 17 秒无效退出等待。
- 新增录制分阶段性能日志；本机 5 秒 720p60 Live2D 验收从 38.54 秒采集降至 5.27 秒，总耗时从 87.62 秒降至 7.62 秒。
- 测试扩展至 139 项（含 1 个既有跳过项），覆盖 DSH 安装、语义演出、时间线、录制驱动与进程清理。

## [1.0.0] — 2026-10-22

首个正式版。Galcode 现在是一个以 dsh(DeepSeek Harness)为主体的终端二创工作室:对话写剧本 → 编译 WebGAL 工程 → 浏览器预览 → 确定性录制出 mp4。

### 亮点

- **dsh TUI 创作台**:裸 `galcode` 直接进创作台;AI 导演挂 Galcode 人格、四个技能和全套 MCP 工具,模型配置完全由 dsh 管理(DeepSeek 官方 API,无本地模型/GPU 要求)。
- **确定性录制(默认)**:`HeadlessExperimental.beginFrame` 驱动虚拟帧时钟,逐帧渲染,掉帧与机器负载解耦;realtime 仅作快速预览。
- **external-clock 回退驱动**:beginFrame 在部分宿主(macOS 26 arm64)会把浏览器进程 SIGTRAP 掉,录制器自动走 beginFrame → `--no-sandbox` → external-clock 的崩溃回退阶梯并记忆结果;`galcode cli browser probe` 可现场重测。
- **Live2D 修复**:新版 chara 包(Cubism 5)模型的"冻结"问题修复——asm.js 堆增长会把 pixi-live2d-display 缓存的参数视图甩进死 buffer;现在核心初始堆 256MB + 视图每次现取,预览/录制启动时自动幂等打补丁。
- **视线编排**:编译期 gaze pass,听者看向说话人、说话人面向观众,支持 25 个角色 × 214 个模型 × 跨角色共享表情动作库。
- **沙箱/下载自愈**:录制浏览器完整性校验 + 能力探针 + 失败自动重下;宿主沙箱杀 Chrome 时自动 no-sandbox 重试。
- **MCP 服务器**:`galcode-mcp` 可接入任何 MCP 宿主;工具/资源/提示词模板全套,新增 `galcode://workflow-guardrails` 防呆规则。
- 三平台(Windows/macOS/Linux)× Node 22/24 CI;vitest 测试套件 119 项。

### 说明

- GUI 时代(v0.1 Electron)代码存档于 `legacy/v0.1-gui` 分支。
- Live2D SDK runtime 与官方模型为版权素材,不随包分发,获取方式见 README。

## [0.2.0] — 2026-10

- GUI 弃用,转为 dsh TUI 应用;移除 Electron 录制技术栈。
- MCP 服务器、pnpm workspace、vitest、三平台 CI。
- 浏览器预览取代本地录制出片。

## [0.1.0] — GUI 时代

- Electron GUI + 旧录制方案(存档于 `legacy/v0.1-gui`)。
