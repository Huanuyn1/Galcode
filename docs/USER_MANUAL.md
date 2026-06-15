# Galcode 使用手册

欢迎来到 Galcode。这个手册是给第一次接触项目的人看的，不假设你熟悉 WebGAL、Node、Playwright 或 FFmpeg。照着走，先跑起来；跑起来之后，再慢慢研究高级玩法。

## 1. Galcode 是什么

Galcode 是一个命令行里的 WebGAL 二创创作助手。它会做这些事：

1. 和你讨论想写什么。
2. 根据本地素材索引，让 AI 生成结构化剧情。
3. 把剧情编译成 WebGAL 能读的 `start.txt`。
4. 套用 Bang Dream 手游风格的 WebGAL UI。
5. 启动真实 WebGAL 页面。
6. 自动录制成 `final.mp4`。

你不需要手写完整 WebGAL 脚本，也不需要自己一张张找素材。你的主要工作是给方向，或者干脆选择 YOLO 模式让它自己来。

## 2. 第一次启动

先进入项目目录：

```bash
cd galcode
```

安装命令：

```bash
./install.sh
```

然后准备 API 配置：

```bash
cp .env.example .env
```

打开 `.env`，填入自己的 key：

```text
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=your_api_key_here
```

注意：`.env` 是你的私人物品，不要提交，不要上传，不要发给朋友看。项目已经把 `.env` 放进 `.gitignore` 了。

现在启动：

```bash
galcode
```

如果提示找不到命令，重新打开终端；还不行就临时执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 3. 交互式 Agent 怎么玩

进入 `galcode` 后，你可以直接打一句想法：

```text
灯和爱音在雨夜排练前和解
```

也可以使用指令：

| 指令 | 什么时候用 |
| --- | --- |
| 普通文字 | 想和 Agent 聊方向、改设定、补充要求 |
| `/brainstorm <主题>` | 只想要点子，还不急着生成 |
| `/make <主题>` | 已经想好主题，直接生成作品 |
| `/yolo` | 什么都不管，让它自己写 |
| `/config` | 看看 API 和素材配置是否正常 |
| `/quit` | 退出 |

一个比较自然的使用方式是：

```text
我想写一个偏安静的短篇，灯和爱音在排练前因为歌词产生误会
/brainstorm 这个故事可以怎么收束
/make 灯和爱音在雨夜排练前和解
```

这就像先和搭档聊创意，再让它动手写初稿。

## 4. YOLO 模式

如果你不想讨论，只想直接得到一个作品：

```bash
galcode yolo --assets vendor/mygoxmujica_archive --record --out outputs/yolo-demo
```

这条命令会自动选题、生成脚本、套主题并录制视频。

如果你有主题，但不想进入交互界面：

```bash
galcode make \
  --mode yolo \
  --theme "灯和爱音在排练前和解" \
  --assets vendor/mygoxmujica_archive \
  --record \
  --out outputs/topic-demo
```

## 5. 输出文件怎么看

每次生成的作品会放到 `outputs/<作品名>/`：

```text
story.json              AI 生成的结构化剧情
game/scene/start.txt    编译后的 WebGAL 脚本
game/template/          Bang Dream 手游风格 UI 模板
final.mp4               录制得到的视频
```

如果你想检查 AI 到底写了什么，看 `story.json`。

如果你想检查 WebGAL 脚本，看 `game/scene/start.txt`。

如果你只关心最后成片，看 `final.mp4`。

## 6. 离线测试

没有 API key，或者只是想确认工具链有没有装好，可以跑离线模式：

```bash
galcode yolo --offline --assets vendor/mygoxmujica_archive --record --out outputs/offline-demo
```

离线模式不会生成真正完整的 AI 剧情，但能测试脚本编译、主题套用和录制链路。它适合当“体检模式”。

## 7. 录制和 60fps

Galcode 的目标是 60fps 录制。原因很简单：Live2D 模型即使没有显式动作，也经常有 idle 待机动画；如果采样不稳定，人物会看起来一跳一跳的。

