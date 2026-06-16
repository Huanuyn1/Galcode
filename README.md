# Galcode

AI 驱动的 WebGAL 二创 CLI。输入想法 → AI 写剧本 → 编译 WebGAL 脚本 → 套 Bang Dream 主题 → 录制成视频。

## 你需要什么

| 依赖 | macOS | Linux | Windows |
|------|-------|-------|---------|
| Node.js ≥ 20 | 系统自带或 `brew install node` | `apt install nodejs` | [nodejs.org](https://nodejs.org) |
| FFmpeg | 系统自带或 `brew install ffmpeg` | `apt install ffmpeg` | [ffmpeg.org](https://ffmpeg.org) |
| AI API Key | 任意 OpenAI 兼容接口 | 同左 | 同左 |
| Git | 系统自带 | 系统自带 | [git-scm.com](https://git-scm.com) |

> **macOS 用户**：项目 `tools/` 目录已打包了 Node.js 和 FFmpeg，可不装。

## 一分钟跑起来

```bash
# 1. 进入项目
cd galcode

# 2. 安装 galcode 命令到 ~/.local/bin
./install.sh          # macOS / Linux
install.bat           # Windows

# 3. 配置 API key（二选一）
cp .env.example .env  # 然后编辑 .env 填入你的 key
# 或者
galcode configure     # 交互式配置

# 4. 跑一个离线 demo（不需要 API key）
galcode yolo --offline --duration 30 --record --capture electron

# 5. 打开视频
open outputs/*/final.mp4    # macOS
xdg-open outputs/*/final.mp4  # Linux
start outputs/*/final.mp4    # Windows
```

## 用 API 发挥全部能力

编辑 `.env`：

```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-real-key-here
```

然后：

```bash
galcode                                      # 交互式 Agent
galcode yolo --duration 60 --record           # 全自动生成
galcode make --theme "灯和爱音雨夜和解" --record  # 指定主题
```

## 输出

```
outputs/<作品名>/
├── story.json              剧情数据
├── game/scene/start.txt     编译后的 WebGAL 脚本
├── game/background/         背景图
├── game/figure/live2d/      Live2D 角色模型
├── game/template/           Bang Dream 手游 UI
└── final.mp4                录制的视频（带 BGM）
```

## 素材

`figure/` 目录包含 MyGO!!!!! / Ave Mujica 全员的 Live2D 模型、45 张背景图和 1 首 BGM。AI 会自动根据角色名匹配模型，根据情绪选择表情变化。

```
figure/
├── mygo/         每位角色多套服装的 model.json + .moc + 纹理
├── _mtn_exp/     共享表情和动作数据
├── 背景/          45 张场景背景
└── bgm/           s_Title.mp3
```

如果模型不显示，检查 `vendor/webgal-mygo/packages/webgal/public/lib/` 下是否缺少 `live2d.min.js` 和 `live2dcubismcore.min.js`。

## 命令速查

```bash
galcode yolo --offline --record        # 离线 demo + 录视频
galcode yolo --record                  # AI 自由发挥 + 录视频
galcode make --theme "..." --record    # 指定主题
galcode                                # 交互模式（支持 /brainstorm /yolo /make /quit）
galcode compile story.json --out out/  # 只编译已有剧情
galcode record out/ --duration 60      # 只录制已有工程
galcode configure                      # 配置 API key
galcode index --out work/manifest.json # 重建素材索引
```

## 项目结构

```
galcode                    启动脚本（macOS/Linux）
galcode.bat                Windows 启动器
install.sh / install.bat   安装到 ~/.local/bin
src/galcode.js             CLI 主逻辑
src/electron-recorder.cjs  Electron 后台录制
figure/                    Live2D 模型 + 背景 + BGM
themes/                    Bang Dream 主题 ZIP
vendor/webgal-mygo/        WebGAL MyGO 引擎
```

## 许可证

Galcode CLI — MIT。WebGAL 引擎 — MPL-2.0。素材仅供个人学习交流，商业使用需自行确认授权。
