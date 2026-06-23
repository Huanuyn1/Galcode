# Galcode 更新计划

## v0.1.2-mcp计划

把该项目的基本功能（内录、提示词工程）包装成mcp，使其能被使用于主流agent工具。

## v0.2 — 内置 TTS（文字转语音）

让角色能够开口说话，而非仅显示文字。

### 方案

- 集成轻量级 TTS 引擎（优先考虑本地运行，可选 Edge TTS / VITS / Bert-VITS2）
- 为每个角色绑定语音模型，支持 MyGO / Ave Mujica 角色声线
- 编译阶段为每句 `line` 生成对应 `.wav` 音频文件
- WebGAL 脚本中加入 `vocal` 指令播放语音
- 录制视频时音频与 BGM 混音
- CLI 参数：`--tts <engine>` `--tts-voice-dir <path>`

### 技术选型（候选）

| 引擎 | 优点 | 缺点 |
|------|------|------|
| Edge TTS | 免费，中文自然 | 需联网 |
| VITS | 本地，可训练角色模型 | 需预训练模型 |
| Bert-VITS2 | 情感控制好 | 部署复杂 |
| Piper | 轻量，跨平台 | 中文一般 |

初期推荐 Edge TTS（零成本快速验证），后续训练角色专属 VITS 模型。

---

## v0.3 — AI 画图（封面 / 插画 / 背景）

根据剧情自动生成视觉素材，让 AI 不只能写还能"画"。

### 方案

- 接入生图 API（OpenAI DALL-E / Stable Diffusion / ComfyUI）
- 故事生成阶段，AI 在 `story.json` 中声明需要的 `illustrations`：
  - `cover`: 封面图（比例 16:9）
  - `illustrations`: 场景插画（按 scene 插入）
  - `backgrounds`: AI 生成的背景替代素材库背景
- CLI 参数：`--image-api <provider>` `--image-model <model>` `--image-style <style>`
- 生成后的图片自动编入素材索引，录制时作为 `changeBg` 使用
- 离线模式：使用内置模板或跳过

### 生图时机

```
story.json 生成完成
    │
    ├── 解析 illustrations 声明
    ├── 调用生图 API（并发批量）
    ├── 下载图片 → figure/generated/
    └── 重新编译（新背景替换旧背景）
            │
            └── 录制视频
```

---

## v0.4 — AI 生成 BGM

让 AI 根据剧情情绪选择或生成背景音乐。

### 方案

- 轻量方案：AI 从素材库中选择已有 BGM 并编排时间表（当前已支持）
- 进阶方案：接入音乐生成 API（Suno / Udio / MusicGen）
- `story.json` 的 `bgm` 数组支持 `generated: true`，编译时调用生乐 API
- 生成参数由 AI 根据场景情绪自动填写：`mood`, `tempo`, `instrument`
- CLI 参数：`--music-api <provider>` `--music-model <model>`

### 情绪映射

```
紧张/冲突 → 低音弦乐 + 快节奏
悲伤/沉默 → 钢琴独奏 + 慢板
和解/温暖 → 吉他 + 中速
日常/轻松 → 轻快流行
```

---

## 未来方向

- **多语言支持**：中 / 日 / 英 WebGAL 模板 + AI 翻译
- **交互式选项**：WebGAL 分支选项，AI 生成多结局
- **批量投稿**：一次生成多个短篇，适合系列内容
- **Web UI**：浏览器界面替代纯 CLI
- **角色 LORA 注入**：生图时保持角色外观一致

---

## 版本历史

| 版本 | 日期 | 内容 |
|------|------|------|
| v0.1.0 | 2026-06 | 基础 CLI、AI 剧本生成、Live2D 渲染、Electron 录制、BGM 混音 |
