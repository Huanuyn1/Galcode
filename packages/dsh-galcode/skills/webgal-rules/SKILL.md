---
name: webgal-rules
description: WebGAL 引擎渲染规则与 Galcode 创作风格指南 — 站位、立绘、对话、BGM 的硬约束,以及 MyGO/Ave Mujica 同人的叙事口味。
whenToUse: 设计场景结构、安排立绘站位与动作、或需要把握 MyGO/Ave Mujica 同人口味时。
---

# WebGAL 渲染规则(硬约束)

Galcode 把结构化 story JSON 编译成 WebGAL 脚本。编译产物必须遵守:

- 场景应在对话开始前设置 backgroundAssetId,可选 bgmAssetId。
- 屏幕有三个固定站位:left、center、right。每个站位同一时刻只能有一个角色。
- 要替换某个站位上的角色,先发送该站位 character='none' 的 figure 动作,再放置新角色。
- Live2D 立绘的 figure 动作必须使用 galcode://assets 里的 assetId。chara 优先写语义 acting,由程序从 directing 能力目录解析;旧包或需要复现时使用精确 motion/expression ID。
- 同一个角色不能同时出现在多个站位上。
- 动作变化必须服务潜台词、注意力或关系变化;不要按固定句数凑动作,也不要整场只用 idle。
- 台词用 line 动作,旁白用 narration 动作,戏剧停顿用 wait 动作。
- 不使用受版权保护的歌词;生成内容保持非商业同人试验的合适尺度。

# 故事设计与复核

- 先与用户把故事聊清楚,再写 direction.characterArcs 和每场 scene.direction,最后才写台词与演出。
- 每场 goal 必须可行动,obstacle 必须具体,turn 必须改变后续选择,exitState 必须被下一场继承。不要只用“铺垫/加压/揭示”标签代替实际事件。
- 阅读 galcode://characters 中每个主要角色的 profile:voice/want/defense/relationships/avoid。角色不能为了推进情节突然说出违背其防御方式的话;若要说破,必须有足够铺垫和动作线索。
- 重要台词写 subtext。复核台词字面、潜台词和 Live2D 的 gesture/expression 是否共同传达同一拍情绪,允许反差但不要互相打架。
- 正式生成后先做一次独立修订:因果、人物声音、场景间状态、重复解释和机械换动作;再调用校验器。

# 创作风格指南

- 偏好紧凑的场景和清晰的情绪转折:铺垫、加压、揭示、余味。
- MyGO 系故事常受益于笨拙的真诚、雨后初晴的松弛,以及未完全解决但向前走的结尾。
- Ave Mujica 系故事可以戏剧化、克制、锋利,但不要把角色压成单薄的单音符。
- 公开仓库不附带 Live2D SDK/运行时与官方模型素材。素材缺失时,仍然写出可编译的故事,然后告诉用户需要补哪些文件才能得到完整 Live2D 画面(见 live2d-licensing 技能)。
