# Galcode

AI 驱动的 WebGAL 二创 CLI。输入一句脑洞，Galcode 会根据本地 MyGO / Ave Mujica 素材生成剧情结构、编译 WebGAL 脚本、套用 Bang Dream 手游风格主题，并把 WebGAL 画面录制成视频。

`main` 分支现在是 Windows / macOS / Linux 通用版。第一次使用建议先看 Windows 新手手册：[小白看这里](docs/小白看这里.md)。

## 一键开始

### Windows

```powershell
git clone https://github.com/Huanuyn1/Galcode.git
cd Galcode
.\start.bat
```

### macOS

```bash
git clone https://github.com/Huanuyn1/Galcode.git
cd Galcode
chmod +x install.sh start.sh galcode
./start.sh
```

### Linux

```bash
git clone https://github.com/Huanuyn1/Galcode.git
cd Galcode
chmod +x install.sh start.sh galcode
./start.sh
```

`start.bat` / `start.sh` 会先自动安装 Galcode、Electron / Playwright、WebGAL 依赖，然后进入交互模式。首次运行需要联网；如果仓库里没有完整 WebGAL engine，安装器会自动下载补齐。

## 环境准备

必须安装：

| 平台 | 依赖 |
| --- | --- |
| Windows 10/11 | Git、Node.js 20+、FFmpeg |
| macOS | Node.js 20+、FFmpeg，推荐用 Homebrew |
| Linux | Node.js 20+、FFmpeg、curl、unzip |

常用安装命令：

```powershell
# Windows PowerShell
winget install Git.Git OpenJS.NodeJS.LTS Gyan.FFmpeg
```

```bash
# macOS
brew install node ffmpeg
```

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y nodejs npm ffmpeg git curl unzip
```

检查：

```bash
node --version
npm --version
ffmpeg -version
```

## 安装和自检

如果不想直接启动，也可以只安装依赖：

```bash
# Windows
.\install.bat

# macOS / Linux
./install.sh
```

自检：

```bash
npm run doctor
```

## 配置 AI

交互向导：

```bash
# Windows
.\galcode.bat configure

# macOS / Linux
./galcode configure
```

也可以手动编辑 `.env`：

```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-key-here
```

## 常用命令

```bash
# 交互讨论模式
./galcode

# AI 自由发挥并录视频
./galcode yolo --record

# 指定主题生成并录视频
./galcode make --theme "灯和爱音雨夜和解" --record --duration 60

# 离线 demo，不需要 API key
./galcode yolo --offline --record --duration 30
```

Windows PowerShell 把 `./galcode` 换成：

```powershell
.\galcode.bat
```

## 录制

| 参数 | 说明 |
| --- | --- |
| `--record` | 生成后自动录制 |
| `--capture electron` | 推荐，Electron 后台渲染 |
| `--capture screenshot` | 逐帧截图，适合排错 |
| `--fps 60` | 输出帧率 |
| `--duration 60` | 目标时长 |

如果没有 `--url`，Galcode 会自动启动本地 WebGAL 预览并录制真实 WebGAL 页面。WebGAL 启动失败时会直接报安装建议，不会偷偷录 fallback 页面。

## 输出

```text
outputs/<作品名>/
├── story.json
├── asset-manifest.json
├── game/scene/start.txt
├── game/figure/live2d/
├── game/template/
└── final.mp4
```

## 一键发行包

生成当前平台包：

```bash
npm run package:current
```

生成通用包：

```bash
npm run package:release
```

产物会放在 `dist/`。发行包里包含 `start.bat`、`start.sh`、`install.bat`、`install.sh` 和项目素材；用户解压后运行对应平台的 `start` 脚本即可自动安装依赖并启动。首次运行同样需要联网，以便下载 npm 依赖和补齐 WebGAL engine。

## 项目结构

```text
start.bat / start.sh       一键安装依赖并启动
install.bat / install.sh   只安装依赖
galcode.bat / galcode      平台启动器
scripts/                   跨平台安装、启动、打包脚本
bin/galcode.js             CLI 入口
src/galcode.js             CLI 主逻辑
src/electron-recorder.cjs  Electron 录制器
figure/                    Live2D 模型 + 背景 + BGM
vendor/                    WebGAL MyGO 引擎
```

## 许可证

Galcode — MIT。素材仅供个人学习交流，商业使用需自行确认授权。
