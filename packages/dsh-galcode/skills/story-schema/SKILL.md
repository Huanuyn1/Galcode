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
  "durationSec": "number,创作目标总时长(秒),不代表最终录制长度",
  "characters": ["string,登场角色显示名,如 高松灯"],
  "direction": {
    "premise": "具体处境与戏剧问题",
    "characterArcs": [
      { "character": "角色名", "want": "外在目标", "need": "内在需要", "defense": "惯用防御", "change": "结尾可见变化" }
    ]
  },
  "scenes": [
    {
      "id": "string,场景标识(kebab-case)",
      "title": "string,场景标题",
      "direction": {
        "pov": "视角角色",
        "goal": "本场景可行动目标",
        "obstacle": "具体阻力",
        "turn": "信息/决定/情绪反转",
        "exitState": "带入下一场的关系与情绪状态"
      },
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
    "acting": {
      "gesture": "身体动作族,如 denial/nod/look/smile",
      "emotion": "动作与表情的共同语义回退",
      "expression": "独立面部情绪,如 shy/sad/smile",
      "gaze": "audience|left|right",
      "intensity": "low|medium|high 或 0..1",
      "allowShared": "是否允许高覆盖跨角色动作,默认 false"
    },
    "motion": "可选精确动作 ID,覆盖 acting.gesture",
    "expression": "可选精确表情 ID,覆盖 acting.expression"
  },
  { "type": "line", "speaker": "string", "text": "string", "subtext": "潜台词/真实意图,可选", "durationSec": "number,可省略由程序估算" },
  { "type": "narration", "text": "string", "subtext": "叙事目的,可选", "durationSec": "number,可省略由程序估算" },
  { "type": "wait", "durationSec": "number" }
]
```

规则:

- chara 模型优先只写 acting,由编译器从真实注册动作中解析;不提供 acting 时,motion 和 expression 仍必须同时提供。精确 ID 可用于复现,非法 ID 会在校验阶段报错。
- gesture 与 expression 可以独立组合,利用“身体否认但表情害羞”这类反差表现潜台词;动作变化必须服务剧情,不按固定次数凑动作。
- 默认只用原生动作。跨角色动作必须显式 allowShared=true,且参数覆盖率至少 75%;低于 50% 的精确引用也会报错。
- 移除角色:`{ "type": "figure", "character": "none", "position": "left" }`。
- 角色在同一站位切换情绪:assetId 和 position 不变,只改 acting 或 motion/expression。
- BGM 数组(顶层 `bgm`)可选:编译时对应音频文件会被复制到 game/bgm/,录制时按 startSec/endSec/volume/fadeIn/fadeOut 后期混音。不提供 bgm 数组则只使用场景级 bgmAssetId 配乐。
- 每句 line/narration 编译为文本演出 + 阻塞等待,实际停留取 durationSec 与文字动画所需时间的较大值;省略 durationSec 时由程序估算。顶层 durationSec 只是创作目标,`_timeline` 与 `_totalDurationSec`(内容 + 3 秒收尾)才是录制依据。
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
