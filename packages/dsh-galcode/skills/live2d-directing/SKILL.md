---
name: live2d-directing
description: chara 新版 Live2D 包(figure/chara/,Cubism 3/4)的演出指南 — 模型路径约定、原生与跨角色动作/表情命名规则、A01-D05 前缀表、情绪→动作对照。给 figure 动作选 motion/expression 前必读。
whenToUse: story JSON 中出现 pack='chara' 的 Live2D 模型,或需要为 figure 动作挑选 motion/expression、跨角色借用表情动作时。
---

# Live2D 演出指南(chara 包)

chara 包是现在的主力 Live2D 资产(Cubism 3/4,25 个主要角色 + sub_* 配角)。
素材清单里 `pack: "chara"` 的模型适用本页规则;旧包(`anon_idle01` 式命名)规则不同,不要混用。

## 模型路径约定

assetId 对应的模型路径永远是**被演出角色自己**的模型:

```
chara/<角色>/<服装>/<file>.model3.json
例:chara/爱音/school_winter_hs_1st/adv_live2d_anon_002_school_winter_hs_1st.model3.json
```

借用别人的表情/动作时**只改 -motion=/-expression= 的名字,不换模型**。

## 命名规则:原生 vs 跨角色

- **原生名(首选)**:模型自己 `motions/`、`expressions/` 里的裸名,直接写:
  `mtn_smile01_C`、`exp_smile01`。从 galcode://assets 该模型的 motions/expressions 列表里选。
- **跨角色名(借用)**:`<前缀>_<角色>/<名字>`,如 `A05_素世/exp_smile01`。
  **前缀必须完整** — 写 `素世/exp_smile01`、`阿拉蕾/…` 都找不到文件。
- **00_ 前缀**:`00_<角色>/<名>` 指"模型自己",如 `00_爱音/exp_shy03`(只在爱音自己的模型上有效)。
  与裸名等价,通常直接用裸名即可。
- 绝对不要编造名字;名字原样写入脚本,写错就静默失效。

### 前缀对照表

| 前缀 | 角色 | 组 |
|---|---|---|
| `00_` | 该模型自己的角色 | — |
| `A01_`~`A10_` | 爱音、灯、乐奈、立希、素世、睦、祥子、海玲、初华、喵梦 | MyGO!!!!! + Ave Mujica |
| `B01_`~`B05_` | 茉幌、朋花、萤、枣、凪 | millsage |
| `C01_`~`C05_` | 阿拉蕾、都子、律、野乃花、由乃 | 梦限大 MewType |
| `D01_`~`D05_` | 蕾叶、臬咲、宁月、千樱梨、心玖 | 一家 Dumb Rock! |

跨角色借用可能因模型参数差异而效果打折;优先借用 MyGO/Ave Mujica 团内(A01-A10)的动作,覆盖率最高。

## 名字的结构

- 动作:`mtn_<名><NN>_<C|L|R>` — NN 是序号(01/02…),`_C/_L/_R` 是镜头位置变体(居中/偏左/偏右)。
  站位 center 用 `_C`,left 用 `_L`,right 用 `_R` 效果最好。少数动作无镜头后缀(`mtn_idle_01`、`mtn_action_01`)。
- 表情:`exp_<名><NN>` — 如 `exp_smile01`、`exp_shy01`。

## 情绪 → 动作/表情对照(25 个主要角色全都有,跨角色借用也安全)

下表名字均为原生裸名;给别的角色借用时加前缀即可(如 `A03_乐奈/mtn_check01_L`)。

| 情绪 | motion | expression |
|---|---|---|
| 日常/平静 | `mtn_idle01_C`、`mtn_idle_01` | `exp_idle01`/`02`/`03` |
| 微笑/开心 | `mtn_smile01_C`、`mtn_smile02_C` | `exp_smile01`、`exp_smile02` |
| 得意/闪亮 | `mtn_kime01_C` | `exp_kime01`、`exp_bsmile01`¹ |
| 害羞 | (用 smile/thinking 动作搭配) | `exp_shy01`¹ |
| 悲伤 | `mtn_sad01_C` | `exp_sad01`、`exp_sad02`¹ |
| 哭泣 | `mtn_cry01_C` | `exp_cry01`、`exp_cry02`² |
| 生气 | `mtn_angry01_C` | `exp_angry01`、`exp_angry02`² |
| 惊讶 | `mtn_surprised01_C` | `exp_surprised01`、`exp_surprised02`¹ |
| 认真/严肃 | `mtn_serious01_C` | `exp_serious01`¹ |
| 思考/迷茫 | `mtn_thinking01_C` | `exp_thinking01`³ |
| 疑问 | `mtn_question01_C` | `exp_surprised01` |
| 否认/摆手 | `mtn_denial01_C` | `exp_pale01`(脸色发白) |
| 点头/同意 | `mtn_nod01_C`、`mtn_nod02_C` | `exp_smile01` |
| 确认/查看 | `mtn_check01_C` | `exp_serious01`¹ |
| 阴沉/黑化 | (用 sad/serious 动作搭配) | `exp_shadow01` |
| 慌乱/震惊 | (用 surprised 动作搭配) | `exp_pale01`、`exp_pale02`¹ |
| 道别 | `mtn_bye01_C`¹ | `exp_smile01` |
| 演奏乐器 | `mtn_play01_01`~`03`、`mtn_play02_01`~`03` | 按情绪配 |
| 摆姿势/亮相 | `mtn_action_01` | `exp_kime01` |
| 收尾/落幕 | `mtn_finish_01` | 按情绪配 |

¹ 24/25 或 23/25 角色有;² 20/25 左右;³ 16/25。缺的时候退回 01 号或同族名字。

## 完整清单

每个角色全部可用的动作/表情名(867 表情 + 1770 动作)见
`figure/chara/表情动作总表.md`(可用文件工具读取,按 `A01_爱音` 等小节检索)。
命名/前缀的维护文档见 `figure/chara/name.md`。
若这两个文件不存在(chara 包未安装),只用 galcode://assets 清单里列出的原生名,不要跨角色调用。