不要把普通截图合成当成最终方案。`page.screenshot()` 一帧帧拼视频会绕开浏览器正常的视频合成链路，Live2D / WebGL 很容易出现抽动。这个模式只适合调试。

推荐录制方式是 Electron offscreen：

```bash
galcode record outputs/topic-demo --capture electron --duration 60 --fps 60 --video-out outputs/topic-demo/final.mp4
```

它会在后台创建隐藏的 Chromium 渲染窗口，从合成器拿帧，再交给 FFmpeg 编码。这个方向比 macOS / Windows 各写一套系统录屏参数更适合 Galcode。

默认录制命令已经是 60fps。你也可以显式写出来：

```bash
galcode record outputs/topic-demo --capture electron --duration 60 --fps 60 --video-out outputs/topic-demo/final.mp4
```

一般不要低于 60fps。高于 60fps 对 B 站投稿通常也没有明显收益。

如果你只是想调试，不在乎 Live2D 是否顺，可以使用截图 fallback：

```bash
galcode record outputs/topic-demo --capture screenshot --duration 10
```

如果你在 macOS 上想测试系统级录屏，可以使用：

```bash
galcode record outputs/topic-demo --capture avfoundation --duration 10
```

但这个会打开可见 Chromium，并且是 macOS 专属；Windows 和 Linux 不应该依赖这条路线。

## 8. 角色和模型怎么对应

Galcode 内置了 MyGO / Ave Mujica 的角色表，会把常见中文名、日文汉字写法和英文罗马字映射到素材路径里的 `tomori`、`anon`、`soyo`、`taki` 等角色 key。

生成时，Galcode 会把“角色 -> 可用 Live2D 模型”的清单发给 AI。编译前，它还会再检查一次：如果 AI 把爱音写成了 Tomori 的模型，Galcode 会自动替换成 Anon 对应的最佳 Live2D 模型。

## 9. 网络不稳定怎么办

不要硬 `git clone` 大仓库。用 Galcode 的下载命令：

```bash
galcode download-assets --target mygoxmujica
```

它使用支持断点续传的下载方式。中断了就重新跑一次，能接着下。

## 10. 常用维护命令

重新扫描素材：

```bash
galcode index --assets vendor/mygoxmujica_archive --out work/asset-manifest.json
```

准备 Live2D 缓存：

```bash
galcode prepare-live2d --assets vendor/mygoxmujica_archive --limit 6 --out work/asset-manifest.json
```

只录制已有工程：

```bash
galcode record outputs/topic-demo --duration 60 --video-out outputs/topic-demo/final.mp4
```

交互式配置 API：

```bash
galcode configure
```

查看帮助：

```bash
galcode --help
```

## 11. 常见问题

### `galcode` 命令不存在

先确认执行过：

```bash
./install.sh
```

然后重新打开终端。如果还是不行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 提示缺少 API key

确认 `.env` 存在，并且里面有真实的 `OPENAI_API_KEY`：

```bash
cp .env.example .env
```

不要把中文标点、奇怪空格或额外注释写进 key 里。

### 录制失败

先用离线模式检查基础链路：

```bash
galcode yolo --offline --assets vendor/mygoxmujica_archive --record --out outputs/offline-demo
```

如果错误和 WebGAL 依赖有关，按终端提示安装依赖，或者先用不录制的模式检查生成工程。

### 画面里没有 Live2D

先准备 Live2D 缓存：

```bash
galcode prepare-live2d --assets vendor/mygoxmujica_archive --limit 6
```

还要确认 WebGAL 的 Live2D runtime 文件存在。相关再分发条款比较特殊，发布整包前请看 README 里的许可证说明。

## 12. 发布前提醒

Galcode 适合个人学习、研究和非商业同人实验。代码开源不等于角色、音乐、美术、商标和 IP 获得了商业授权。

公开视频、再分发整包、商业使用前，请自己确认 BanG Dream / MyGO / Ave Mujica / Bushiroad / Craft Egg / Live2D 以及素材仓库的许可和社区规则。

写作品可以快乐一点，发作品要谨慎一点。这样比较长久。
