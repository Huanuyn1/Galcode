# Galcode — macOS

AI 驱动的 WebGAL 二创 CLI。输入想法或让它自由发挥，Galcode 会根据本地 MyGO / Ave Mujica 素材生成剧情结构、编译 WebGAL 脚本、套用 Bang Dream 手游风格主题，并录制成视频。

它不是美术素材生成器，重点是把已经整理好的素材编排起来，让"想法 → WebGAL 工程 → 视频"的流程全自动。

## 环境准备

macOS 通常自带所需工具。项目 `tools/` 目录已打包了 Node.js 和 FFmpeg，可直接使用。

如果需要自行安装：
```bash
brew install node ffmpeg
```

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Huanuyn1/Galcode.git
cd Galcode
```

或指定 macOS 分支：
```bash
git clone -b macos https://github.com/Huanuyn1/Galcode.git
```

### 2. 安装 galcode 命令

```bash
./install.sh
```

这会把 `galcode` 安装到 `~/.local/bin/`。如果终端提示找不到 `galcode`，将以下行加入 `~/.zshrc`：
```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 3. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env` 填入你的 API 配置：
```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-key-here
```

也可以用交互式配置：
```bash
galcode configure
```

### 4. 跑起来

```bash
galcode yolo --offline --duration 30 --record
```

这会生成一个 30 秒的离线 demo 并录制成 MP4。打开视频：
```bash
open outputs/*/final.mp4
```

没有 API key 时，离线模式（`--offline`）用内置模板生成，适合体验流程。

### 5. 对接 AI

编辑 `.env` 填入真实 API key 后，去掉 `--offline`：

```bash
galcode yolo --duration 60 --record
```

AI 会从素材库中选择角色、背景、BGM，写出完整剧本，自动配上表情变化。

## 使用方式

### 交互式 Agent

```bash
galcode
```

进入后可以：
```
灯和爱音在雨夜排练前和解       直接输入想法，AI 展开剧情
/brainstorm 祥子和睦的误会     让 AI 给 3 个方向供选择
/make 灯在演出前写不出词        指定主题生成
/yolo                          不讨论，AI 自己决定
/config                        重新配置 API
/quit                          退出
```

生成前会问是否录制视频和输出目录名。

### 命令行模式

```bash
# 离线 demo
galcode yolo --offline --duration 30 --record

# AI 自由发挥
galcode yolo --duration 60 --record --capture electron

# 指定主题
galcode make --mode yolo --theme "灯和爱音在雨夜排练前和解" --duration 90 --record

# 只编译已有剧情
galcode compile story.json --out outputs/compiled

# 只录制已有工程
galcode record outputs/compiled --duration 60
```

## 录制模式

| 参数 | 说明 |
|------|------|
| `--capture electron` | 推荐。Electron 后台渲染 + ffmpeg 编码 |
| `--capture screenshot` | 逐帧截图合成，用于调试 |
| `--capture avfoundation` | macOS 可见录屏 |
| `--capture playwright-video` | Playwright 内置录制 |
| `--fps 60` | 帧率，默认 60 |
| `--duration 90` | 目标时长（秒） |
| `--record` | 生成后自动录制 |
| `--no-bgm` | 跳过 BGM 混音 |

## 输出结构

```
outputs/<作品名>/
├── story.json              剧情数据（含时间线和 BGM 编排）
├── game/
│   ├── config.txt          WebGAL 配置
│   ├── scene/start.txt     编译后的 WebGAL 脚本
│   ├── background/         背景图
│   ├── figure/live2d/      Live2D 角色模型
│   ├── _mtn_exp/           共享表情和动作数据
│   └── template/           Bang Dream 手游风格 UI
├── preview.html            简易预览页
└── final.mp4               录制的视频（带 BGM）
```

## 素材说明

`figure/` 目录包含预整理好的 MyGO!!!!! / Ave Mujica 角色 Live2D 模型：

```
figure/
├── mygo/                   每位角色 × 多套服装
│   ├── anon/               千早爱音（casual-2023, live_default, school_winter-2023 等）
│   ├── tomori/             高松灯
│   ├── soyo/               长崎爽世
│   ├── taki/               椎名立希
│   ├── rana/               要乐奈
│   ├── sakiko/             丰川祥子
│   ├── mutsumi/            若叶睦
│   ├── uika/               三角初华
│   ├── umiri/              八幡海铃
│   ├── nyamu/              祐天寺若麦
│   └── mana/               纯田真奈
├── _mtn_exp/               共享表情和动作数据（Cubism 2.1 格式）
├── 背景/                    45 张场景背景图
└── bgm/                    s_Title.mp3（默认 BGM，90 秒）
```

每套服装有独立的 `model.json`、`.moc` 模型文件、物理文件和纹理。

AI 会自动根据角色名匹配模型，根据对话情绪选择表情变化（idle → smile → cry → serious）。编译后的 WebGAL 脚本会用 `changeFigure` 命令在对话中途切换表情。

## 命令速查

```bash
galcode yolo --offline --record       离线 demo + 录视频
galcode yolo --record                 AI 自由发挥 + 录视频
galcode make --theme "主题" --record   指定主题
galcode                                交互模式
galcode compile story.json --out out/  只编译
galcode record out/ --duration 60      只录制
galcode configure                      配置 API key
galcode index --out work/manifest.json 重建素材索引
galcode --help                         查看帮助
```

## 常见问题

**Q: 提示 `galcode: command not found`？**
运行 `export PATH="$HOME/.local/bin:$PATH"` 或重新打开终端。

**Q: 录制时提示 Playwright 未安装？**
录制视频只需 FFmpeg + Electron，不需要 Playwright。确保 FFmpeg 可用：`ffmpeg -version`。

**Q: Live2D 模型不显示？**
检查 `vendor/webgal-mygo/packages/webgal/public/lib/` 下是否有 `live2d.min.js` 和 `live2dcubismcore.min.js`。

**Q: 我想加更多 BGM？**
把 MP3 文件放到 `figure/bgm/`，运行 `galcode index` 重建索引即可。

## 项目结构

```
galcode                   启动脚本
install.sh                安装器
bin/galcode.js            npm 入口
src/galcode.js            CLI 主逻辑（Agent、编译、录制、BGM 混音）
src/electron-recorder.cjs Electron 后台录制器
figure/                   Live2D 模型 + 背景 + BGM
themes/                   Bang Dream 主题 ZIP
vendor/                   WebGAL MyGO 引擎
tools/                    打包的 Node.js / FFmpeg（macOS 专用）
```

## 许可证与版权

| 内容 | 来源 | 许可 |
|------|------|------|
| Galcode CLI | 本项目 | MIT |
| WebGAL 引擎 | [OpenWebGAL/WebGAL](https://github.com/OpenWebGAL/WebGAL) | MPL-2.0 |
| WebGAL MyGO 分支 | [boomwwww/webgal-mygo](https://github.com/boomwwww/webgal-mygo) | MPL-2.0 |
| MyGO/Ave Mujica 素材 | [KonshinHaoshin/mygoxmujica_archive](https://github.com/KonshinHaoshin/mygoxmujica_archive) | MIT（仅供个人学习交流） |

本项目适合个人学习和非商业同人实验。公开视频、再分发整合包、商业使用前，请自行确认 BanG Dream / MyGO / Ave Mujica / Bushiroad / Craft Egg / Live2D 以及各素材仓库的许可和社区规则。

## 更新计划

详见 [ROADMAP.md](ROADMAP.md) —— 内置 TTS 语音、AI 生图封面/插画、AI 生成 BGM。
