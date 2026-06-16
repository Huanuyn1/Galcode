# Galcode — Windows

AI 驱动的 WebGAL 二创 CLI。输入想法 → 写剧本 → 编译 → 录制视频。

## 环境准备

安装 [Node.js](https://nodejs.org) (≥20) 和 [FFmpeg](https://ffmpeg.org/download.html)。

确保 `node` 和 `ffmpeg` 在 PATH 中：
```cmd
node --version
ffmpeg -version
```

## 快速开始

```cmd
cd galcode
install.bat
copy .env.example .env      REM 编辑 .env 填入 API key
galcode yolo --offline --duration 30 --record
```

打开视频：
```cmd
start outputs\*\final.mp4
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
galcode                                REM 交互模式
galcode yolo --record                  REM AI 自由发挥 + 录视频
galcode make --theme "灯和爱音雨夜和解" --record
```

交互模式命令：`/brainstorm` `/yolo` `/make` `/quit`，直接输入中文即可。

## 输出

```
outputs\<作品名>\
├── story.json
├── game\scene\start.txt
└── final.mp4
```

## 素材

`figure\` 含 MyGO / Ave Mujica 全员 Live2D 模型、45 张背景、1 首 BGM。

## 许可证

Galcode — MIT。素材仅供个人学习交流。
