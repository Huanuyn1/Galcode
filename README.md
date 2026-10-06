# Galcode

AI 驱动的 WebGAL 二创工作室。输入一句脑洞，Galcode 会和你讨论剧情、生成 story JSON、校验并编译成 WebGAL 工程，然后起一个本地预览服务器——在浏览器里直接看你的 MyGO / Ave Mujica 小剧场。

现在的 Galcode 是一个以 [dsh](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek Harness）为主体的终端应用：裸 `galcode` 启动一个 TUI 创作台，里面是带着 Galcode 人格、技能和全套工具的 AI 导演。旧的 Electron GUI、双击 exe 和录制视频技术栈已经移除（存档见文末）。

第一次使用建议先看新手手册：[小白看这里](docs/小白看这里.md)。

## 快速开始

### 1. 安装 Node.js

需要 Node.js **^22.19 或 >=24**。

```powershell
# Windows PowerShell
winget install OpenJS.NodeJS.LTS
```

```bash
# macOS
brew install node
```

```bash
# Ubuntu / Debian（仓库源版本过旧时建议改用 NodeSource 或 nvm）
sudo apt update
sudo apt install -y nodejs npm
```

检查：

```bash
node --version
```

只依赖云端大模型 API，不需要本地模型，不需要 GPU。ffmpeg 是可选项：Galcode 自身不再需要它，只有你自己的后期处理流程用到时再装。

### 2. 安装 Galcode

```bash
npm i -g galcode
```

### 3. 启动

```bash
galcode
```

第一次运行会自动完成初始化：在 `$DSH_HOME/profiles/galcode`（默认 `~/.dsh/profiles/galcode`）创建 dsh profile，用 Galcode 自带的 pnpm 安装社区 TUI（`@deepseek-harness-tui/dsh-tui`）和 Galcode 的 dsh bundle（`dsh-galcode`，随包附带在 `packages/dsh-galcode`），自检通过后进入 TUI。dsh 运行时（`@deepseek-ai/dsh` 0.2.0-rc.2）随 Galcode 一起安装，不需要单独准备。

### 4. 配置模型

模型配置完全由 dsh 管理。首次进入 TUI 时按引导（onboarding）填入 DeepSeek 官方 API key 即可，之后也可以在 TUI 内用 `/login` 或 `/settings` 修改；或者提前设置环境变量 `DEEPSEEK_API_KEY`。

### 5. WebGAL 引擎

WebGAL 引擎目录（`vendor/webgal-mygo`）不随仓库和 npm 包分发（已 gitignore），由安装器按需下载。源码安装时运行：

```bash
node scripts/galcode-bootstrap.mjs install   # 或 npm run install:all
```

npm 全局安装后如果 `galcode doctor` 提示缺少 WebGAL 引擎，运行：

```bash
node "$(npm root -g)/galcode/scripts/galcode-bootstrap.mjs install"
```

不装引擎也能讨论和生成 story JSON，只是编译后的预览跑不起来。

## 在 TUI 里做一部片子

TUI 里的 agent 使用 `galcode` 预设：人格移植自旧版 writer/discuss/brainstorm 提示词，挂载着四个技能（`story-schema`、`webgal-rules`、`asset-conventions`、`live2d-licensing`）和一组 MCP 工具。典型工作流就是直接跟它聊天：

1. **讨论**：告诉它你想写什么——「灯和爱音，雨夜，排练前误会，结尾不要大和解」。它会帮你打磨主题、角色、时长和情绪基调。
2. **生成**：方向清晰后，它会读取素材清单（`galcode://assets`）写出完整的 story JSON。
3. **校验**：调用 `galcode_validate_story` 检查结构、素材 id、动作/表情，有错自动修。
4. **编译**：调用 `galcode_compile_story` 生成 WebGAL 工程到 `outputs/<作品名>/`。
5. **预览**：调用 `galcode_preview_start`，等它打印出 URL（形如 `http://127.0.0.1:3000`），用浏览器打开就能看片。看完让它调用 `galcode_preview_stop` 收工。

写得不好就换个主题再来一次。欲速则不达。

## Live2D 配布与版权边界

公开仓库和 npm 包**不会**内置 Live2D SDK runtime（`live2d.min.js`、`live2dcubismcore.min.js`），也不会内置官方 Live2D 模型、动作、贴图等版权资源——这些文件由对应权利方版权所有，不能二次分发。

- **runtime**：从合法渠道获得两个 runtime 文件后，运行
  `galcode cli install-live2d-runtime --from <所在目录>`，它们会被复制到 WebGAL 引擎的 `public/lib/`。
- **模型包**：官方模型以 Cubism 2/3/4 zip 压缩包形式放进素材目录（`figure/`）后，`galcode cli prepare-live2d`（或生成时自动）会把可渲染的包解压到 `.galcode/live2d-cache` 并挂载进编译产物。
- **获取方式**：需要完整演示素材的用户，请移步作者 B 站账号观看本项目介绍视频，并按视频里的进群方式获取完整文件。
- **没有这些文件也能用**：缺少 runtime 时 WebGAL 会静默禁用 Live2D——预览里只有背景和文字，故事本身照常编译、照常播放。TUI 里的 agent 通过 `live2d-licensing` 技能了解这套边界，会在素材缺失时主动告诉你缺什么、去哪补。

## 环境自检与初始化

```bash
galcode doctor    # 检查 Node、dsh、profile、WebGAL 引擎、Live2D runtime、ffmpeg
galcode setup     # 只初始化/修复 dsh profile（幂等，可重复运行）
```

`doctor` 中 Live2D runtime 和 ffmpeg 是 WARN 级（缺了不影响核心流程），其余是必需项。

## 旧版 CLI（galcode cli）

TUI 之外，旧版命令行仍然完整保留，通过 `cli` 前缀进入（直接写 `galcode <子命令>` 也能跑，会打印一行迁移提示）：

| 命令 | 用途 |
| --- | --- |
| `galcode cli agent` | 旧版交互式 AI 导演 REPL |
| `galcode cli discuss` | 先问几个创作方向问题，再由 AI 写作 |
| `galcode cli make --theme "..." --duration 60` | 按主题生成并编译 |
| `galcode cli yolo --offline` | 不讨论直接生成；`--offline` 跑本地 demo，不需要 API key |
| `galcode cli compile story.json --out outputs/x` | 把 story JSON 编译成 WebGAL 工程 |
| `galcode cli preview outputs/x --port 3000` | 启动本地 WebGAL 预览服务器 |
| `galcode cli configure` | 配置旧版 CLI 用的 OpenAI 兼容接口（`OPENAI_*`，与 dsh 创作台互不影响） |
| `galcode cli index` | 索引素材目录，生成 asset-manifest.json |
| `galcode cli setup --root vendor` | 克隆 vendor 仓库（旧版语义的 setup） |
| `galcode cli download-assets` | 用 curl 断点续传下载素材包，适合不稳定网络 |
| `galcode cli install-live2d-runtime --from <dir>` | 安装 Live2D runtime 文件 |
| `galcode cli prepare-live2d` | 解压可渲染的 Live2D 模型压缩包 |

## MCP 服务器

Galcode 同时是一个本地 MCP 服务器（`galcode-mcp`），可以接入 Claude Desktop、Codex、Cursor 等支持 MCP 的宿主。TUI 里的 agent 用的也是这一套工具。

启动：

```bash
npm run mcp
# 或
node ./bin/galcode-mcp.js
```

Claude Desktop 配置示例（npm 全局安装后 `galcode-mcp` 在 PATH 上）：

```json
{
  "mcpServers": {
    "galcode": {
      "command": "galcode-mcp"
    }
  }
}
```

工具：

| 工具 | 用途 |
| --- | --- |
| `galcode_validate_story` | 校验 story JSON 的结构、素材 id、动作/表情 |
| `galcode_compile_story` | 把 story JSON 编译成 WebGAL 工程（不启动预览） |
| `galcode_preview_start` | 以后台任务启动本地预览服务器，返回 URL |
| `galcode_preview_stop` | 停止预览服务器 |
| `galcode_list_outputs` | 列出已生成的作品目录 |
| `galcode_read_output` | 读取作品的 story.json、start.txt 或 README |
| `galcode_read_log` | 读取预览任务日志或项目内其他日志 |

资源：`galcode://characters`（角色表）、`galcode://assets`（素材清单摘要）、`galcode://story-schema`、`galcode://webgal-rules`、`galcode://style-guide`、`galcode://examples`、`galcode://runtime-status`。另有四个提示词模板：`galcode_write_story_json`、`galcode_revision_pass`、`galcode_fix_validation_errors`、`galcode_preview_debug`。

注意：MCP 服务器以自身安装目录为项目根（素材索引和 `outputs/` 都锚定在那里）。版权边界：MCP 只暴露素材元数据和运行状态，不把 Live2D SDK/runtime、官方模型、贴图等文件内容作为 resource 输出。

## 输出目录

```text
outputs/<作品名>/
├── story.json             # AI 写的剧本（含时间线）
├── asset-manifest.json    # 本次编译用的素材清单
├── title.txt / description.txt
├── preview.html           # 无引擎时的极简回退预览
├── README.md              # 该作品的说明
└── game/                  # WebGAL 工程
    ├── scene/start.txt
    ├── background/ bgm/ figure/live2d/ ...
    └── template/          # Bang Dream 手游风格主题
```

## 项目结构

```text
bin/galcode.js             入口分发：TUI / setup / doctor / cli 旧命令
bin/galcode-mcp.js         MCP 服务器入口
src/dsh-profile.mjs        dsh profile 初始化、启动、doctor
src/galcode.js             旧版 CLI 核心
src/mcp/server.mjs         MCP 服务器实现
packages/dsh-galcode/      dsh bundle：cordis.patch.yml、presets/、skills/
scripts/galcode-bootstrap.mjs  跨平台安装器（下载 WebGAL 引擎等）
themes/                    WebGAL 主题包
figure/                    素材目录；官方 Live2D 模型需用户自行补齐
vendor/webgal-mygo/        WebGAL 引擎（gitignore，安装器下载）
test/                      vitest 测试
.galcode/                  本地运行时状态（prompt 覆盖、live2d 缓存、MCP 任务日志）
```

## 测试与 CI

```bash
pnpm install
pnpm test
```

GitHub Actions 在 Windows / macOS / Linux 三平台 × Node 22 / 24 矩阵上跑单元测试和 CLI 冒烟（`galcode --help`、`galcode doctor --advisory`、`galcode cli yolo --offline` 并校验编译产物），见 `.github/workflows/ci.yml`。

## 从源码开发

```bash
git clone https://github.com/Huanuyn1/Galcode.git
cd Galcode
pnpm install
node scripts/galcode-bootstrap.mjs install   # 补齐 WebGAL 引擎
node bin/galcode.js                          # 等价于全局安装后的 galcode
```

仓库根目录的 `./galcode`（macOS/Linux）和 `galcode.bat`（Windows）是等价的启动 shim。`npm link` 之后即可在任意目录使用 `galcode`。

## 上游与许可证

Galcode 自身代码遵循 MIT 许可证。

本项目使用 WebGAL 作为视觉小说运行与预览引擎，并会在安装流程中自动准备 WebGAL / webgal-mygo 相关文件与依赖：

- WebGAL: https://github.com/OpenWebGAL/WebGAL
- webgal-mygo: https://github.com/boomwwww/webgal-mygo

WebGAL / webgal-mygo 遵循其上游许可证。Galcode 不是 WebGAL 引擎本体，也不是 Live2D SDK 或官方角色素材的再发行项目。

Live2D SDK runtime 文件（例如 `live2d.min.js`、`live2dcubismcore.min.js`）以及官方 Live2D 模型、动作、贴图等文件（例如 `.moc`、`.mtn`、`model.json`、`texture_*.png`）由对应权利方版权所有，不能直接内置在公开仓库或公开发行包里。需要完整文件的用户，请移步作者 B 站账号观看本项目介绍视频，并按视频里的进群方式获取；获取后也请仅在授权范围、个人学习交流或非商业同人实验中使用。

## GUI 时代存档

v0.1 时代的 Electron GUI、原生双击 launcher 和视频录制技术栈已经整体移除，完整代码存档在 [`legacy/v0.1-gui`](https://github.com/Huanuyn1/Galcode/tree/legacy/v0.1-gui) 分支。v0.2 起 Galcode 以 dsh TUI 为主体，浏览器预览取代本地录制出片；确定性渲染与录制回归在路线图（[ROADMAP.md](ROADMAP.md)）的 v0.3 里。
