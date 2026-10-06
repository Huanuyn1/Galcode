---
name: asset-conventions
description: Galcode 素材清单约定 — 素材种类、角色 key 与别名、Live2D 服装/动作命名,以及十位角色的写作笔记。选模型、选服装、写角色前查阅。
whenToUse: 从 galcode://assets 选择背景/BGM/Live2D 模型与服装时;确认角色显示名、别名或角色性格写法时。
---

# 素材清单约定

`galcode://assets` 资源给出当前素材清单(不含受版权保护的文件内容):

- `counts`:各类素材数量。
- `backgrounds` / `bgm` / `figures` / `video`:按种类分组的素材(id、fileName、relativePath、characterHint、tags)。
- `live2d`:全部可播放 Live2D 模型,含 characterKey、motions、expressions、live2dVersion(cubism2 / cubism3+)。
- `characterGuide`:角色 → 可用模型对应表,是选模型的主入口。

素材 id 是稳定散列,story JSON 里只能引用清单中真实存在的 id。

## 服装(costume)标签

同一角色有多套模型,按目录名区分服装:`默认常服`(live_default)、`2023 休闲服`(casual-2023)、`冬制服`(school_winter)、`夏制服`(school_summer)、`校服`、`生日服`、`梦祭服`、`联动服`、`打工服`、`振袖`、`sumimi 服`、`活动服`。学校场景优先制服,排练优先常服,演出优先活动服。优先选 motions/expressions 数量多的模型。

## 动作/表情命名

Cubism 2 模型的 motion 组名常带角色前缀(如 `anon_idle01`)。清单里给出的是可直接使用的完整名字,原样引用,不要自行拼接或截断。

新版 chara 包(`pack: "chara"`,Cubism 3/4)是主力资产:原生裸名(`mtn_smile01_C`、`exp_smile01`)+ 跨角色注册名(`前缀_角色/名`,如 `A05_素世/exp_smile01`)。命名规则、前缀表、情绪对照见 **live2d-directing** 技能。

## 角色表(key / 显示名 / 别名 / 写作笔记)

| key | 显示名 | 别名 | 写作笔记 |
|---|---|---|---|
| tomori | 高松灯 | 高松灯, 灯, Tomori | 轻声细语、极度真诚,被文字和细小的情绪信号吸引。适合安静的压力、脆弱的勇气,以及慢慢抵达的告白。 |
| anon | 千早爱音 | 千早爱音, 爱音, Anon | 外向、坐不住、自尊强但不浅薄。适合明亮的语气下藏着不安、道歉,或必须继续向前的戏。 |
| soyo | 长崎爽世 | 长崎爽世, 爽世, Soyo | 表面礼貌得体,对距离和掌控很谨慎。适合潜台词、优雅的回避,以及带刺的对话。 |
| taki | 椎名立希 | 椎名立希, 立希, Taki | 直率、自律、保护欲强,事情失控时容易烦躁。适合节奏感、冲突,以及务实的关心。 |
| rana | 要乐奈 | 要乐奈, 乐奈, Rana | 直觉派、话少、独立。适合作为场景里那个奇怪而清澈的音符,用一句简单的话改变情绪天气。 |
| sakiko | 丰川祥子 | 丰川祥子, 祥子, Sakiko | 正式、戏剧化,被骄傲与责任压着。适合高张力的克制、宏大感,以及精心挑选的裂缝。 |
| mutsumi | 若叶睦 | 若叶睦, 睦, Mutsumi | 安静、字面化、难以读懂,常以 understated 的方式在情绪上一锤定音。适合停顿、简单的真话,以及不安的忠诚。 |
| uika | 三角初华 | 三角初华, 初华, Uika | 温柔、面向公众,擅长抚平场面同时藏着私下的紧张。适合调停者角色和温暖但矛盾的戏。 |
| umiri | 八幡海铃 | 八幡海铃, 海铃, Umiri | 冷静、观察力强、专业,常常直接但不吵闹。适合用锐利的清晰感托住一场戏。 |
| nyamu | 祐天寺若麦 | 祐天寺若麦, 若麦, 喵梦, Nyamu | 爱玩、表演型、懂网络梗,但不只是搞笑担当。适合打破张力,或让隐藏的动机显形。 |

chara 包还带来 15 位新角色(B/C/D 组),别名与写作笔记见 `galcode://characters`,跨角色前缀表见 live2d-directing 技能:

| key | 显示名 | 组 |
|---|---|---|
| mahoro / houka / hotaru / natsume / nagi | 滨崎茉幌 / 和泉朋花 / 汐见萤 / 伊泽枣 / 琴平凪 | millsage(B01-B05) |
| arale / miyako / ritsu / nonoka / yuno | 仲町阿拉蕾 / 藤都子 / 峰月律 / 宫永野乃花 / 千石由乃 | 梦限大 MewType(C01-C05) |
| raika / yomogi / shizuku / chieri / miku | 须贺蕾叶 / 矢仓蓬咲 / 四宫宁月 / 梅里千樱梨 / 马桥心玖 | 一家 Dumb Rock!(D01-D05) |

story JSON 的 `character` / `speaker` 用显示名(如「高松灯」),校验器会按别名表归一。
