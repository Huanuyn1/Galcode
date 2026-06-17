# Galcode — Windows

AI 驱动的 WebGAL 二创 CLI。输入想法或让它自由发挥，Galcode 会根据本地 MyGO / Ave Mujica 素材生成剧情结构、编译 WebGAL 脚本、套用 Bang Dream 手游风格主题，并录制成视频。

第一次使用建议先看：[小白看这里](docs/小白看这里.md)。

## 环境准备

### 1. 安装 Node.js（≥20）

从 https://nodejs.org 下载 LTS 版，安装时勾选 **"Add to PATH"**。

```cmd
node --version
npm --version
```

### 2. 安装 FFmpeg

用 winget（管理员 PowerShell）：
```powershell
winget install Gyan.FFmpeg
```

或从 https://ffmpeg.org 下载，解压后将 `bin` 目录加入 PATH。

```cmd
ffmpeg -version
```

### 3. 克隆项目

```cmd
git clone https://github.com/Huanuyn1/Galcode.git
cd Galcode
```

> 默认 `main` 分支就是 Windows 版。

## 快速开始

```cmd
node --version
npm install --include=optional
copy .env.example .env
notepad .env                  # 填入 API key
node .\bin\galcode.js yolo --offline --duration 30 --record --out outputs\first-test
start outputs\first-test\final.mp4
```

## 配置 API

编辑 `.env`：
```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-key-here
```

## 用法

```cmd
node .\bin\galcode.js                                      # 交互模式
node .\bin\galcode.js yolo --record                        # AI 自由发挥 + 录视频
node .\bin\galcode.js make --theme "灯和爱音雨夜和解" --record
node .\bin\galcode.js yolo --offline --record              # 离线 demo
```

交互模式命令：直接输入中文想法，或 `/brainstorm` `/yolo` `/make` `/quit`。如果运行过 `npm link`，也可以直接使用 `galcode` 短命令。

## 录制

| 参数 | 说明 |
|------|------|
| `--capture electron` | 推荐，Electron 后台渲染 |
| `--capture screenshot` | 逐帧截图，调试用 |
| `--fps 60` | 帧率 |
| `--record` | 生成后自动录制 |

## 输出

```
outputs\<作品名>\
├── story.json
├── game\scene\start.txt      WebGAL 脚本
├── game\figure\live2d\        Live2D 模型
├── game\template\            Bang Dream UI
└── final.mp4                 视频（带 BGM）
```

## 素材

`figure\` 含 MyGO / Ave Mujica 全员 Live2D 模型（每角色多套服装 + 共享表情动作）、45 张背景、1 首 BGM。放更多 MP3 到 `figure\bgm\` 后运行 `galcode index` 即可。

## 项目结构

```
bin\galcode.js            CLI 入口
src\galcode.js            CLI 主逻辑
src\electron-recorder.cjs Electron 录制器
figure\                   Live2D 模型 + 背景 + BGM
vendor\                   WebGAL MyGO 引擎
```

## 许可证

Galcode — MIT。素材仅供个人学习交流，商业使用需自行确认授权。
