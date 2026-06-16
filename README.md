# Galcode — macOS

AI 驱动的 WebGAL 二创 CLI。

## 环境准备

macOS 通常自带所需工具。如果没有：

```bash
brew install node ffmpeg
```

验证：
```bash
node --version   # ≥ 20
ffmpeg -version
```

> 项目 `tools/` 目录（如存在）会优先使用其中的 Node.js 和 FFmpeg；如果不存在，自动回退到系统版本。不影响使用。

## 克隆

```bash
git clone -b macos https://github.com/Huanuyn1/Galcode.git
cd Galcode
```

## 快速开始

```bash
./install.sh
cp .env.example .env          # 编辑填入 API key
galcode yolo --offline --duration 30 --record
open outputs/*/final.mp4
```

## 配置 API

编辑 `.env`：
```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-key-here
```

## 用法

```bash
galcode                                      # 交互模式
galcode yolo --record                        # AI 自由发挥 + 录视频
galcode make --theme "灯和爱音雨夜和解" --record
galcode yolo --offline --record              # 离线 demo
```

交互模式：直接输入中文想法，或 `/brainstorm` `/yolo` `/make` `/quit`。

## 录制

| 参数 | 说明 |
|------|------|
| `--capture electron` | 推荐，Electron 后台渲染 |
| `--capture avfoundation` | macOS 可见录屏 |
| `--capture screenshot` | 逐帧截图，调试用 |
| `--fps 60` | 帧率 |
| `--record` | 生成后自动录制 |

## 输出

```
outputs/<作品名>/
├── story.json
├── game/scene/start.txt      WebGAL 脚本
└── final.mp4                 视频（带 BGM）
```

## 素材

`figure/` 含 MyGO / Ave Mujica 全员 Live2D 模型、45 张背景、1 首 BGM。加更多 BGM 到 `figure/bgm/` 后 `galcode index`。

## 许可证

Galcode — MIT。素材仅供个人学习交流。
