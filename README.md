# Galcode

Galcode 是一个面向 WebGAL 二创工作流的交互式 CLI。输入想法或让它自由发挥，它会根据本地素材生成剧情结构、编译 WebGAL 脚本、套用 Bang Dream 手游风格主题，并录制成视频。

## 快速开始

```bash
cd galcode
./install.sh
cp .env.example .env        # 编辑 .env 填入 API key
galcode                     # 进入交互模式
```

`install.sh` 会把 `galcode` 安装到 `~/.local/bin/`。如果终端提示找不到 `galcode`：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 配置 API

```bash
galcode configure
```

或直接编辑 `.env`：

```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-key-here
```

## 用法

### 一行命令生成作品并录制成视频

```bash
# 离线 demo（不需要 API key）
galcode yolo --offline --duration 30 --record --capture electron --out outputs/demo

# 指定主题
galcode make --mode yolo --theme "灯和爱音在雨夜排练前和解" --duration 60 --record --capture electron
```

### 交互式 Agent

```bash
galcode
```

进入后可以：

```text
灯和爱音在雨夜排练前和解       直接输入想法，AI 展开剧情
/brainstorm 祥子和睦的误会    先让 AI 给 3 个方向供选择
/make 灯在演出前写不出词       指定主题生成
/yolo                         不讨论，AI 自己决定写什么
/quit                         退出
```

### 只生成不录制

```bash
galcode yolo --offline --out outputs/story
```

### 只编译已有剧情

```bash
galcode compile story.json --assets work/asset-manifest.json --out outputs/compiled
```

### 只录制已有工程

```bash
galcode record outputs/story --url http://localhost:3000 --duration 60
```

## 输出结构

```
outputs/<作品名>/
├── story.json              剧情数据（JSON）
├── game/
│   ├── config.txt           WebGAL 配置
│   ├── scene/start.txt      编译后的 WebGAL 脚本
│   ├── background/          背景图
│   ├── figure/live2d/       Live2D 模型
│   ├── _mtn_exp/            共享表情/动作
│   └── template/            Bang Dream 手游风格 UI
├── preview.html             简易预览页
└── final.mp4                录制的视频
```

## 录制模式

| 模式 | 命令 | 说明 |
|------|------|------|
| Electron | `--capture electron` | 推荐。跨平台后台渲染，使用 `minterpolate` 插值消除卡顿 |
| Screenshot | `--capture screenshot` | 逐帧截图合成，确定性调试用 |
| AVFoundation | `--capture avfoundation` | macOS 可见录屏，非主流程 |
| Playwright | `--capture playwright-video` | Playwright 内置录制 |

默认 FPS 60，可用 `--fps <n>` 调整。

## 素材说明

### figure/ — 好用的 Live2D 模型

`figure/` 目录包含预整理好的 MyGO!!!!! / Ave Mujica 角色 Live2D 模型和背景：

```
figure/
├── mygo/
│   ├── anon/          千早爱音（多套服装）
│   ├── tomori/        高松灯
│   ├── soyo/          长崎爽世
│   ├── taki/          椎名立希
│   ├── rana/          要乐奈
│   ├── sakiko/        丰川祥子
│   ├── mutsumi/       若叶睦
│   ├── uika/          三角初华
│   ├── umiri/         八幡海铃
│   └── nyamu/         祐天寺若麦
├── _mtn_exp/          共享表情和动作数据
└── 背景/              背景图集
```

每个角色的每套服装都有独立的 `model.json`、`.moc`、纹理和物理文件。

### 素材来源

Live2D 模型和背景来自 `figure/` 目录。引擎和主题在 `vendor/` 下。不再依赖 `vendor/mygoxmujica_archive`（已移除，其内容与 `figure/` 重复）。

## 项目结构

```
galcode                 本地启动脚本（自动设置 PATH）
install.sh              安装 galcode 到 ~/.local/bin
bin/galcode.js          npm 入口
src/galcode.js          CLI 主逻辑（Agent、编译、录制）
src/electron-recorder.cjs  Electron 后台录制器
docs/USER_MANUAL.md     使用手册
figure/                 Live2D 模型和背景（好用的源）
themes/                 WebGAL 主题
vendor/                 WebGAL 引擎
tools/                  打包的 Node.js / npm / FFmpeg
```

## 常用命令速查

```bash
# 素材索引
galcode index --out work/asset-manifest.json

# 重新配置 API
galcode configure

# 断点续传下载素材
galcode download-assets --target mygoxmujica

# 安装/替换 Live2D Runtime
galcode install-live2d-runtime --from /path/to/live2d-sdk-lib
```

## 许可证与版权

| 内容 | 来源 | 许可 |
|------|------|------|
| Galcode CLI | 本项目 | MIT |
| WebGAL 引擎 | [OpenWebGAL/WebGAL](https://github.com/OpenWebGAL/WebGAL) | MPL-2.0 |
| WebGAL MyGO 分支 | [boomwwww/webgal-mygo](https://github.com/boomwwww/webgal-mygo) | MPL-2.0 |
| MyGO/Ave Mujica 资源 | [KonshinHaoshin/mygoxmujica_archive](https://github.com/KonshinHaoshin/mygoxmujica_archive) | MIT（仅供个人学习交流） |

本项目适合个人学习和非商业同人实验。公开视频、再分发整合包、商业使用前，请自行确认 BanG Dream / MyGO / Ave Mujica / Bushiroad / Craft Egg / Live2D 以及各素材仓库的许可和社区规则。

## 示例

`outputs/新手教程/` — 千早爱音和椎名立希的对话教程，介绍 Galcode 全部功能。

## 更新计划

详见 [ROADMAP.md](ROADMAP.md) —— TTS 语音、AI 生图、AI 生成 BGM。
