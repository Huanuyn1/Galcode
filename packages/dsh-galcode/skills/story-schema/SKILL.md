---
name: story-schema
description: Galcode story JSON 结构契约 — galcode_validate_story / galcode_compile_story 接受的完整字段格式。写或修 story JSON 前必读。
whenToUse: 编写、修改或修复 Galcode story JSON 时;调用 mcp__galcode__galcode_validate_story 或 mcp__galcode__galcode_compile_story 之前。
---

# Galcode story JSON schema

Galcode 把结构化的 story JSON 编译成 WebGAL 工程。顶层字段:

```json
{
  "title": "string,作品标题",
  "description": "string,作品简介",
  "durationSec": "number,目标总时长(秒)",
  "characters": ["string,登场角色显示名,如 高松灯"],
  "scenes": [
    {
      "id": "string,场景标识(kebab-case)",
      "title": "string,场景标题",
      "backgroundAssetId": "string,背景素材 id,来自 galcode://assets,可选",
      "bgmAssetId": "string,BGM 素材 id,来自 galcode://assets,可选",
      "actions": []
    }
  ],
  "bgm": [
    {
      "assetName": "BGM 清单里的文件名,如 s_Title.mp3",
      "startSec": 0,
      "endSec": 60,
      "volume": 0.25,
      "fadeIn": 2,
      "fadeOut": 3
    }
  ],
  "video": {
    "title": "string,投稿标题",
    "description": "string,投稿简介",
    "tags": ["string"]
  }
}
```

## actions 数组支持的四种动作

按顺序执行。每个场景建议的顺序:背景 → BGM → 角色入场(figure)→ 对话(line)/旁白(narration)→ wait 停顿。

```json
[
  {
    "type": "figure",
    "character": "角色显示名,或 none 表示清空该站位",
    "assetId": "素材 id(figure 或 live2d),character 为 none 时不需要",
    "position": "left|center|right",
    "motion": "Live2D 动作名,Live2D 模型必填",
    "expression": "Live2D 表情名,Live2D 模型必填"
  },
  { "type": "line", "speaker": "string", "text": "string", "durationSec": "number" },
  { "type": "narration", "text": "string", "durationSec": "number" },
  { "type": "wait", "durationSec": "number" }
]
```

规则:

- 每个 figure 动作必须同时带 motion 和 expression(从该模型的 motions/expressions 列表里选)。
- 移除角色:`{ "type": "figure", "character": "none", "position": "left" }`。
- 角色在同一站位切换情绪:assetId 和 position 不变,只改 motion/expression。
- BGM 数组(顶层 `bgm`)是可选的后期混音时间线:startSec/endSec 从故事开头算起,volume 建议 0.2-0.3,多条可重叠;不提供则不加音乐。
- 场景数量 3-5 个,每个场景 4-8 句台词/旁白。

## 最小完整示例

```json
{
  "title": "雨后还要继续",
  "description": "A short non-commercial fan scene about saying one true thing after avoiding many.",
  "durationSec": 60,
  "characters": ["高松灯", "千早爱音"],
  "scenes": [
    {
      "id": "rain-after",
      "title": "雨后的屋顶",
      "backgroundAssetId": "",
      "bgmAssetId": "",
      "actions": [
        { "type": "narration", "text": "雨停以后,地面把天空还给了她们。", "durationSec": 4 },
        { "type": "line", "speaker": "千早爱音", "text": "我刚刚说得太轻松了。", "durationSec": 5 },
        { "type": "line", "speaker": "高松灯", "text": "可是你没有走掉。", "durationSec": 5 },
        { "type": "wait", "durationSec": 2 },
        { "type": "line", "speaker": "千早爱音", "text": "那就再迷路一次吧。这次我会问路。", "durationSec": 6 }
      ]
    }
  ],
  "video": {
    "title": "雨后还要继续",
    "description": "Generated with Galcode.",
    "tags": ["Galcode", "WebGAL"]
  }
}
```

写完后先 `mcp__galcode__galcode_validate_story` 校验(errors 必须清零),再 `mcp__galcode__galcode_compile_story` 编译。
