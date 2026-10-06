import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { killChildTree } from "./proc.mjs";

// Cross-platform helpers.  Code is shared across macOS / Linux / Windows;
// only the launcher scripts (galcode / galcode.bat) and README differ.
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const PROJECT_ROOT = resolveProjectRoot();
process.chdir(PROJECT_ROOT);

async function extractZip(zipPath, destDir) {
  if (isWindows) {
    await run("powershell", ["-NoProfile", "-Command",
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`]);
  } else if (isMac) {
    await run("ditto", ["-x", "-k", zipPath, destDir]);
  } else {
    await run("unzip", ["-qo", zipPath, "-d", destDir]);
  }
}

async function safeRmDir(target) {
  try { await fs.rm(target, { recursive: true, force: true }); } catch {
    await run(isWindows ? "cmd" : "rm", isWindows ? ["/c","rd","/s","/q",target] : ["-rf",target]);
  }
}

const DEFAULT_ENGINE_REPO = "https://github.com/OpenWebGAL/WebGAL.git";
const DEFAULT_ARCHIVE_REPO = "https://github.com/KonshinHaoshin/mygoxmujica_archive.git";
const DEFAULT_STATIC_ARCHIVE_REPO = "https://github.com/Furinaaa-Cancan/mygo-mujica-archive.git";
const DEFAULT_MYGO_ARCHIVE_ZIP = "https://github.com/KonshinHaoshin/mygoxmujica_archive/archive/refs/heads/main.zip";
const DEFAULT_WEBGAL_MYGO_ZIP = "https://github.com/boomwwww/webgal-mygo/archive/refs/heads/main.zip";
const DEFAULT_STATIC_ARCHIVE_ZIP = "https://github.com/Furinaaa-Cancan/mygo-mujica-archive/archive/refs/heads/main.zip";
const DEFAULT_BANGDREAM_THEME_ARCHIVE = "themes/bangdream-mobile.zip";
const DEFAULT_BANGDREAM_THEME_CACHE = ".galcode/theme-cache/bangdream-mobile";
const OFFICIAL_LIVE2D_ARCHIVE_PATTERN = /mygo[_-]?avemujica|动作表情通用立绘包|通用立绘包|通用立繪包/i;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
const LIVE2D_MODEL_EXTS = [".model3.json", ".model.json"];
const LIVE2D_PART_EXTS = new Set([".moc", ".moc3", ".physics.json", ".physics3.json", ".exp.json"]);
const LIVE2D_MOTION_EXTS = [".motion3.json", ".mtn"];
const ARCHIVE_EXTS = new Set([".zip", ".rar", ".7z"]);
const LIVE2D_RUNTIME_FILES = ["live2d.min.js", "live2dcubismcore.min.js"];
const DEFAULT_ASSETS_DIR = "figure";
const CHARACTER_CATALOG = [
  { key: "tomori", displayName: "高松灯", aliases: ["高松灯", "高松", "灯", "燈", "Tomori", "Takamatsu Tomori"] },
  { key: "anon", displayName: "千早爱音", aliases: ["千早爱音", "千早愛音", "千早", "爱音", "愛音", "Anon", "Chihaya Anon"] },
  { key: "soyo", displayName: "长崎爽世", aliases: ["长崎爽世", "長崎爽世", "爽世", "素世", "Soyo", "Nagasaki Soyo"] },
  { key: "taki", displayName: "椎名立希", aliases: ["椎名立希", "立希", "Taki", "Shiina Taki"] },
  { key: "rana", displayName: "要乐奈", aliases: ["要乐奈", "要楽奈", "乐奈", "楽奈", "Rana", "Rāna", "Kaname Rana"] },
  { key: "sakiko", displayName: "丰川祥子", aliases: ["丰川祥子", "豊川祥子", "祥子", "Sakiko", "Togawa Sakiko"] },
  { key: "mutsumi", displayName: "若叶睦", aliases: ["若叶睦", "若葉睦", "睦", "Mutsumi", "Wakaba Mutsumi"] },
  { key: "uika", displayName: "三角初华", aliases: ["三角初华", "三角初華", "初华", "初華", "Uika", "Misumi Uika"] },
  { key: "umiri", displayName: "八幡海铃", aliases: ["八幡海铃", "八幡海鈴", "海铃", "海鈴", "海玲", "Umiri", "Yahata Umiri"] },
  { key: "nyamu", displayName: "祐天寺若麦", aliases: ["祐天寺若麦", "祐天寺若麥", "若麦", "若麥", "喵梦", "喵夢", "Nyamu", "Yutenji Nyamu"] },
  // millsage(chara 包 B 组)
  { key: "mahoro", displayName: "滨崎茉幌", aliases: ["滨崎茉幌", "茉幌", "Mahoro", "Hamasaki Mahoro"] },
  { key: "houka", displayName: "和泉朋花", aliases: ["和泉朋花", "朋花", "Houka", "Izumi Houka"] },
  { key: "hotaru", displayName: "汐见萤", aliases: ["汐见萤", "汐見蛍", "萤", "蛍", "Hotaru", "Shiomi Hotaru"] },
  { key: "natsume", displayName: "伊泽枣", aliases: ["伊泽枣", "伊澤棗", "枣", "棗", "Natsume", "Izawa Natsume"] },
  { key: "nagi", displayName: "琴平凪", aliases: ["琴平凪", "凪", "Nagi", "Kotohira Nagi"] },
  // 梦限大 MewType(chara 包 C 组)
  { key: "arale", displayName: "仲町阿拉蕾", aliases: ["仲町阿拉蕾", "阿拉蕾", "Arale", "Nakamachi Arale"] },
  { key: "miyako", displayName: "藤都子", aliases: ["藤都子", "都子", "Miyako", "Fuji Miyako"] },
  { key: "ritsu", displayName: "峰月律", aliases: ["峰月律", "律", "Ritsu", "Minetsuki Ritsu"] },
  { key: "nonoka", displayName: "宫永野乃花", aliases: ["宫永野乃花", "宮永野乃花", "野乃花", "Nonoka", "Miyanaga Nonoka"] },
  { key: "yuno", displayName: "千石由乃", aliases: ["千石由乃", "由乃", "Yuno", "Sengoku Yuno"] },
  // 一家 Dumb Rock!(chara 包 D 组)
  { key: "raika", displayName: "须贺蕾叶", aliases: ["须贺蕾叶", "須賀蕾葉", "蕾叶", "蕾葉", "Raika", "Suga Raika"] },
  { key: "yomogi", displayName: "矢仓蓬咲", aliases: ["矢仓蓬咲", "矢倉蓬咲", "臬咲", "蓬咲", "Yomogi", "Yakura Yomogi"] },
  { key: "shizuku", displayName: "四宫宁月", aliases: ["四宫宁月", "四宮寧月", "宁月", "寧月", "Shizuku", "Shinomiya Shizuku"] },
  { key: "chieri", displayName: "梅里千樱梨", aliases: ["梅里千樱梨", "梅里千櫻梨", "千樱梨", "千櫻梨", "Chieri", "Umezu Chieri"] },
  { key: "miku", displayName: "马桥心玖", aliases: ["马桥心玖", "馬橋心玖", "心玖", "Miku", "Mabashi Miku"] }
];

// chara 新版 Live2D 包(figure/chara/,Cubism 3/4):
// 25 个主要角色的目录名 → 角色 key。跨角色动作/表情注册名为
// `前缀_角色/名字`(如 A05_素世/exp_smile01),`00_角色/…` 指模型自己;
// 共享库在 figure/chara/共享表情动作/,模型内以 ../../ 相对路径引用。
const CHARA_SHARED_DIR = "共享表情动作";
const CHARA_PACK_DIR_KEYS = {
  "爱音": "anon", "灯": "tomori", "乐奈": "rana", "立希": "taki", "素世": "soyo",
  "睦": "mutsumi", "祥子": "sakiko", "海玲": "umiri", "初华": "uika", "喵梦": "nyamu",
  "茉幌": "mahoro", "朋花": "houka", "萤": "hotaru", "枣": "natsume", "凪": "nagi",
  "阿拉蕾": "arale", "都子": "miyako", "律": "ritsu", "野乃花": "nonoka", "由乃": "yuno",
  "蕾叶": "raika", "臬咲": "yomogi", "宁月": "shizuku", "千樱梨": "chieri", "心玖": "miku"
};
// 跨角色注册名的合法前缀:00_(自己)或 A01-A10/B01-B05/C01-C05/D01-D05。
const CHARA_SHARED_NAME_PATTERN = /^(00|[ABCD]\d{2})_[^/]+\/.+/;

// 判断路径是否位于 figure/chara/ 包内;返回包内结构信息。
function charaPackInfo(filePath) {
  const parts = String(filePath).split(path.sep);
  const idx = parts.lastIndexOf("chara");
  if (idx < 1 || parts[idx - 1] !== "figure" || parts.length <= idx + 1) return null;
  return {
    charaRoot: parts.slice(0, idx + 1).join(path.sep),
    characterDir: parts[idx + 1] || "",
    costumeDir: parts[idx + 2] || ""
  };
}

function isCharaPackModel(filePath) {
  const info = charaPackInfo(filePath);
  return Boolean(info && info.characterDir && info.characterDir !== CHARA_SHARED_DIR && info.costumeDir);
}

function charaPackCharacterKey(characterDir) {
  if (!characterDir) return "";
  if (CHARA_PACK_DIR_KEYS[characterDir]) return CHARA_PACK_DIR_KEYS[characterDir];
  if (/^sub_[\w-]+$/.test(characterDir)) return characterDir;
  return canonicalCharacterKey(characterDir);
}

function resolveProjectRoot() {
  const envRoot = process.env.GALCODE_ROOT || "";
  if (envRoot && isProjectRoot(envRoot)) return path.resolve(envRoot);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function isProjectRoot(dir) {
  return fssync.existsSync(path.join(dir, "package.json")) &&
    fssync.existsSync(path.join(dir, "bin", "galcode.js")) &&
    fssync.existsSync(path.join(dir, "src", "galcode.js"));
}

// ═══ AI 提示词（软编码）══════════════════════════════════════
// 内置中文默认值。运行时优先读取 .galcode/prompts/*.txt；
// 首次运行自动写入默认文件，之后可直接编辑文件自定义提示词。
// 删除对应的 .txt 文件即可恢复默认。
const DEFAULT_WRITER_PROMPT = [
  "你是 Galcode 引擎的 AI 编剧/导演，负责将创作讨论的结果编译为完整的 WebGAL 故事 JSON。",
  "",
  "编译系统按以下顺序执行动作：changeBg（切换背景）→ bgm（背景音乐）→ changeFigure（立绘/角色）→ line（对话）→ narration（旁白）→ wait（停顿）→ end（结束）。",
  "不要编造不存在的 WebGAL 命令，除非明确要求否则不要输出原始 .txt 脚本。",
  "",
  "=== 立绘/角色规则（极其重要，违反将导致画面异常）===",
  "",
  "【站位互斥】屏幕有三个固定站位：left（左）、center（中）、right（右）。",
  "每个站位最多只能有一个角色。同一个角色只能占据一个站位。",
  "",
  "【角色唯一性】一个角色不能同时出现在两个站位上！",
  "如果某角色已经在 left 位置，你不能再把它放到 center 或 right。",
  "必须先移除再重新放置。",
  "",
  "【首次引入】该角色在本场景中第一次出现：",
  "  { type:figure, character:'高松灯', assetId:'<tomori 模型 id>', position:'center', motion:'idle01', expression:'default' }",
  "",
  "【切换表情】同一场景、同一位置，仅更新情绪：",
  "  { type:figure, character:'高松灯', assetId:'<完全相同的 tomori 模型 id>', position:'center', motion:'cry01', expression:'cry01' }",
  "  ← assetId 和 position 与引入时保持一致，仅修改 motion 和 expression。",
  "",
  "【移除角色】角色离场，或需要把位置腾给另一个角色：",
  "  { type:figure, character:'none', position:'left' }",
  "  ← 这会清除 left 站位上的任何角色。",
  "",
  "【置换角色】如果要让 B 取代 A 的位置，必须先移除 A 再放置 B：",
  "  1) { type:figure, character:'none', position:'left' }     ← 先清除 A",
  "  2) { type:figure, character:'千早爱音', assetId:'...', position:'left', motion:'idle01', expression:'default' }  ← 再放 B",
  "",
  "核心规则：",
  "- 角色情绪变化 → figure 动作，assetId 和 position 不变，只改 motion/expression",
  "- 绝对不要在同一站位上同时摆放两个角色",
  "- 绝对不要让同一个角色出现在多个站位上",
  "- 角色的站位在整个场景中应保持一致，不要中途换位（如需换位，先移除再重新引入）",
  "",
  "=== 动作与表情（motion / expression — 极其重要）===",
  "每个 figure 动作必须同时带有 motion 和 expression。只能从角色资产指南（characterAssetGuide）里选择。",
  "",
  "【关键：禁止千篇一律的 idle01！】",
  "idle01 只是静态站立动作。从头到尾全用 idle01 会让画面完全僵死，毫无表现力。",
  "你必须根据每句台词的具体情绪，从可用动作列表中挑选最匹配的 motion。",
  "",
  "动作选择原则：",
  "- 每 2-3 句台词至少有一次 motion 变化",
  "- 情绪强烈的台词（哭泣、愤怒、大笑、惊讶）必须换对应的 motion",
  "- idle01 仅限真正的日常平淡时刻，全场景最多用 1-2 次",
  "- 一个 5-8 句台词的场景中，至少使用 3-4 种不同的 motion",
  "",
  "常见情绪 → motion / expression 对照（优先使用非 idle 的动作）：",
  "  开心/微笑：smile01 / smile01      认真/紧张：serious01 / serious01     悲伤/哭泣：cry01 / cry01",
  "  生气/不悦：angry01 / angry01      惊讶：idle01（仅此情况）/ surprised  道别：bye01 / default",
  "  思考/迷茫：nf01 / default         日常/平静：idle01 / default（尽量少用）",
  "",
  "示例 — 正确的情绪驱动动作变化（灯，4 句台词）：",
  "  引入：motion:'nf01'（迷茫不安地站着）",
  "  被质问：motion:'serious01'（紧张回应）→ 与上一句不同！",
  "  崩溃：motion:'cry01'（哭泣）→ 再次变化！",
  "  和解：motion:'smile01'（微笑）→ 情绪弧线完整！",
  "",
  "同场景中切换情绪：发送 figure 动作，assetId + position 不变，仅修改 motion + expression。",
  "",
  "=== chara 新版 Live2D 包(pack:'chara',Cubism 3/4,现在的主力资产)===",
  "角色资产指南中 pack 为 'chara' 的模型来自新版立绘包(路径形如 chara/<角色>/<服装>/…model3.json)。",
  "存在 chara 模型时优先使用,优于旧版模型(旧版动作名形如 anon_idle01;chara 包规则不同,不要混用!)。",
  "chara 模型的 motion/expression 命名规则:",
  "- 原生名(首选,推荐):该模型 motions/expressions 列表里列出的裸名,如 mtn_smile01_C、exp_smile01。",
  "  动作名后缀 _C/_L/_R 是镜头位置变体,居中演出优先选 _C。",
  "- 跨角色名(高级用法):'前缀_角色/名字',如 A05_素世/exp_smile01 表示当前角色借用素世的表情。",
  "  前缀必须完整(写 素世/exp_smile01 会找不到!)。前缀对照:00_=模型自己;",
  "  A01_爱音 A02_灯 A03_乐奈 A04_立希 A05_素世 A06_睦 A07_祥子 A08_海玲 A09_初华 A10_喵梦;",
  "  B01_茉幌 B02_朋花 B03_萤 B04_枣 B05_凪;C01_阿拉蕾 C02_都子 C03_律 C04_野乃花 C05_由乃;",
  "  D01_蕾叶 D02_臬咲 D03_宁月 D04_千樱梨 D05_心玖。",
  "  跨角色动作可能因参数差异效果打折,借用时优先选 MyGO/Ave Mujica 团内(A01-A10)的动作。",
  "- assetId 永远用角色自己的模型(借表情/动作只改名字,不换模型)。",
  "- chara 模型的 motion/expression 会原样写入脚本(不会加 anon_ 之类前缀),所以名字必须精确。",
  "- 绝对不要编造名字。原生名从角色资产指南的 motions/expressions 列表选;",
  "  完整跨角色清单见 figure/chara/表情动作总表.md(若可读取)。",
  "",
  "=== 角色服装（换装）===",
  "每个角色在角色资产指南中有多套 Live2D 模型（preferredLive2D 数组），",
  "每套对应不同服装，以 'costume' 字段标注（如「默认常服」「冬制服」「2023 休闲服」）。",
  "",
  "换装指南：",
  "- 不同场景可根据情境选择不同服装（学校→制服，排练→常服，演出→活动服）",
  "- 换装时使用目标服装的 assetId 即可（服装不同则 assetId 不同，这是允许的例外）",
  "- 同一场景内不建议频繁换装，1 套服装即可",
  "- 如果只有 1-2 个场景，选 1 套最合适的服装即可，不必强行换装",
  "- 优先选择 motions 和 expressions 数量多的模型（表情资源更丰富）",
  "",
  "=== 场景结构 ===",
  "每个场景必须包含：1) 设置背景(backgroundAssetId) 2) 设置 BGM(bgmAssetId) 3) 引入本场景所有角色 4) 对话/旁白。",
  "角色的 figure 动作必须放在该角色在本场景的第一句台词之前。",
  "不同场景使用不同背景，连续场景不要重复同一张。",
  "场景数量：3-5 个。每个场景：4-8 句台词/旁白。适当使用 wait 制造戏剧停顿。",
  "",
  "=== 内容规则 ===",
  "BGM 和背景从提供的素材清单中选取，仔细阅读文件名（多为中文）。",
  "角色必须使用角色资产指南中 characterKey 匹配的 Live2D 模型，",
  "并根据场景情境从 preferredLive2D 中挑选最合适的服装（costume 字段）。",
  "禁止包含：受版权保护的歌词、成人内容、仇恨言论、血腥暴力描写。",
  "",
  "=== BGM / 背景音乐 ===",
  "配乐的主方式是在每个场景设置 bgmAssetId（编译为 WebGAL 的 bgm 指令，由引擎播放）。",
  "此外可在故事根级添加可选的 'bgm' 数组：编译时会把对应音频文件复制到 game/bgm/ 目录，供引擎播放使用。",
  "不存在后期视频混音步骤；startSec/endSec/volume/fadeIn/fadeOut 只作为时间线信息随 story.json 保存。",
  "每条 BGM 条目格式：{ assetName:'文件名.mp3', startSec:0, endSec:180, volume:0.25, fadeIn:2, fadeOut:3 }",
  "- assetName：素材清单中 BGM 列表里的文件名（如 's_Title.mp3'），或 figure/bgm/ 目录下的实际文件名",
  "不提供 bgm 数组则只使用场景级 bgmAssetId 配乐。",
  "示例：[{ assetName:'s_Title.mp3', startSec:0, endSec:60, volume:0.25, fadeIn:2, fadeOut:3 }]",
  "",
  "仅输出 JSON，严格匹配给定的 schema，不要附带任何解释文字。"
].join("\n");

const DEFAULT_DISCUSS_PROMPT = [
  "你是 Galcode 引擎的 AI 创意导演，正在与用户协作开发一部非商业 MyGO/Ave Mujica WebGAL 同人短篇。",
  "",
  "你的职责：",
  "- 通过自然、温暖的对话帮助用户打磨故事创意",
  "- 用户提出一个主题或想法后，帮助其扩展为具体的视觉小说方案",
  "- 根据素材清单建议使用哪些角色，以及她们之间可能产生怎样的互动",
  "- 帮助设计 3-5 个场景的情绪弧线（每场景：背景 → 角色入场 → 对话）",
  "- 根据素材清单中提供的背景和 BGM 清单建议合适的场景氛围",
  "- 当有助于深化故事时，提出 1-2 个澄清性的问题",
  "- 每次回应用心、有洞察力，控制在 2-4 段",
  "- 当用户的想法已经足够清晰具体时，温柔地提醒用户输入 /generate 来生成最终脚本",
  "- 当用户提到想用某首特定 BGM 或某个背景时，主动在素材清单中查找并确认是否可用",
  "- 当讨论到场景氛围时，主动建议角色适合的服装（素材清单中每个角色有多套服装：常服、制服等）",
  "",
  "你需要掌握的技术知识：",
  "- 角色在屏幕上有三个固定站位（左/中/右），同一场景中尽量保持不变",
  "- 每个站位最多一个角色，同一个角色不能同时出现在多个站位",
  "- 如需让 B 替换 A 的位置，必须先让 A 离场（remove figure），再让 B 入场",
  "- 每场景需要：背景图 → BGM → 角色入场 → 对话/旁白",
  "- 不同场景应使用不同背景（连续场景不能重复）",
  "- 用户会给出目标总时长，请据此合理安排场景和对话的节奏",
  "- 角色有多套服装模型（常服/制服/休闲服等），不同场景可换不同服装",
  "- 角色通过 motion 来表达情绪变化（idle01/smile01/cry01/serious01/angry01/nf01 等），切勿整场只用 idle01",
  "- 素材库中 pack 为 chara 的新版模型（Cubism 3/4）是主力资产，动作名形如 mtn_smile01_C、表情名形如 exp_smile01；还支持跨角色借用（A05_素世/exp_smile01 这种 前缀_角色/名 写法），优先使用它们",
  "- 同一场景中角色可以在同一站位切换表情，但不能换位置",
  "",
  "内容边界：",
  "- 禁止受版权保护的歌词、成人内容、仇恨言论、血腥暴力",
  "- 角色性格应贴近原作风味",
  "- 保持 MyGO/Ave Mujica 的基调：克制、含蓄、音乐作为隐喻",
  "",
  "用户使用中文与你交流。请用中文回应。",
  "本阶段不要输出 JSON 或最终脚本 —— 只有当用户输入 /generate 时才进入生成阶段。"
].join("\n");

const DEFAULT_BRAINSTORM_PROMPT = [
  "你是 Galcode 引擎的创意策划。为用户的主题构思 3 个非商业 MyGO/Ave Mujica WebGAL 同人短篇方向。",
  "每个方向包含：标题(title)、一句话简介(pitch)、登场角色(characters)、情绪基调(tone)。",
  "仅输出 JSON：{\"ideas\":[{\"title\":\"...\",\"pitch\":\"...\",\"characters\":\"...\",\"tone\":\"...\"}]}",
  "禁止受版权保护的歌词、成人内容、仇恨言论、血腥暴力。"
].join("\n");

// ── 提示词加载系统 ──
// 运行时优先读取 .galcode/prompts/*.txt，首次运行自动写入默认文件。
let promptStore = null;

async function loadPrompts(flags = {}) {
  if (promptStore) return promptStore;

  const promptDir = path.resolve(flags.promptDir || ".galcode/prompts");

  async function load(name, defaultContent) {
    const filePath = path.join(promptDir, `${name}.txt`);
    try {
      const content = await fs.readFile(filePath, "utf8");
      return content.trim() || defaultContent;
    } catch {
      // 首次使用：写入默认提示词文件，方便用户发现和自定义
      await ensureDir(promptDir);
      await fs.writeFile(filePath, defaultContent, "utf8");
      return defaultContent;
    }
  }

  promptStore = {
    writer: await load("writer", DEFAULT_WRITER_PROMPT),
    discuss: await load("discuss", DEFAULT_DISCUSS_PROMPT),
    brainstorm: await load("brainstorm", DEFAULT_BRAINSTORM_PROMPT)
  };

  return promptStore;
}

function getWriterPrompt()     { return promptStore?.writer     || DEFAULT_WRITER_PROMPT; }
function getDiscussPrompt()    { return promptStore?.discuss    || DEFAULT_DISCUSS_PROMPT; }
function getBrainstormPrompt() { return promptStore?.brainstorm || DEFAULT_BRAINSTORM_PROMPT; }

export async function main(argv) {
  const { command, flags, positionals } = parseArgs(argv);
  await loadDotEnv(flags.env || ".env");
  await loadLocalConfig(flags);

  if (flags.help || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  if (!command) return agentCommand(flags);

  if (command === "agent" || command === "chat" || command === "interactive") return agentCommand(flags);
  if (command === "configure") return configureCommand(flags);
  if (command === "setup") return setupRepos(flags);
  if (command === "download-assets") return downloadAssetsCommand(flags);
  if (command === "install-live2d-runtime") return installLive2DRuntimeCommand(flags, positionals);
  if (command === "prepare-live2d") return prepareLive2DCommand(flags, positionals);
  if (command === "index") return indexCommand(flags, positionals);
  if (command === "discuss") return makeCommand({ ...flags, mode: "discuss" });
  if (command === "yolo") return makeCommand({ ...flags, mode: "yolo" });
  if (command === "make") return makeCommand(flags);
  if (command === "compile") return compileCommand(flags, positionals);
  if (command === "preview") return previewCommand(flags, positionals);

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!command && !arg.startsWith("-")) {
      command = arg;
      continue;
    }
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const [key, inlineValue] = raw.split("=", 2);
      if (inlineValue !== undefined) {
        flags[toCamel(key)] = inlineValue;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[toCamel(key)] = next;
          i += 1;
        } else {
          flags[toCamel(key)] = true;
        }
      }
      continue;
    }
    positionals.push(arg);
  }

  return { command, flags, positionals };
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function printHelp() {
  console.log(`Galcode 0.1

Usage:
  galcode
  galcode agent
  galcode configure
  galcode setup --root vendor
  galcode download-assets --target mygoxmujica
  galcode install-live2d-runtime --from /path/to/live2d-sdk-lib
  galcode prepare-live2d --limit 4
  galcode index --out work/asset-manifest.json
  galcode discuss
  galcode yolo
  galcode make --mode yolo --theme "灯和爱音雨夜和解" --duration 180
  galcode compile story.json --assets work/asset-manifest.json --out outputs/story
  galcode preview outputs/story --port 3000

Modes:
  agent     Interactive AI director. Chat, brainstorm, generate, compile.
  discuss   Ask you a few creative-direction questions, then AI writes the work.
  yolo      No questions. AI chooses direction and writes the work.

AI environment:
  OPENAI_API_KEY       Required for real AI generation, or run galcode configure.
  OPENAI_MODEL         Defaults to gpt-4.1-mini.
  OPENAI_BASE_URL      Defaults to https://api.openai.com/v1.

Preview:
  galcode preview <projectDir> [--port N] [--host 127.0.0.1]
  Copies the compiled project into the WebGAL engine under vendor/ and starts
  the Vite dev server. Press Ctrl+C to stop. If engine dependencies are
  missing, run ./install.sh (install.bat on Windows) first, or pass
  --install-webgal-deps once.

Publishing:
  Add --publish-to <webgal-game-dir> to copy generated game files into a WebGAL
  game directory after compile/make.

Theming:
  By default Galcode uses the Bang Dream mobile-style WebGAL template from
  themes/bangdream-mobile.zip.
  Add --theme-dir <dir> to override, or --no-theme to disable templates.

Live2D:
  By default Galcode lazily prepares a few renderable Cubism 2/3/4 zip archives
  into .galcode/live2d-cache and mounts them under game/figure/live2d.
  Add --no-live2d to disable it, or --live2d-limit <n> to change the count.
  WebGAL also needs Live2D runtime files in public/lib:
  live2d.min.js and live2dcubismcore.min.js. Use install-live2d-runtime --from <dir>.
  Public release packages do not bundle Live2D SDK/runtime or official model assets.

Unstable network:
  Use download-assets instead of git clone. It downloads GitHub zip files with
  curl -C - so rerunning the command resumes partial downloads.
`);
}

async function configureCommand(flags) {
  const configPath = getLocalConfigPath(flags);
  const existing = await readLocalConfig(configPath);
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Galcode 配置向导");
    console.log("API key 会保存在本项目的 .galcode/config.json，默认不会提交到仓库。");
    const baseUrl = await rl.question(`OpenAI 兼容接口地址 [${existing.openaiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}]: `);
    const model = await rl.question(`模型 [${existing.openaiModel || process.env.OPENAI_MODEL || "gpt-4.1-mini"}]: `);
    const currentKey = existing.openaiApiKey || process.env.OPENAI_API_KEY || "";
    const keyPrompt = currentKey ? "API key [已存在，回车保留]: " : "API key: ";
    const apiKey = await rl.question(keyPrompt);
    const config = {
      openaiBaseUrl: baseUrl.trim() || existing.openaiBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      openaiModel: model.trim() || existing.openaiModel || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      openaiApiKey: apiKey.trim() || currentKey
    };
    if (!config.openaiApiKey) throw new Error("API key is required unless you use --offline.");
    await ensureDir(path.dirname(configPath));
    await writeJson(configPath, config);
    await fs.chmod(configPath, 0o600).catch(() => {});
    console.log(`已写入 ${configPath}`);
  } finally {
    rl.close();
  }
}

async function loadLocalConfig(flags) {
  const configPath = getLocalConfigPath(flags);
  const config = await readLocalConfig(configPath);
  if (!process.env.OPENAI_API_KEY && config.openaiApiKey) process.env.OPENAI_API_KEY = config.openaiApiKey;
  if (!process.env.OPENAI_MODEL && config.openaiModel) process.env.OPENAI_MODEL = config.openaiModel;
  if (!process.env.OPENAI_BASE_URL && config.openaiBaseUrl) process.env.OPENAI_BASE_URL = config.openaiBaseUrl;
}

async function loadDotEnv(file) {
  const envPath = path.resolve(file);
  if (!fssync.existsSync(envPath)) return;
  const text = await fs.readFile(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getLocalConfigPath(flags = {}) {
  return path.resolve(flags.config || ".galcode/config.json");
}

async function readLocalConfig(configPath) {
  try {
    return JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

async function agentCommand(flags = {}) {
  flags.assets = flags.assets || DEFAULT_ASSETS_DIR;
  flags.duration = flags.duration || 60;
  const preferences = createAgentPreferences(flags);
  await loadPrompts(flags);
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Galcode Agent");
    console.log("交互式 WebGAL 二创工作台。输入想法与 AI 讨论，用 /generate 生成 WebGAL 工程。输入 /help 查看命令。");
    console.log("");
    printAgentHelp();

    if (!process.env.OPENAI_API_KEY && !flags.offline) {
      const answer = await rl.question("还没有配置 API key。现在配置吗？[Y/n] ");
      if (!/^n/i.test(answer.trim())) {
        rl.close();
        await configureCommand(flags);
        await loadLocalConfig(flags);
        return agentCommand(flags);
      }
      flags.offline = true;
      console.log("已切换到离线 demo 模式。使用 /yolo 快速生成离线 demo。");
    }

    let discussionHistory = [];
    let discussionBrief = null;
    let discussionManifest = null;

    while (true) {
      const raw = await rl.question("\ngalcode> ");
      const line = raw.trim();
      if (!line) continue;
      if (["/quit", "/exit", "quit", "exit"].includes(line)) break;
      if (line === "/help") {
        printAgentHelp();
        continue;
      }
      if (line === "/config") {
        rl.close();
        await configureCommand(flags);
        await loadLocalConfig(flags);
        return agentCommand(flags);
      }
      if (line === "/settings" || line === "/prefs") {
        printAgentPreferences(preferences);
        continue;
      }
      if (line === "/set" || line.startsWith("/set ") || isAgentPreferenceShortcut(line)) {
        await updateAgentPreferences(rl, preferences, line);
        applyAgentPreferencesToBrief(discussionBrief, preferences);
        continue;
      }
      if (line === "/yolo") {
        discussionHistory = [];
        discussionBrief = null;
        const runFlags = flagsWithAgentPreferences(flags, preferences);
        await runAgentCreation(rl, runFlags, yoloBrief(runFlags), "yolo");
        continue;
      }
      if (line.startsWith("/brainstorm")) {
        const topic = line.replace(/^\/brainstorm\s*/i, "").trim() || await rl.question("想围绕什么主题发散？ ");
        await printBrainstormIdeas(topic, flags);
        continue;
      }
      if (line.startsWith("/make")) {
        const topic = line.replace(/^\/make\s*/i, "").trim() || await rl.question("想写什么主题？ ");
        discussionHistory = [];
        discussionBrief = await briefFromTopic(rl, flagsWithAgentPreferences(flags, preferences), topic);
        if (flags.offline) {
          console.log("离线模式下无法进行 AI 讨论。使用 /yolo 生成离线 demo。");
          continue;
        }
        discussionManifest = discussionManifest || await loadManifestForRun(flags, "work/asset-manifest.json");
        await startDiscussion(rl, flags, discussionBrief, discussionManifest, discussionHistory);
        continue;
      }
      if (line === "/generate") {
        if (!discussionHistory.length) {
          console.log("还没有讨论内容。请先输入一个主题开始讨论，或使用 /yolo 直接生成。");
          continue;
        }
        await generateFromDiscussion(rl, flags, discussionHistory, discussionBrief, discussionManifest);
        discussionHistory = [];
        discussionBrief = null;
        continue;
      }

      // 直接输入文字 → 进入/继续创意讨论
      if (flags.offline) {
        console.log("离线模式下无法进行 AI 讨论。使用 /yolo 生成离线 demo。");
        continue;
      }

      if (!discussionHistory.length) {
        // 首条消息：以此为主题初始化讨论
        discussionBrief = briefFromDirectIdea(line, preferences);
        discussionManifest = discussionManifest || await loadManifestForRun(flags, "work/asset-manifest.json");
        await startDiscussion(rl, flags, discussionBrief, discussionManifest, discussionHistory);
      } else {
        // 继续现有讨论
        await continueDiscussion(rl, flags, line, discussionHistory);
      }
    }
  } finally {
    rl.close();
  }
}

function printAgentHelp() {
  console.log([
    "命令：",
    "  直接输入想法        与 AI 导演多轮讨论，打磨你的二创故事",
    "  /brainstorm 主题    先让 AI 给 3 个二创方向",
    "  /make 主题          设定主题、角色、时长后开始讨论",
    "  /generate           根据讨论内容生成 WebGAL 工程",
    "  /yolo               跳过讨论，直接生成（AI 自由发挥）",
    "  /settings           查看直接输入想法时使用的角色、口味、时长等参数",
    "  /set duration 90    设置直接输入想法的目标时长；也支持 /set tone、/set characters、/set constraints",
    "  /时长 90            /口味 更甜一点但最后留刺；/角色 灯和爱音",
    "  /config             重新配置 API key / 模型 / Base URL",
    "  /quit               退出",
    "",
    "工作流：输入想法 → AI 与你讨论打磨 → /generate 生成 WebGAL 工程",
    "讨论过程中 AI 导演不会直接输出脚本，而是陪你反复推敲剧情。",
    "当你觉得方向清晰了，输入 /generate 生成工程，再用 galcode preview <目录> 在浏览器中预览。"
  ].join("\n"));
}

function createAgentPreferences(flags) {
  return {
    durationSec: positiveNumber(flags.durationSec || flags.duration, 60),
    characters: String(flags.characters || "让 AI 从素材库中选择 2 到 4 位角色"),
    tone: String(flags.tone || "贴近 MyGO/Ave Mujica 的纠结、克制、和解感，不崩坏人设"),
    constraints: String(flags.constraints || "非商业同人，不成人，不血腥，不使用歌词，不批量投稿")
  };
}

function flagsWithAgentPreferences(flags, preferences) {
  return {
    ...flags,
    duration: preferences.durationSec,
    durationSec: preferences.durationSec,
    characters: preferences.characters,
    tone: preferences.tone,
    constraints: preferences.constraints
  };
}

function briefFromDirectIdea(theme, preferences) {
  return {
    theme,
    characters: preferences.characters,
    tone: preferences.tone,
    durationSec: preferences.durationSec,
    constraints: preferences.constraints
  };
}

function printAgentPreferences(preferences) {
  console.log([
    "当前直接输入想法时使用的参数：",
    `  时长：${preferences.durationSec}s`,
    `  角色：${preferences.characters}`,
    `  口味：${preferences.tone}`,
    `  雷点：${preferences.constraints}`,
    "",
    "可用设置：/set duration 90、/set tone 更甜一点、/set characters 灯和爱音、/set constraints 不要刀"
  ].join("\n"));
}

function isAgentPreferenceShortcut(line) {
  return /^\/(duration|dur|time|tone|taste|characters|chars|constraints|时长|口味|情绪|角色|雷点|禁止)(\s|$)/i.test(line);
}

async function updateAgentPreferences(rl, preferences, line) {
  const parsed = parseAgentPreferenceCommand(line);
  if (!parsed.key) {
    await promptAgentPreferences(rl, preferences);
    printAgentPreferences(preferences);
    return;
  }

  const key = normalizeAgentPreferenceKey(parsed.key);
  if (!key) {
    console.log("不知道要设置哪一项。可用：duration/tone/characters/constraints。");
    return;
  }

  let value = parsed.value;
  if (!value) {
    const label = key === "duration" ? "时长秒数" : key === "tone" ? "口味/情绪" : key === "characters" ? "角色" : "雷点/禁止事项";
    value = (await rl.question(`${label}： `)).trim();
  }
  if (!value) return;

  if (key === "duration") {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration <= 0) {
      console.log("时长需要是大于 0 的数字，比如 /set duration 90。");
      return;
    }
    preferences.durationSec = Math.round(duration);
  } else if (key === "tone") {
    preferences.tone = value;
  } else if (key === "characters") {
    preferences.characters = value;
  } else if (key === "constraints") {
    preferences.constraints = value;
  }
  printAgentPreferences(preferences);
}

async function promptAgentPreferences(rl, preferences) {
  const duration = await rl.question(`目标时长秒数？当前 ${preferences.durationSec}： `);
  const characters = await rl.question(`登场角色？当前 ${preferences.characters}： `);
  const tone = await rl.question(`口味/情绪？当前 ${preferences.tone}： `);
  const constraints = await rl.question(`雷点/禁止事项？当前 ${preferences.constraints}： `);

  if (duration.trim()) {
    const next = Number(duration.trim());
    if (Number.isFinite(next) && next > 0) preferences.durationSec = Math.round(next);
    else console.log("时长不是有效数字，已保留原值。");
  }
  if (characters.trim()) preferences.characters = characters.trim();
  if (tone.trim()) preferences.tone = tone.trim();
  if (constraints.trim()) preferences.constraints = constraints.trim();
}

function parseAgentPreferenceCommand(line) {
  const trimmed = line.trim();
  const setMatch = trimmed.match(/^\/set(?:\s+(\S+))?(?:\s+([\s\S]+))?$/i);
  if (setMatch) return { key: setMatch[1] || "", value: (setMatch[2] || "").trim() };
  const shortcutMatch = trimmed.match(/^\/(\S+)(?:\s+([\s\S]+))?$/);
  return { key: shortcutMatch?.[1] || "", value: (shortcutMatch?.[2] || "").trim() };
}

function normalizeAgentPreferenceKey(key) {
  const normalized = String(key || "").toLowerCase();
  if (["duration", "dur", "time", "时长"].includes(normalized)) return "duration";
  if (["tone", "taste", "flavor", "口味", "情绪"].includes(normalized)) return "tone";
  if (["characters", "character", "chars", "角色"].includes(normalized)) return "characters";
  if (["constraints", "constraint", "limits", "ban", "雷点", "禁止"].includes(normalized)) return "constraints";
  return "";
}

function applyAgentPreferencesToBrief(brief, preferences) {
  if (!brief) return;
  brief.durationSec = preferences.durationSec;
  brief.characters = preferences.characters;
  brief.tone = preferences.tone;
  brief.constraints = preferences.constraints;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function briefFromTopic(rl, flags, topic) {
  const characters = await rl.question("登场角色？直接回车让 AI 从素材库选择： ");
  const tone = await rl.question("口味/情绪？直接回车使用克制、纠结、最后留温度： ");
  const duration = await rl.question(`目标时长秒数？默认 ${flags.duration || 60}： `);
  const constraints = await rl.question("雷点/禁止事项？直接回车使用默认安全边界： ");
  return {
    theme: topic || "MyGO/Ave Mujica 成员在排练前后重新确认彼此的位置",
    characters: characters.trim() || "让 AI 从素材库中选择 2 到 4 位角色",
    tone: tone.trim() || "贴近 MyGO/Ave Mujica 的纠结、克制、和解感，不崩坏人设",
    durationSec: Number(duration || flags.duration || 60),
    constraints: constraints.trim() || "非商业同人，不成人，不血腥，不使用歌词，不批量投稿"
  };
}

async function runAgentCreation(rl, baseFlags, brief, mode) {
  console.log("");
  console.log(`主题：${brief.theme}`);
  console.log(`角色：${brief.characters}`);
  console.log(`时长：${brief.durationSec}s`);
  const outName = await rl.question("输出目录名？直接回车自动命名： ");
  const outDir = path.resolve(outName.trim() || path.join("outputs", timestampSlug("agent")));
  const flags = {
    ...baseFlags,
    mode,
    out: outDir,
    duration: brief.durationSec
  };
  await createProjectFromBrief({ brief, mode, flags, outDir });
}

async function printBrainstormIdeas(topic, flags) {
  if (flags.offline || !process.env.OPENAI_API_KEY) {
    console.log(JSON.stringify({ ideas: fallbackBrainstormIdeas(topic) }, null, 2));
    return;
  }
  const messages = [
    {
      role: "system",
      content: getBrainstormPrompt()
    },
    {
      role: "user",
      content: JSON.stringify({ topic, count: 3 }, null, 2)
    }
  ];
  const text = await callOpenAI(messages, flags);
  console.log(JSON.stringify(parseJsonFromText(text), null, 2));
}

function fallbackBrainstormIdeas(topic) {
  const base = topic || "排练前的误会";
  return [
    {
      title: "没有说出口的前奏",
      pitch: `${base} 被压在排练前的沉默里，两个人用一小段对话把误会放轻。`,
      characters: "高松灯、千早爱音",
      tone: "克制、轻微刺痛、最后有温度"
    },
    {
      title: "调音室外的停顿",
      pitch: "门里传来调音声，门外的人还没准备好进去，于是先把心里的结说开一点。",
      characters: "AI 从素材库选择 2 到 3 人",
      tone: "日常、细腻、适合短视频"
    },
    {
      title: "下一首歌之前",
      pitch: "大家都知道答案还没出现，但决定先把下一首歌唱完。",
      characters: "MyGO / Ave Mujica 混合登场",
      tone: "有张力但不沉重"
    }
  ];
}

async function startDiscussion(rl, flags, brief, manifest, history) {
  console.log("");
  console.log(`主题：${brief.theme}`);
  console.log(`角色偏好：${brief.characters || "让 AI 从素材库选择"}`);
  console.log(`目标时长：${brief.durationSec || flags.duration || 180}s`);
  if (brief.tone) console.log(`情绪/口味：${brief.tone}`);
  console.log("");
  console.log("── 开始讨论（输入 /generate 生成工程，输入其他内容继续讨论）──");
  console.log("");

  const firstMessage = JSON.stringify({
    action: "discuss",
    brief,
    assetManifestSummary: summarizeManifest(manifest),
    characterAssetGuide: buildCharacterAssetGuide(manifest)
  }, null, 2);

  history.push({ role: "user", content: firstMessage });

  const response = await callOpenAI([
    { role: "system", content: getDiscussPrompt() },
    ...history
  ], flags, { noJson: true, temperature: 0.8 });

  history.push({ role: "assistant", content: response });
  console.log(formatAIResponse(response));
}

async function continueDiscussion(rl, flags, message, history) {
  console.log("");
  history.push({ role: "user", content: message });

  const response = await callOpenAI([
    { role: "system", content: getDiscussPrompt() },
    ...history
  ], flags, { noJson: true, temperature: 0.8 });

  history.push({ role: "assistant", content: response });
  console.log(formatAIResponse(response));
}

async function generateFromDiscussion(rl, flags, history, brief, manifest) {
  console.log("");
  const outName = await rl.question("输出目录名？直接回车自动命名： ");
  const outDir = path.resolve(outName.trim() || path.join("outputs", timestampSlug("discuss")));

  console.log("");
  console.log("正在根据讨论内容生成剧本……");
  console.log("");

  // 将讨论记录整理为抄本，供生成阶段参考
  const transcript = history
    .filter((msg) => msg.role !== "system")
    .map((msg) => {
      const prefix = msg.role === "user" ? "用户" : "AI 导演";
      return `${prefix}：${msg.content}`;
    })
    .join("\n\n---\n\n");

  const genMessages = [
    {
      role: "system",
      content: getWriterPrompt()
    },
    {
      role: "user",
      content: [
        "以下是我和 AI 导演关于一部 MyGO/Ave Mujica 同人短篇的创作讨论。",
        "请根据讨论中达成的共识，生成完整的 story JSON。",
        "",
        "=== 创作讨论 ===",
        transcript,
        "=== 讨论结束 ===",
        "",
        JSON.stringify({
          action: "generate",
          brief: brief || {},
          assetManifestSummary: summarizeManifest(manifest || emptyManifest()),
          characterAssetGuide: buildCharacterAssetGuide(manifest || emptyManifest()),
          instruction: "Synthesize the discussion above into a complete WebGAL story JSON. Include all scenes, dialogue, figure actions, backgrounds, and BGM as discussed.",
          schema: storySchema()
        }, null, 2)
      ].join("\n")
    }
  ];

  const text = await callOpenAI(genMessages, flags);
  const story = normalizeStory(parseJsonFromText(text), brief || {}, manifest || emptyManifest());

  story.meta = {
    ...(story.meta || {}),
    mode: "discuss",
    generatedAt: new Date().toISOString(),
    conversationTurns: history.filter((msg) => msg.role === "user").length
  };

  const storyPath = path.join(outDir, "story.json");
  await ensureDir(outDir);
  await writeJson(storyPath, story);
  await compileStory(story, manifest || emptyManifest(), outDir, flags);

  console.log("");
  console.log(`Galcode project ready: ${outDir}`);
  console.log(`Preview it with: galcode preview ${outDir}`);
  return { outDir, storyPath };
}

function formatAIResponse(text) {
  const separator = "─".repeat(60);
  return `\n${separator}\n${text}\n${separator}\n`;
}

async function setupRepos(flags) {
  const root = path.resolve(flags.root || "vendor");
  await ensureDir(root);
  const repos = [
    [DEFAULT_ENGINE_REPO, path.join(root, "WebGAL")],
    [DEFAULT_ARCHIVE_REPO, path.join(root, "mygoxmujica_archive")],
    [DEFAULT_STATIC_ARCHIVE_REPO, path.join(root, "mygo-mujica-archive")]
  ];

  for (const [repo, dir] of repos) {
    if (fssync.existsSync(dir)) {
      console.log(`Exists: ${dir}`);
      continue;
    }
    await run("git", ["clone", "--depth", "1", repo, dir], { cwd: root });
  }
}

async function downloadAssetsCommand(flags) {
  const target = flags.target || "mygoxmujica";
  const root = path.resolve(flags.root || "vendor");
  const downloads = path.resolve(flags.downloads || "tools/downloads");
  await ensureDir(root);
  await ensureDir(downloads);

  const configs = {
    mygoxmujica: {
      url: DEFAULT_MYGO_ARCHIVE_ZIP,
      zip: path.join(downloads, "mygoxmujica_archive-main.zip"),
      extractedDir: path.join(root, "mygoxmujica_archive-main"),
      finalDir: path.join(root, "mygoxmujica_archive")
    },
    "webgal-mygo": {
      url: DEFAULT_WEBGAL_MYGO_ZIP,
      zip: path.join(downloads, "webgal-mygo-main.zip"),
      extractedDir: path.join(root, "webgal-mygo-main"),
      finalDir: path.join(root, "webgal-mygo")
    },
    static: {
      url: DEFAULT_STATIC_ARCHIVE_ZIP,
      zip: path.join(downloads, "mygo-mujica-archive-main.zip"),
      extractedDir: path.join(root, "mygo-mujica-archive-main"),
      finalDir: path.join(root, "mygo-mujica-archive")
    }
  };

  const config = configs[target];
  if (!config) throw new Error(`Unknown target: ${target}. Use mygoxmujica, webgal-mygo, or static.`);

  if (fssync.existsSync(config.finalDir) && !flags.force) {
    console.log(`Exists: ${config.finalDir}`);
    console.log("Pass --force to re-extract after downloading.");
    return;
  }

  console.log(`Downloading with resume support: ${config.url}`);
  await run("curl", [
    "-L",
    "-C", "-",
    "--retry", String(flags.retry || 30),
    "--retry-delay", String(flags.retryDelay || 5),
    "--retry-all-errors",
    config.url,
    "-o", config.zip
  ]);

  console.log(`Downloaded: ${config.zip}`);
  console.log(`Extracting to ${root}`);
  let preservedLive2D = "";
  try {
    if (target === "webgal-mygo") preservedLive2D = await preserveLive2DRuntimeFiles(config.finalDir);
    if (fssync.existsSync(config.extractedDir)) {
      await fs.rm(config.extractedDir, { recursive: true, force: true });
    }
    if (fssync.existsSync(config.finalDir)) {
      await fs.rm(config.finalDir, { recursive: true, force: true });
    }
    await extractZip(config.zip, root);
    await replaceDirectorySafely(config.extractedDir, config.finalDir);
    await restoreLive2DRuntimeFiles(preservedLive2D, config.finalDir);
    preservedLive2D = "";
  } finally {
    if (preservedLive2D) await fs.rm(preservedLive2D, { recursive: true, force: true }).catch(() => {});
  }
  console.log(`Ready: ${config.finalDir}`);
}

async function installLive2DRuntimeCommand(flags, positionals) {
  const sourceArg = flags.from || flags.live2dRuntimeDir || positionals[0];
  if (!sourceArg) {
    throw new Error("Pass --from <dir> containing live2d.min.js and live2dcubismcore.min.js.");
  }
  const webgalDir = path.resolve(flags.webgalDir || "vendor/webgal-mygo/packages/webgal");
  const copied = await copyLive2DRuntime(path.resolve(sourceArg), webgalDir);
  console.log(`Installed Live2D runtime into ${path.join(webgalDir, "public", "lib")}`);
  for (const file of copied) console.log(`- ${file}`);
}

async function indexCommand(flags, positionals) {
  const roots = [];
  if (flags.assets) roots.push(flags.assets);
  roots.push(...positionals);
  if (roots.length === 0) throw new Error("Pass --assets <dir> or one or more asset directories.");

  const manifest = await buildAssetManifest(roots.map((root) => path.resolve(root)));
  const out = path.resolve(flags.out || "work/asset-manifest.json");
  await ensureDir(path.dirname(out));
  await writeJson(out, manifest);
  console.log(`Indexed ${manifest.assets.length} assets into ${out}`);
  console.log(`background=${manifest.counts.background}, figure=${manifest.counts.figure}, bgm=${manifest.counts.bgm}, voice=${manifest.counts.voice}, video=${manifest.counts.video}, live2d=${manifest.counts.live2d}, live2dMotion=${manifest.counts.live2dMotion}, live2dPart=${manifest.counts.live2dPart}, live2dArchive=${manifest.counts.live2dArchive}, archive=${manifest.counts.archive}, misc=${manifest.counts.misc}`);
}

async function prepareLive2DCommand(flags, positionals) {
  const roots = [];
  if (flags.assets) roots.push(flags.assets);
  roots.push(...positionals);
  if (roots.length === 0) throw new Error("Pass --assets <dir> or one or more asset directories.");

  const manifest = await buildAssetManifest(roots.map((root) => path.resolve(root)));
  const prepared = await prepareLive2DAssets(manifest, flags, {
    theme: flags.theme || "",
    characters: flags.characters || ""
  });
  const out = path.resolve(flags.out || "work/asset-manifest.json");
  await writeJson(out, prepared);
  console.log(`Prepared Live2D cache and wrote ${out}`);
  console.log(`live2d=${prepared.counts.live2d}, live2dMotion=${prepared.counts.live2dMotion}, live2dArchive=${prepared.counts.live2dArchive}`);
}

async function makeCommand(flags) {
  const mode = flags.mode || "discuss";
  if (!["discuss", "yolo"].includes(mode)) {
    throw new Error("--mode must be discuss or yolo");
  }

  await loadPrompts(flags);
  const outDir = path.resolve(flags.out || path.join("outputs", timestampSlug(mode)));
  const brief = mode === "discuss" ? await askCreativeBrief(flags) : yoloBrief(flags);
  await createProjectFromBrief({ brief, mode, flags, outDir });

  // 生成完成后自动进入交互讨论模式，方便迭代验证
  console.log("");
  console.log("── 进入迭代讨论模式 ──");
  console.log(`刚才生成的工程在：${outDir}`);
  console.log("可以继续讨论修改方向，输入 /generate 重新生成。");
  flags.lastOutDir = outDir;
  return agentCommand(flags);
}

async function createProjectFromBrief({ brief, mode, flags, outDir }) {
  await ensureDir(outDir);
  const manifestPath = path.resolve(flags.manifest || path.join(outDir, "asset-manifest.json"));
  let manifest = await loadManifestForRun(flags, manifestPath);
  manifest = await prepareLive2DAssets(manifest, flags, brief);
  await writeJson(manifestPath, manifest);
  const story = await generateStory({ brief, manifest, flags, mode });
  story.meta = {
    ...(story.meta || {}),
    mode,
    generatedAt: new Date().toISOString(),
    manifestPath
  };

  const storyPath = path.join(outDir, "story.json");
  await writeJson(storyPath, story);
  await compileStory(story, manifest, outDir, flags);

  console.log(`Galcode project ready: ${outDir}`);
  console.log(`Preview it with: galcode preview ${outDir}`);
  return { outDir, storyPath, manifestPath };
}

async function loadManifestForRun(flags, manifestPath) {
  if (flags.assets) {
    const roots = [path.resolve(flags.assets)];
    const figureDir = path.resolve(flags.figureDir || "figure");
    if (fssync.existsSync(figureDir) && !roots.some((r) => r === figureDir)) {
      roots.push(figureDir);
    }
    const manifest = await buildAssetManifest(roots);
    await writeJson(manifestPath, manifest);
    return manifest;
  }
  if (fssync.existsSync(manifestPath)) {
    return JSON.parse(await fs.readFile(manifestPath, "utf8"));
  }
  if (fssync.existsSync("work/asset-manifest.json")) {
    return JSON.parse(await fs.readFile("work/asset-manifest.json", "utf8"));
  }
  const defaultAssets = path.resolve(DEFAULT_ASSETS_DIR);
  if (fssync.existsSync(defaultAssets)) {
    const manifest = await buildAssetManifest([defaultAssets]);
    await writeJson(manifestPath, manifest);
    return manifest;
  }
  const manifest = emptyManifest();
  await writeJson(manifestPath, manifest);
  return manifest;
}

async function compileCommand(flags, positionals) {
  const storyPath = positionals[0] || flags.story;
  if (!storyPath) throw new Error("Pass a story JSON file.");
  const manifestPath = flags.assets || flags.manifest || "work/asset-manifest.json";
  const outDir = path.resolve(flags.out || path.join("outputs", path.basename(storyPath, path.extname(storyPath))));
  const story = JSON.parse(await fs.readFile(path.resolve(storyPath), "utf8"));
  let manifest = fssync.existsSync(manifestPath) ? JSON.parse(await fs.readFile(manifestPath, "utf8")) : emptyManifest();
  manifest = await prepareLive2DAssets(manifest, flags, { theme: story.title, characters: (story.characters || []).join(" ") });
  await compileStory(story, manifest, outDir, flags);
  console.log(`Compiled WebGAL project: ${outDir}`);
}

async function askCreativeBrief(flags) {
  if (flags.theme) {
    return {
      theme: flags.theme,
      durationSec: Number(flags.duration || 180),
      characters: flags.characters || "让 AI 从素材库中选择",
      tone: flags.tone || "贴近 MyGO/Ave Mujica 的纠结、克制、和解感",
      constraints: flags.constraints || "非商业同人，不成人，不血腥，不批量投稿"
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    const theme = await rl.question("想写什么方向/梗/情绪？ ");
    const characters = await rl.question("想让哪些角色登场？留空让 AI 选： ");
    const tone = await rl.question("想要什么口味？沉重/搞笑/和解/怪文书？ ");
    const duration = await rl.question("目标时长秒数？默认 180： ");
    const constraints = await rl.question("有什么雷点或禁止事项？ ");
    return {
      theme: theme || "MyGO 成员在一次排练前后重新确认彼此的位置",
      characters: characters || "让 AI 从素材库中选择",
      tone: tone || "克制、带一点刺痛，最后留一点温度",
      durationSec: Number(duration || 180),
      constraints: constraints || "非商业同人，不成人，不血腥，不批量投稿"
    };
  } finally {
    rl.close();
  }
}

function yoloBrief(flags) {
  return {
    theme: flags.theme || "AI 自选一个 MyGO/Ave Mujica 二创短篇：误会、沉默、音乐和笨拙的和解",
    characters: flags.characters || "AI 从素材库中选择 2 到 4 位角色",
    tone: flags.tone || "有张力但不崩坏人设，适合 B 站短视频观看",
    durationSec: Number(flags.duration || 180),
    constraints: flags.constraints || "非商业同人，不成人，不血腥，不使用仇恨或攻击性内容"
  };
}

async function generateStory({ brief, manifest, flags, mode }) {
  if (flags.offline) {
    return offlineStory(brief, manifest);
  }

  if (!process.env.OPENAI_API_KEY) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log("还没有配置 API key。你可以输入 key 继续，或直接回车使用离线 demo。");
      const apiKey = await rl.question("API key: ");
      if (!apiKey.trim()) return offlineStory(brief, manifest);
      const configPath = getLocalConfigPath(flags);
      const config = {
        ...(await readLocalConfig(configPath)),
        openaiApiKey: apiKey.trim(),
        openaiModel: process.env.OPENAI_MODEL || flags.model || "gpt-4.1-mini",
        openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
      };
      await writeJson(configPath, config);
      await fs.chmod(configPath, 0o600).catch(() => {});
      process.env.OPENAI_API_KEY = config.openaiApiKey;
      process.env.OPENAI_MODEL = config.openaiModel;
      process.env.OPENAI_BASE_URL = config.openaiBaseUrl;
    } finally {
      rl.close();
    }
  }

  const messages = [
    {
      role: "system",
      content: getWriterPrompt()
    },
    {
      role: "user",
      content: JSON.stringify({
        mode,
        brief,
        assetManifestSummary: summarizeManifest(manifest),
        characterAssetGuide: buildCharacterAssetGuide(manifest),
        schema: storySchema()
      }, null, 2)
    }
  ];

  const text = await callOpenAI(messages, flags);
  return normalizeStory(parseJsonFromText(text), brief, manifest);
}

async function callOpenAI(messages, flags, options = {}) {
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = flags.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? Number(process.env.OPENAI_TEMPERATURE || 1),
        ...(options.noJson ? {} : { response_format: { type: "json_object" } }),
        ...(options.noJson ? {} : { max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 16384) })
      })
    });
  } catch (err) {
    throw new Error(
      `Cannot reach ${baseUrl}\n` +
      `Error: ${err.message}\n` +
      `Check OPENAI_BASE_URL in .env and your network connection.`
    );
  }

  if (!response.ok) {
    throw new Error(`AI request failed ${response.status}: ${await response.text()}`);
  }
  const json = await response.json();
  return json.choices?.[0]?.message?.content || "";
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("AI did not return JSON.");
}

function storySchema() {
  return {
    title: "string",
    description: "string",
    durationSec: "number",
    characters: ["string"],
    scenes: [
      {
        id: "string",
        title: "string",
        backgroundAssetId: "asset id from manifest, optional",
        bgmAssetId: "asset id from manifest, optional",
        actions: [
          { type: "figure", character: "string", assetId: "asset id from manifest, may be figure or live2d", position: "left|center|right", motion: "Live2D motion name (REQUIRED; chara pack: native like mtn_smile01_C, or cross-character like A05_素世/mtn_smile01_C)", expression: "Live2D expression name (REQUIRED; chara pack: native like exp_smile01, or cross-character like A05_素世/exp_smile01)" },
          { type: "line", speaker: "string", text: "string", durationSec: "number" },
          { type: "narration", text: "string", durationSec: "number" },
          { type: "wait", durationSec: "number" }
        ]
      }
    ],
    video: {
      title: "string",
      description: "string",
      tags: ["string"]
    }
  };
}

function normalizeStory(story, brief, manifest) {
  const normalized = {
    title: String(story.title || "Galcode 自动二创"),
    description: String(story.description || brief.theme),
    durationSec: Number(story.durationSec || brief.durationSec || 180),
    characters: Array.isArray(story.characters) ? story.characters.map(String) : [],
    scenes: Array.isArray(story.scenes) ? story.scenes : [],
    video: story.video || {},
    bgm: Array.isArray(story.bgm) ? story.bgm : []
  };

  if (normalized.scenes.length === 0) {
    return offlineStory(brief, manifest);
  }

  for (const scene of normalized.scenes) {
    scene.id = scene.id || slug(scene.title || "scene");
    scene.title = scene.title || scene.id;
    scene.actions = Array.isArray(scene.actions) ? scene.actions : [];
  }
  repairStoryCharacterAssets(normalized, manifest);
  return normalized;
}

function offlineStory(brief, manifest) {
  const background = selectBackground(manifest);
  const bgms = manifest.assets.filter((asset) => asset.kind === "bgm");
  const names = brief.characters && !brief.characters.includes("AI") ? brief.characters.split(/[、,\s]+/).filter(Boolean) : ["高松灯", "千早爱音"];
  const figures = selectPlayableLive2D(manifest, Math.max(3, names.length), names);
  const fallbackFigures = manifest.assets.filter((asset) => asset.kind === "figure").slice(0, 3);
  const stageFigures = figures.length > 0 ? figures : fallbackFigures;
  const totalDur = brief.durationSec || 180;

  // Build BGM timetable: for now, a single track fading in at start and out at end.
  const bgmTrack = bgms[0] ? {
    assetName: bgms[0].fileName,
    assetPath: bgms[0].path,
    startSec: 0,
    endSec: totalDur,
    volume: 0.25,
    fadeIn: 2,
    fadeOut: 3
  } : null;

  return {
    title: "迷路前的停顿",
    description: brief.theme,
    durationSec: brief.durationSec || 180,
    characters: names,
    scenes: [
      {
        id: "opening",
        title: "排练室外",
        backgroundAssetId: background?.id,
        bgmAssetId: bgms[0]?.id,
        actions: [
          { type: "figure", character: names[0] || "高松灯", assetId: stageFigures[0]?.id, position: "left", motion: stageFigures[0]?.defaultMotion || "idle01", expression: "default" },
          { type: "figure", character: names[1] || "千早爱音", assetId: stageFigures[1]?.id, position: "right", motion: stageFigures[1]?.defaultMotion || "idle01", expression: "default" },
          { type: "narration", text: "排练开始前，走廊的灯比平时暗一点。", durationSec: 3 },
          { type: "line", speaker: names[0] || "高松灯", text: "我刚才一直在想，大家是不是都在等一个不会说出口的答案。", durationSec: 5 },
          { type: "line", speaker: names[1] || "千早爱音", text: "那种答案，一说出口就会变得很重吧。", durationSec: 4 },
          { type: "wait", durationSec: 1 },
          { type: "figure", character: names[0] || "高松灯", assetId: stageFigures[0]?.id, position: "left", motion: "cry01", expression: "cry01" },
          { type: "line", speaker: names[0] || "高松灯", text: "可是，不说的话，也会一直留在那里。", durationSec: 4 },
          { type: "figure", character: names[1] || "千早爱音", assetId: stageFigures[1]?.id, position: "right", motion: "smile01", expression: "smile01" },
          { type: "line", speaker: names[1] || "千早爱音", text: "那今天就先留一点点。留到下一首歌开始之前。", durationSec: 5 },
          { type: "narration", text: "门内传来调音的声音。没有人催促她们。", durationSec: 4 }
        ].filter(Boolean).filter((a) => !("assetId" in a) || a.assetId)
      }
    ],
    video: {
      title: "【Galcode】迷路前的停顿",
      description: "由 Galcode 自动生成的非商业 WebGAL 同人短篇。",
      tags: ["MyGO", "AveMujica", "WebGAL", "Galcode"]
    },
    bgm: bgmTrack ? [bgmTrack] : []
  };
}

function selectBackground(manifest) {
  return manifest.assets
    .filter((asset) => asset.kind === "background")
    .map((asset) => ({ asset, score: scoreBackground(asset) }))
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))[0]?.asset || null;
}

function scoreBackground(asset) {
  const rel = (asset.relativePath || "").toLowerCase();
  let score = 0;
  if (/(^|\/)背景(\/|$)/i.test(rel)) score += 100;
  if (/走廊|排练|排練|练习|練習|房间|房間|会议室|會議室|舞台|学校|學校|教室|大厅|大廳|街|家|室|廊/i.test(rel)) score += 25;
  if (/\.(jpg|jpeg|webp)$/i.test(rel)) score += 8;
  if (/webgal_mano|angle\d+|arm|head|body|hair|face|mouth|eyes|cheeks|shadow|facial|hand|leg/i.test(rel)) score -= 200;
  return score;
}

function selectPlayableLive2D(manifest, limit = 3, characterNames = []) {
  const candidates = manifest.assets
    .filter((asset) => asset.kind === "live2d" && isPlayableLive2D(asset))
    .map((asset) => ({ asset, score: scorePlayableLive2D(asset) }))
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
  const selected = [];

  for (const name of characterNames) {
    const pattern = live2DCharacterPattern(name);
    if (!pattern) continue;
    const matched = candidates.find((entry) => !selected.includes(entry.asset) && pattern.test(live2DSearchText(entry.asset)));
    if (matched) selected.push(matched.asset);
  }

  for (const entry of candidates) {
    if (selected.length >= limit) break;
    if (!selected.includes(entry.asset)) selected.push(entry.asset);
  }
  return selected.slice(0, limit);
}

function selectBestLive2DForCharacter(manifest, characterKey) {
  return manifest.assets
    .filter((asset) => asset.kind === "live2d" && isPlayableLive2D(asset) && inferAssetCharacterKey(asset) === characterKey)
    .map((asset) => ({ asset, score: scorePlayableLive2D(asset) }))
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))[0]?.asset || null;
}

function isPlayableLive2D(asset) {
  if (asset.isCompositePart) return false;
  const rel = asset.relativePath || "";
  if (/(^|\/)\.mtn_exp(\/|$)/i.test(rel)) return false;
  return true;
}

function scorePlayableLive2D(asset) {
  const rel = asset.relativePath || "";
  const text = `${asset.id} ${asset.name} ${rel}`;
  let score = 0;
  if (OFFICIAL_LIVE2D_ARCHIVE_PATTERN.test(text)) score += 100;
  // chara 包是主力资产:存在时优先于旧包
  if (asset.pack === "chara") score += 120;
  if (/(^|\/)live_default(\/|$)/i.test(rel)) score += 36;
  if (/(^|\/)casual-2023(\/|$)/i.test(rel)) score += 30;
  if (/(^|\/)(school_winter-2023|school_summer-2023)(\/|$)/i.test(rel)) score += 22;
  if (/(^|\/)(anon|tomori|soyo|taki|rana|sakiko|mutsumi|uika|umiri|nyamu)(\/|$)/i.test(rel)) score += 18;
  if (/birthday|collabo|dream_festival|event|arbeit|sumimi|furisode/i.test(rel)) score -= 6;
  if (asset.motions?.length) score += Math.min(asset.motions.length, 20);
  if (asset.expressions?.length) score += Math.min(asset.expressions.length, 12);
  return score;
}

function live2DCharacterPattern(name) {
  const key = canonicalCharacterKey(name);
  if (!key) return null;
  const aliases = CHARACTER_CATALOG.find((item) => item.key === key)?.aliases || [];
  const escaped = [key, ...aliases].map((item) => escapeRegExp(String(item).toLowerCase()));
  return new RegExp(`(^|/|-)(${escaped.join("|")})(/|-)|${escaped.join("|")}`, "i");
}

function live2DSearchText(asset) {
  return `${asset.id} ${asset.relativePath || ""} ${asset.characterHint || ""} ${asset.name || ""}`;
}

function canonicalCharacterKey(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  // chara 包配角目录(sub_*):目录名即 key,原样返回。
  // 必须先于目录别名匹配,否则 sub_mikus_mother 之类会被 "miku"(心玖)抢中。
  const subMatch = text.match(/(?:^|[\s/\\|-])(sub_[a-z0-9_]+)/);
  if (subMatch) return subMatch[1];
  for (const character of CHARACTER_CATALOG) {
    if (text.includes(character.key)) return character.key;
    for (const alias of character.aliases) {
      if (text.includes(String(alias).toLowerCase())) return character.key;
    }
  }
  return "";
}

function characterDisplayName(key) {
  return CHARACTER_CATALOG.find((character) => character.key === key)?.displayName || key || "";
}

function costumeLabel(relativePath = "") {
  // 从路径中提取服装信息，返回中文标签，帮助 LLM 区分不同模型
  const lower = relativePath.toLowerCase();
  if (/live_default|^default(\/|$)/i.test(lower)) return "默认常服";
  if (/casual-2023/i.test(lower)) return "2023 休闲服";
  if (/school_winter/i.test(lower)) return "冬制服";
  if (/school_summer/i.test(lower)) return "夏制服";
  if (/school(?!_)/i.test(lower)) return "校服";
  if (/birthday/i.test(lower)) return "生日服";
  if (/dream_festival/i.test(lower)) return "梦祭服";
  if (/collabo/i.test(lower)) return "联动服";
  if (/arbeit|打工/i.test(lower)) return "打工服";
  if (/furisode|振袖/i.test(lower)) return "振袖";
  if (/sumimi/i.test(lower)) return "sumimi 服";
  if (/event/i.test(lower)) return "活动服";
  // chara 包服装目录命名
  if (/casual_spring/i.test(lower)) return "春日便服";
  if (/roomwear/i.test(lower)) return "居家服";
  if (/(^|\/|_)live(_\d+|\/|$)/i.test(lower)) return "演出服";
  if (/_still(\/|$)/i.test(lower)) return "静态立绘";
  // 回退：取路径中倒数第二段作为标识
  const parts = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].toLowerCase();
    if (!CHARACTER_CATALOG.some((c) => c.key === part) && part !== "mygo" && part !== "figure" && part !== "mujica" && part !== "chara" && !part.endsWith(".json")) {
      return part.replace(/[_-]/g, " ");
    }
  }
  return "未知";
}

function inferAssetCharacterKey(asset) {
  return asset?.characterKey
    || inferLive2DCharacterKey(asset?.relativePath || "")
    || canonicalCharacterKey(`${asset?.characterHint || ""} ${asset?.name || ""} ${asset?.fileName || ""} ${asset?.relativePath || ""}`);
}

function buildCharacterAssetGuide(manifest) {
  return CHARACTER_CATALOG
    .map((character) => {
      const live2d = manifest.assets
        .filter((asset) => asset.kind === "live2d" && isPlayableLive2D(asset) && inferAssetCharacterKey(asset) === character.key)
        .map((asset) => ({ asset, score: scorePlayableLive2D(asset) }))
        .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
        .slice(0, 5)
        .map(({ asset }) => ({
          id: asset.id,
          characterKey: character.key,
          displayName: character.displayName,
          name: asset.name,
          relativePath: asset.relativePath,
          pack: asset.pack || "",                          // 'chara' = 新版 Cubism 3/4 立绘包
          costume: costumeLabel(asset.relativePath),          // 中文服装标签
          costumeDir: path.dirname(asset.relativePath).split(path.sep).pop() || "",  // 原始目录名
          defaultMotion: asset.defaultMotion,
          defaultExpression: asset.defaultExpression,
          motions: filterShortNames(asset.motions || [], character.key).slice(0, 10),
          expressions: filterShortNames(asset.expressions || [], character.key).slice(0, 10),
          ...(asset.pack === "chara" ? {
            sharedMotions: asset.sharedMotions || 0,
            sharedExpressions: asset.sharedExpressions || 0
          } : {})
        }));
      const hasChara = live2d.some((item) => item.pack === "chara");
      return {
        characterKey: character.key,
        displayName: character.displayName,
        aliases: character.aliases,
        ...(hasChara ? {
          charaSharedNote: "chara 包模型支持跨角色动作/表情:名字写成 前缀_角色/名(如 A05_素世/exp_smile01),前缀必须完整;00_<自己角色>/名 也可指自己;motions/expressions 列表里的是原生裸名;完整清单见 figure/chara/表情动作总表.md"
        } : {}),
        preferredLive2D: live2d
      };
    })
    .filter((entry) => entry.preferredLive2D.length > 0);
}

function prefixMotionName(name, characterKey) {
  // Convert short motion name "idle01" to character-prefixed "anon_idle01"
  // as required by Cubism 2.1 model.json motion group names.
  if (!name || !characterKey) return name || "";
  // Already has a known character prefix? Return as-is
  const lower = name.toLowerCase();
  for (const c of CHARACTER_CATALOG) {
    if (lower.startsWith(c.key + '_') || lower.startsWith(c.key + '/')) return name;
  }
  // Check if already has some prefix
  const sep = lower.indexOf('_');
  if (sep > 0) {
    const prefix = lower.slice(0, sep);
    if (CHARACTER_CATALOG.some(c => c.key === prefix)) return name;
  }
  // Add character prefix
  return characterKey + '_' + name;
}

function filterShortNames(names, characterKey) {
  // Keep only names that match THIS character (prefixed like "anon_idle01").
  // The model.json motion group names use character_motion format.
  // Short names like "idle01" alone won't match the Cubism group name.
  if (!characterKey) return (names || []).slice(0, 20);
  const prefixes = [characterKey];
  // Also include aliases
  const char = CHARACTER_CATALOG.find(c => c.key === characterKey);
  if (char) {
    for (const alias of char.aliases) {
      prefixes.push(String(alias).toLowerCase());
    }
  }
  return (names || []).filter(name => {
    const lower = name.toLowerCase();
    // Keep if starts with character key + underscore
    for (const prefix of prefixes) {
      if (lower === prefix || lower.startsWith(prefix + '_') || lower.startsWith(prefix + '/')) {
        return true;
      }
    }
    // Also keep short names without any character prefix
    const slash = lower.indexOf('/');
    const uscore = lower.indexOf('_');
    const firstSep = Math.min(
      slash < 0 ? Infinity : slash,
      uscore < 0 ? Infinity : uscore
    );
    if (firstSep === Infinity) return true; // no prefix at all
    const prefix = lower.slice(0, firstSep);
    const allKeys = CHARACTER_CATALOG.map(c => c.key);
    return !allKeys.includes(prefix); // keep only if not another character's
  });
}

function repairStoryCharacterAssets(story, manifest) {
  const assetMap = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const scene of story.scenes || []) {
    for (const action of scene.actions || []) {
      if (action?.type !== "figure") continue;
      const characterKey = canonicalCharacterKey(action.character);
      if (!characterKey) continue;
      action.character = characterDisplayName(characterKey);
      const current = assetMap.get(action.assetId);
      const currentKey = current ? inferAssetCharacterKey(current) : "";
      if (current && currentKey === characterKey) continue;
      const replacement = selectBestLive2DForCharacter(manifest, characterKey);
      if (!replacement) continue;
      action.assetId = replacement.id;
      if (replacement.pack === "chara") {
        // chara 包动作/表情名原样使用(原生裸名或 前缀_角色/名),不加旧包的角色前缀
        action.motion = action.motion || replacement.defaultMotion || "";
        action.expression = action.expression || replacement.defaultExpression || "";
      } else {
        action.motion = prefixMotionName(action.motion || replacement.defaultMotion || "", characterKey);
        action.expression = prefixMotionName(action.expression || replacement.defaultExpression || "", characterKey);
      }
    }
  }
}

async function buildAssetManifest(roots) {
  const assets = [];
  for (const root of roots) {
    if (!fssync.existsSync(root)) continue;
    await walk(root, async (file) => {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return;
      // chara 包(figure/chara/)只索引 model3.json:动作/表情/贴图/moc3 等支持
      // 文件全部通过模型的注册表引用(含 ../../共享表情动作 相对路径),索引它们
      // 只会产生数千条噪音资产。
      if (charaPackInfo(file) && !file.toLowerCase().endsWith(".model3.json")) return;
      let parsed = parseAsset(file, root);
      if (!parsed) parsed = await parsePossibleLive2DJson(file, root);
      if (parsed) assets.push(await enrichAsset(parsed));
    });
  }

  assets.sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    roots,
    counts: countAssets(assets),
    assets
  };
}

async function walk(dir, visit) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, visit);
    else await visit(full);
  }
}

function parseAsset(file, root) {
  const rel = path.relative(root, file);
  const lower = rel.toLowerCase();
  const ext = getCompoundExt(lower);
  let kind = null;
  if (IMAGE_EXTS.has(path.extname(lower))) kind = classifyImage(lower);
  if (AUDIO_EXTS.has(path.extname(lower))) kind = lower.includes("voice") || lower.includes("语音") ? "voice" : "bgm";
  if (VIDEO_EXTS.has(path.extname(lower))) kind = "video";
  if (LIVE2D_MODEL_EXTS.includes(ext)) kind = "live2d";
  if (LIVE2D_MOTION_EXTS.includes(ext)) kind = "live2dMotion";
  if (LIVE2D_PART_EXTS.has(ext)) kind = "live2dPart";
  if (ARCHIVE_EXTS.has(path.extname(lower))) kind = classifyArchive(lower);
  if (!kind) return null;

  const base = path.basename(file);
  const name = base.replace(path.extname(base), "");
  return {
    id: stableAssetId(root, rel),
    kind,
    name,
    fileName: base,
    path: file,
    relativePath: rel,
    characterHint: inferCharacter(name, rel),
    tags: inferTags(lower)
  };
}

function stableAssetId(root, rel) {
  const raw = `${path.basename(root)}-${rel}`;
  return `${slug(raw)}-${shortHash(raw)}`;
}

async function parsePossibleLive2DJson(file, root) {
  const lower = file.toLowerCase();
  if (!lower.endsWith(".json")) return null;
  const lowerBase = path.basename(lower);
  if (lower.endsWith(".exp.json") || lower.endsWith(".physics.json") || lower.endsWith(".physics3.json") || lowerBase === "physics.json" || lowerBase === "template.json") return null;
  try {
    const text = await fs.readFile(file, "utf8");
    const json = JSON.parse(text);
    const serialized = JSON.stringify(json).toLowerCase();
    const dir = path.dirname(file);
    const siblings = await fs.readdir(dir).catch(() => []);
    const hasMocSibling = siblings.some((name) => name.toLowerCase().endsWith(".moc") || name.toLowerCase().endsWith(".moc3"));
    const looksLikeModel = serialized.includes(".moc") || serialized.includes(".moc3") || serialized.includes("model") && serialized.includes("textures");
    if (!hasMocSibling && !looksLikeModel) return null;
  } catch {
    return null;
  }
  const rel = path.relative(root, file);
  const base = path.basename(file);
  return {
    id: stableAssetId(root, rel),
    kind: "live2d",
    name: base.replace(path.extname(base), ""),
    fileName: base,
    path: file,
    relativePath: rel,
    characterHint: inferCharacter(base, rel),
    tags: inferTags(rel.toLowerCase())
  };
}

function getCompoundExt(lower) {
  for (const ext of [...LIVE2D_MODEL_EXTS, ...LIVE2D_MOTION_EXTS, ...LIVE2D_PART_EXTS]) {
    if (lower.endsWith(ext)) return ext;
  }
  return path.extname(lower);
}

async function enrichAsset(asset) {
  if (asset.kind !== "live2d") return asset;
  const modelDir = path.dirname(asset.path);
  const meta = await inspectLive2DModel(asset.path, modelDir);
  const chara = isCharaPackModel(asset.path) ? charaPackInfo(asset.path) : null;
  const characterKey = chara
    ? charaPackCharacterKey(chara.characterDir)
    : inferLive2DCharacterKey(asset.relativePath);
  const enriched = {
    ...asset,
    live2dVersion: asset.relativePath.toLowerCase().endsWith(".model3.json") ? "cubism3+" : "cubism2",
    modelRoot: meta.modelRoot || modelDir,
    isCompositePart: isCompositeLive2DPart(asset.path, asset.relativePath),
    characterKey,
    characterHint: characterKey ? characterDisplayName(characterKey) : asset.characterHint,
    motions: meta.motions,
    expressions: meta.expressions,
    paramImport: meta.paramImport,
    defaultMotion: chooseMotion(meta.motions, characterKey),
    defaultExpression: chooseExpression(meta.expressions, characterKey)
  };
  if (chara) {
    enriched.pack = "chara";
    enriched.charaCharacterDir = chara.characterDir;
    enriched.charaCostumeDir = chara.costumeDir;
  }
  if (meta.sharedMotions) enriched.sharedMotions = meta.sharedMotions;
  if (meta.sharedExpressions) enriched.sharedExpressions = meta.sharedExpressions;
  if (meta.sharedPrefixBase) enriched.sharedPrefixBase = true;
  return enriched;
}

async function inspectLive2DModel(modelPath, modelDir) {
  const motions = new Set();
  const expressions = new Set();
  const isCubism3 = modelPath.toLowerCase().endsWith(".model3.json");
  let sharedMotions = 0;
  let sharedExpressions = 0;
  let sharedPrefixBase = false;
  let modelRoot = modelDir;
  let paramImport = null;

  // Cubism 3/4(chara 包):注册名带 "/" 或文件以 ".." 开头的条目指向跨角色
  // 共享库(共享表情动作/),只统计数量,不进 motions/expressions —— 清单里
  // 保留原生裸名(如 mtn_smile01_C / exp_smile01)。
  // Cubism 2(旧 mygo 包)保持原行为:名字与文件名全部计入。
  const isSharedRef = (name, file) =>
    name.includes("/") || String(file || "").replaceAll("\\", "/").startsWith("..");
  const addMotionName = (name, file) => {
    const text = String(name || "");
    if (!text) return;
    if (isSharedRef(text, file)) {
      sharedMotions += 1;
      if (CHARA_SHARED_NAME_PATTERN.test(text)) sharedPrefixBase = true;
      return;
    }
    motions.add(text);
  };
  const addExpressionName = (name, file) => {
    const text = String(name || "");
    if (!text) return;
    if (isSharedRef(text, file)) {
      sharedExpressions += 1;
      if (CHARA_SHARED_NAME_PATTERN.test(text)) sharedPrefixBase = true;
      return;
    }
    expressions.add(text);
  };

  try {
    const text = await fs.readFile(modelPath, "utf8");
    const json = JSON.parse(text);
    const importMatch = text.match(/PARAM_IMPORT__(\d+)/);
    if (importMatch) paramImport = Number(importMatch[1]);
    modelRoot = resolveLive2DModelRoot(json, modelPath, modelDir);
    const fileReferences = json.FileReferences || json;
    const motionConfig = fileReferences.Motions || json.motions || {};
    if (Array.isArray(motionConfig)) {
      for (const motion of motionConfig) {
        if (isCubism3) {
          if (motion?.name) addMotionName(motion.name, motion.file);
          else if (motion?.file) addMotionName(motionNameFromFile(motion.file), motion.file);
        } else {
          if (motion?.name) motions.add(String(motion.name));
          if (motion?.file) motions.add(motionNameFromFile(motion.file));
        }
      }
    } else {
      for (const [group, entries] of Object.entries(motionConfig)) {
        const list = Array.isArray(entries) ? entries : [];
        if (isCubism3) {
          addMotionName(group, list[0]?.File || list[0]?.file || "");
        } else {
          motions.add(String(group));
          for (const entry of list) {
            if (entry?.File) motions.add(motionNameFromFile(entry.File));
            if (entry?.file) motions.add(motionNameFromFile(entry.file));
          }
        }
      }
    }
    const expressionConfig = fileReferences.Expressions || json.expressions || [];
    for (const expression of Array.isArray(expressionConfig) ? expressionConfig : []) {
      if (isCubism3) {
        if (expression?.Name) addExpressionName(expression.Name, expression.File);
        else if (expression?.name) addExpressionName(expression.name, expression.file);
        else if (expression?.File) addExpressionName(motionNameFromFile(expression.File), expression.File);
        else if (expression?.file) addExpressionName(motionNameFromFile(expression.file), expression.file);
      } else {
        if (expression?.Name) expressions.add(String(expression.Name));
        if (expression?.name) expressions.add(String(expression.name));
        if (expression?.File) expressions.add(motionNameFromFile(expression.File));
        if (expression?.file) expressions.add(motionNameFromFile(expression.file));
      }
    }
  } catch {
    // Some community model json files are encoded oddly; fall back to sibling scan.
  }

  await walk(modelDir, async (file) => {
    const lower = file.toLowerCase();
    if (LIVE2D_MOTION_EXTS.some((ext) => lower.endsWith(ext))) motions.add(motionNameFromFile(file));
    if (lower.endsWith(".exp.json") || lower.endsWith(".exp3.json")) expressions.add(motionNameFromFile(file));
  });
  return {
    modelRoot,
    paramImport,
    motions: [...motions].filter(Boolean),
    expressions: [...expressions].filter(Boolean),
    sharedMotions,
    sharedExpressions,
    sharedPrefixBase
  };
}

function resolveLive2DModelRoot(json, modelPath, modelDir) {
  const referencedDirs = [modelDir];
  for (const value of collectStringValues(json)) {
    const normalized = value.replaceAll("\\", "/");
    if (!normalized.startsWith("../")) continue;
    const resolved = path.resolve(path.dirname(modelPath), normalized);
    referencedDirs.push(path.dirname(resolved));
  }
  let root = commonAncestor(referencedDirs);
  if (!root || root.length < path.parse(root).root.length) return modelDir;

  // Don't let shared motion/expression references (e.g. _mtn_exp for the old
  // mygo pack, or ../../共享表情动作 for the chara pack) pull modelRoot above
  // the model's own directory; shared libraries are copied separately.
  // Scope any model under figure/<pack>/<character>/<costume> to its costume
  // directory (or character level when there is no costume level).
  const rootParts = root.split(path.sep);
  const figIdx = rootParts.indexOf("figure");
  if (figIdx >= 0) {
    const figBase = rootParts.slice(0, figIdx + 1).join(path.sep);
    const relToFig = path.relative(figBase, modelDir);
    const parts = relToFig.split(path.sep).filter(Boolean);
    if (parts.length >= 2) {
      // parts[1] is <character>, parts[2] is <costume> (if present)
      const depth = parts.length >= 3 ? 3 : 2;
      root = path.join(figBase, ...parts.slice(0, depth));
    }
  }

  return root;
}

function collectStringValues(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringValues(item, out);
  }
  return out;
}

function commonAncestor(paths) {
  if (paths.length === 0) return "";
  const split = paths.map((item) => path.resolve(item).split(path.sep));
  const first = split[0];
  const common = [];
  for (let i = 0; i < first.length; i += 1) {
    if (!split.every((parts) => parts[i] === first[i])) break;
    common.push(first[i]);
  }
  if (common.length === 1 && common[0] === "") return path.sep;
  return common.join(path.sep) || path.sep;
}

function motionNameFromFile(file) {
  return path.basename(String(file))
    .replace(/\.motion3\.json$/i, "")
    .replace(/\.exp3\.json$/i, "")
    .replace(/\.exp\.json$/i, "")
    .replace(/\.mtn$/i, "");
}

function chooseMotion(motions = [], characterKey = "") {
  // preferred 需全小写:下面的 lowerMap 以 lower-case 名为键
  const preferred = ["idle", "idle01", "mtn_idle01_c", "mtn_idle01", "nf01", "smile01", "mtn_smile01_c", "serious01", "normal", "default"];
  const lowerMap = new Map(motions.map((motion) => [String(motion).toLowerCase(), motion]));
  if (characterKey) {
    for (const name of preferred) {
      const scopedName = `${characterKey}/${name}`.toLowerCase();
      if (lowerMap.has(scopedName)) return lowerMap.get(scopedName);
    }
  }
  for (const name of preferred) {
    if (lowerMap.has(name)) return lowerMap.get(name);
    const suffixMatch = motions.find((motion) => String(motion).toLowerCase().endsWith(`/${name}`));
    if (suffixMatch) return suffixMatch;
  }
  return motions[0] || "";
}

function chooseExpression(expressions = [], characterKey = "") {
  const preferred = ["default", "idle01", "exp_idle01", "smile01", "exp_smile01", "serious01", "exp_serious01", "normal"];
  const lowerMap = new Map(expressions.map((expression) => [String(expression).toLowerCase(), expression]));
  if (characterKey) {
    for (const name of preferred) {
      const scopedName = `${characterKey}/${name}`.toLowerCase();
      if (lowerMap.has(scopedName)) return lowerMap.get(scopedName);
    }
  }
  for (const name of preferred) {
    if (lowerMap.has(name)) return lowerMap.get(name);
    const suffixMatch = expressions.find((expression) => String(expression).toLowerCase().endsWith(`/${name}`));
    if (suffixMatch) return suffixMatch;
  }
  return "";
}

function inferLive2DCharacterKey(rel = "") {
  const normalized = String(rel).replaceAll("\\", "/").toLowerCase();
  // chara 包:角色目录是中文名(chara/<角色>/<服装>/…;索引根直接是 chara/ 时则是首段)。
  const segments = normalized.split("/").filter(Boolean);
  const charaIdx = segments.indexOf("chara");
  const charaDir = charaIdx >= 0 && segments.length > charaIdx + 2 ? segments[charaIdx + 1] : "";
  const key = charaPackCharacterKey(charaDir || segments[0] || "");
  if (key) return key;
  const match = normalized.match(/(?:^|\/)(tomori|anon|soyo|taki|rana|sakiko|mutsumi|uika|umiri|nyamu)(?:\/|$)/);
  return match?.[1] || canonicalCharacterKey(rel);
}

function isCompositeLive2DPart(file, rel) {
  const text = `${file} ${rel}`;
  return /头发|頭髮|手|脸|臉|身体|身體|back|front|hair|face|body|arm|leg|第一个|第一個|第二个|第二個|第三个|第三個|第四个|第四個|放置/i.test(text);
}

function classifyImage(lower) {
  if (/(^|\/)(arm[lr]?|head\d*|body|hair|face|mouth|eyes|cheeks|shadow|facial|hand|leg)(\/|[._-]|$)/i.test(lower)) return "figure";
  if (/(tachie|立绘|立牌|figure|character|角色|live2d)/i.test(lower)) return "figure";
  if (/(^|\/)背景(\/|$)|background|wallpaper|kv|screenshot|截图|场景|(?:^|[\/_.-])bg(?:[\/_.-]|$)/i.test(lower)) return "background";
  if (/(avatar|头像|logo|brand)/i.test(lower)) return "misc";
  return "figure";
}

function classifyArchive(lower) {
  if (/(live2d|l2d|model|模型|改模|动作|motion|mtn|立绘|角色)/i.test(lower)) return "live2dArchive";
  if (/(template|theme|主题|ui|engine|引擎)/i.test(lower)) return "themeArchive";
  return "archive";
}

function inferCharacter(name, rel) {
  const key = canonicalCharacterKey(`${name} ${rel}`);
  return key ? characterDisplayName(key) : "";
}

function inferTags(lower) {
  const tags = [];
  for (const tag of ["mygo", "avemujica", "mujica", "bgm", "kv", "tachie", "live2d", "background"]) {
    if (lower.includes(tag)) tags.push(tag);
  }
  return tags;
}

function countAssets(assets) {
  const counts = { background: 0, figure: 0, bgm: 0, voice: 0, video: 0, live2d: 0, live2dMotion: 0, live2dPart: 0, live2dArchive: 0, themeArchive: 0, archive: 0, misc: 0 };
  for (const asset of assets) counts[asset.kind] = (counts[asset.kind] || 0) + 1;
  return counts;
}

function emptyManifest() {
  return { version: 1, generatedAt: new Date().toISOString(), roots: [], counts: countAssets([]), assets: [] };
}

function summarizeManifest(manifest) {
  const byKind = (kind, limit) => manifest.assets
    .filter((asset) => asset.kind === kind)
    .slice(0, limit)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      fileName: asset.fileName,
      relativePath: asset.relativePath,
      characterHint: asset.characterHint,
      tags: asset.tags
    }));

  // BGM 列表：显示全部文件，LLM 可根据文件名判断氛围
  const bgmAll = manifest.assets
    .filter((asset) => asset.kind === "bgm")
    .map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      name: asset.name,
      relativePath: asset.relativePath
    }));

  // 背景列表：显示全部 + 路径层级便于 LLM 分类
  const backgroundsAll = manifest.assets
    .filter((asset) => asset.kind === "background")
    .map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      name: asset.name,
      relativePath: asset.relativePath
    }));

  const live2dAll = manifest.assets
    .filter((asset) => asset.kind === "live2d")
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      fileName: asset.fileName,
      characterHint: asset.characterHint,
      characterKey: inferAssetCharacterKey(asset),
      relativePath: asset.relativePath,
      version: asset.live2dVersion,
      pack: asset.pack || "",
      isCompositePart: Boolean(asset.isCompositePart),
      motions: (asset.motions || []).slice(0, 16),
      expressions: (asset.expressions || []).slice(0, 16),
      ...(asset.pack === "chara" ? {
        sharedMotions: asset.sharedMotions || 0,
        sharedExpressions: asset.sharedExpressions || 0
      } : {}),
      tags: asset.tags
    }));

  return {
    counts: manifest.counts,
    // 可用背景一览（全部）
    backgrounds: backgroundsAll,
    // 可用立绘（固定图，非 Live2D）
    figures: byKind("figure", 200),
    // 可用 Live2D 模型（全部可播放的，含动作/表情列表）
    live2d: live2dAll,
    // 角色 —— 模型对应表
    characterGuide: buildCharacterAssetGuide(manifest),
    // 可用背景音乐（全部，LLM 根据文件名判断风格和适用场景）
    bgm: bgmAll,
    // 可用视频素材
    video: byKind("video", 200)
  };
}

async function prepareLive2DAssets(manifest, flags = {}, brief = {}) {
  if (flags.noLive2d || flags.live2d === "false") return manifest;

  const existingLive2D = manifest.assets.filter((asset) => asset.kind === "live2d");
  const archiveAssets = manifest.assets.filter((asset) => asset.kind === "live2dArchive" && path.extname(asset.path).toLowerCase() === ".zip");
  if (archiveAssets.length === 0) return manifest;

  const limit = Math.max(0, Number(flags.live2dLimit || flags.limit || (existingLive2D.length > 0 ? 0 : 4)));
  if (limit === 0) return manifest;

  const cacheRoot = path.resolve(flags.live2dCache || ".galcode/live2d-cache");
  await ensureDir(cacheRoot);

  const candidates = [];
  for (const archive of archiveAssets) {
    const entries = await listZipEntries(archive.path).catch(() => []);
    if (!zipHasLive2DModel(entries)) continue;
    candidates.push({
      archive,
      score: scoreLive2DArchive(archive, brief, entries),
      entries
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.archive.id.localeCompare(b.archive.id));

  const selected = candidates.slice(0, limit);
  for (const candidate of selected) {
    const target = path.join(cacheRoot, candidate.archive.id);
    const marker = path.join(target, ".galcode-extracted.json");
    if (!fssync.existsSync(marker) || flags.forceLive2d) {
      await safeRmDir(target);
      await ensureDir(target);
      await extractZip(candidate.archive.path, target);
      await writeJson(marker, {
        source: candidate.archive.path,
        extractedAt: new Date().toISOString()
      });
    }
  }

  const prepared = await buildAssetManifest([cacheRoot]);
  const preparedAssets = prepared.assets.filter((asset) => ["live2d", "live2dMotion", "live2dPart"].includes(asset.kind));
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const asset of preparedAssets) byId.set(asset.id, asset);
  const assets = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...manifest,
    generatedAt: new Date().toISOString(),
    roots: [...new Set([...(manifest.roots || []), cacheRoot])],
    counts: countAssets(assets),
    assets
  };
}

function zipHasLive2DModel(entries) {
  const lowerEntries = entries.map((entry) => entry.toLowerCase());
  return lowerEntries.some((entry) => LIVE2D_MODEL_EXTS.some((ext) => entry.endsWith(ext)))
    || (lowerEntries.some((entry) => entry.endsWith(".moc") || entry.endsWith(".moc3"))
      && lowerEntries.some((entry) => entry.endsWith(".json") && !entry.endsWith(".exp.json") && !entry.endsWith(".physics.json")));
}

function scoreLive2DArchive(asset, brief, entries) {
  const text = `${asset.name} ${asset.relativePath} ${brief.theme || ""} ${brief.characters || ""}`.toLowerCase();
  let score = 0;
  if (OFFICIAL_LIVE2D_ARCHIVE_PATTERN.test(text)) score += 120;
  if (/拼好模|整合|live2d|l2d/i.test(asset.relativePath)) score += 20;
  if (/常服|校服|水手服|礼服|女仆|西装|演出服|月之森|羽丘|花咲川/i.test(asset.relativePath)) score += 10;
  if (/代餐|孩子|身体|身體|脸|臉|头|頭|手|底模|组件|非拼好模/i.test(asset.relativePath)) score -= 18;
  if (entries.some((entry) => /\/(casual-2023|school_winter-2023|school_summer-2023|live_default)\/model\.json$/i.test(entry))) score += 30;
  if (/千早|爱音|愛音|anon/i.test(text)) score += 8;
  if (/高松|灯|燈|tomori/i.test(text)) score += 8;
  if (/爽世|素世|soyo/i.test(text)) score += 6;
  if (/立希|taki/i.test(text)) score += 6;
  if (/祥子|sakiko/i.test(text)) score += 6;
  if (/睦|mutsumi/i.test(text)) score += 5;
  if (/初华|初華|uika/i.test(text)) score += 5;
  if (/海铃|海鈴|umiri/i.test(text)) score += 5;
  if (/乐奈|楽奈|rana|rāna/i.test(text)) score += 5;
  if (entries.some((entry) => entry.toLowerCase().endsWith(".model3.json"))) score += 3;
  return score;
}

async function listZipEntries(file) {
  const outputText = await collectOutput("unzip", ["-Z1", file]);
  return outputText.split(/\r?\n/).filter(Boolean);
}

async function compileStory(story, manifest, outDir, flags) {
  // Always repair character assets: maps display names to canonical keys
  // and replaces any stale asset IDs with the best available match.
  repairStoryCharacterAssets(story, manifest);

  await ensureDir(outDir);
  const gameDir = path.join(outDir, "game");
  const dirs = ["scene", "background", "figure", "bgm", "voice", "video", "animation"];
  for (const dir of dirs) await ensureDir(path.join(gameDir, dir));

  await ensureWebGALRuntimeFiles(gameDir);

  const assetMap = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const copied = new Map();
  const sceneText = [];
  sceneText.push(`; Generated by Galcode at ${new Date().toISOString()}`);
  sceneText.push(`; ${story.title}`);
  if (flags.filmMode) sceneText.push("filmMode:enable;");

  let firstScene = true;
  for (const scene of story.scenes) {
    sceneText.push("");
    sceneText.push(`; Scene: ${scene.title}`);

    // Clear all figure positions from previous scene
    if (!firstScene) {
      sceneText.push("changeFigure:none -left -next;");
      sceneText.push("changeFigure:none -right -next;");
      sceneText.push("changeFigure:none -next;");
    }
    firstScene = false;

    if (scene.backgroundAssetId) {
      const name = await copyAssetForWebGAL(assetMap.get(scene.backgroundAssetId), gameDir, "background", copied);
      if (name) sceneText.push(`changeBg:${escapeCommandValue(name)} -next;`);
    }
    if (scene.bgmAssetId) {
      const name = await copyAssetForWebGAL(assetMap.get(scene.bgmAssetId), gameDir, "bgm", copied);
      if (name) sceneText.push(`bgm:${escapeCommandValue(name)} -volume=55 -enter=1800;`);
    }

    for (const action of scene.actions || []) {
      const line = await compileAction(action, assetMap, gameDir, copied);
      if (line) sceneText.push(line);
    }
  }

  sceneText.push("bgm:none -enter=2000;");
  sceneText.push("wait:3000;");
  sceneText.push("end;");

  await fs.writeFile(path.join(gameDir, "scene", "start.txt"), `${sceneText.join("\n")}\n`, "utf8");

  // 计算实际时间线（累计各动作的 durationSec）
  let clock = 0;
  const timeline = [];
  for (const scene of story.scenes || []) {
    for (const action of scene.actions || []) {
      const dur = Number(action.durationSec || 0);
      timeline.push({ ...action, startSec: clock, endSec: clock + Math.max(0, dur) });
      clock += Math.max(0, dur);
    }
  }
  // 始终保存真实时间线时长，供预览与二次编辑参考
  story._timeline = timeline;
  story._totalDurationSec = clock + 15; // 留 15 秒缓冲（end 动画 + WebGAL 过渡）

  // Resolve and copy BGM assets into the game directory
  if (story.bgm) {
    for (const bgm of story.bgm) {
      // Resolve assetPath from assetName if not already set
      if (!bgm.assetPath || !fssync.existsSync(bgm.assetPath)) {
        const found = manifest.assets.find(
          (a) => a.kind === "bgm" && (a.fileName === bgm.assetName || a.name === bgm.assetName)
        );
        if (found) bgm.assetPath = found.path;
      }
      if (bgm.assetPath && fssync.existsSync(bgm.assetPath)) {
        const bgmTarget = path.join(gameDir, "bgm", path.basename(bgm.assetPath));
        try { await fs.copyFile(bgm.assetPath, bgmTarget); } catch {}
        bgm._copiedPath = bgmTarget;
      }
    }
  }

  const themeDir = await resolveThemeDir(flags);
  if (themeDir) await copyDir(themeDir, path.join(gameDir, "template"));

  await writeJson(path.join(outDir, "story.json"), story);
  await fs.writeFile(path.join(outDir, "title.txt"), `${story.video?.title || story.title}\n`, "utf8");
  await fs.writeFile(path.join(outDir, "description.txt"), `${story.video?.description || story.description}\n`, "utf8");
  await writePreviewHtml(outDir, story, copied, flags);
  await writeProjectReadme(outDir, story);

  if (flags.publishTo) {
    const target = path.resolve(flags.publishTo);
    await copyDir(gameDir, target);
    console.log(`Published WebGAL game files to ${target}`);
  }
}

async function compileAction(action, assetMap, gameDir, copied) {
  if (action.type === "figure") {
    // 移除角色：character 或 assetId 为 "none"
    if (!action.character || action.character === "none" || action.assetId === "none") {
      const pos = positionFlag(action.position);
      return `changeFigure:none${pos ? " " + pos : ""} -next;`.replace(/  +/g, " ");
    }
    const asset = assetMap.get(action.assetId);
    const isCharaPack = asset?.kind === "live2d" && isCharaLive2DAsset(asset);
    const name = asset?.kind === "live2d"
      ? await copyLive2DForWebGAL(asset, gameDir, copied)
      : await copyAssetForWebGAL(asset, gameDir, "figure", copied);
    if (!name) return null;
    const pos = positionFlag(action.position);
    const characterKey = canonicalCharacterKey(action.character || "");
    // chara 包的注册名(原生裸名 / 前缀_角色/名)原样写入,不做旧包的 anon_ 式前缀转换
    const motion = isCharaPack ? String(action.motion || "") : prefixMotionName(action.motion || "", characterKey);
    const expression = isCharaPack ? String(action.expression || "") : prefixMotionName(action.expression || "", characterKey);
    // WebGAL key=value params: -id=, -motion=, -expression= (WITH dash prefix)
    const motionArg = motion ? ` -motion=${escapeCommandValue(motion)}` : "";
    const expressionArg = expression ? ` -expression=${escapeCommandValue(expression)}` : "";
    const idArg = asset?.kind === "live2d" ? ` -id=${figureId(action.position)}` : "";
    const space = pos ? " " : "";
    return `changeFigure:${escapeCommandValue(name)}${space}${pos}${idArg}${motionArg}${expressionArg} -next;`.replace(/  +/g, ' ');
  }
  if (action.type === "line") {
    const speaker = cleanText(action.speaker || "");
    const text = cleanText(action.text || "");
    return `${speaker}:${text};`;
  }
  if (action.type === "narration") {
    return `:${cleanText(action.text || "")};`;
  }
  if (action.type === "wait") {
    const ms = Math.max(0, Math.round(Number(action.durationSec || 1) * 1000));
    return `wait:${ms};`;
  }
  if (action.type === "bgm") {
    const name = await copyAssetForWebGAL(assetMap.get(action.assetId), gameDir, "bgm", copied);
    return name ? `bgm:${escapeCommandValue(name)} -volume=${Number(action.volume || 55)} -enter=1200;` : null;
  }
  if (action.type === "background") {
    const name = await copyAssetForWebGAL(assetMap.get(action.assetId), gameDir, "background", copied);
    return name ? `changeBg:${escapeCommandValue(name)} -next;` : null;
  }
  return null;
}

async function resolveThemeDir(flags = {}) {
  if (flags.noTheme) return "";
  if (flags.themeDir) {
    const themeDir = path.resolve(flags.themeDir);
    if (!fssync.existsSync(themeDir)) throw new Error(`Theme directory does not exist: ${themeDir}`);
    return await findWebGALTemplateDir(themeDir) || themeDir;
  }

  const archive = path.resolve(flags.themeArchive || DEFAULT_BANGDREAM_THEME_ARCHIVE);
  if (!fssync.existsSync(archive)) {
    const fallback = path.resolve("themes/webgal-mygo");
    return fssync.existsSync(fallback) ? fallback : "";
  }

  const cacheRoot = path.resolve(flags.themeCache || DEFAULT_BANGDREAM_THEME_CACHE);
  const marker = path.join(cacheRoot, ".galcode-theme-extracted.json");
  if (!fssync.existsSync(marker) || flags.forceTheme) {
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await ensureDir(cacheRoot);
    await extractZip(archive, cacheRoot);
    await writeJson(marker, {
      source: archive,
      extractedAt: new Date().toISOString()
    });
  }

  const templateDir = await findWebGALTemplateDir(cacheRoot);
  if (!templateDir) throw new Error(`No WebGAL template.json found in theme archive: ${archive}`);
  return templateDir;
}

async function findWebGALTemplateDir(root) {
  let found = "";
  async function visit(dir) {
    if (found) return;
    const templateJson = path.join(dir, "template.json");
    const textboxScss = path.join(dir, "Stage", "TextBox", "textbox.scss");
    if (fssync.existsSync(templateJson) && fssync.existsSync(textboxScss)) {
      found = dir;
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found) break;
      if (entry.isDirectory()) await visit(path.join(dir, entry.name));
    }
  }
  await visit(root);
  return found;
}

function positionFlag(position) {
  if (position === "left") return "-left";
  if (position === "right") return "-right";
  return "";
}

function figureId(position) {
  // .jsonl aggregate model lookup needs -id to match motion/expression state
  return position === "left" ? "fig-left" : position === "right" ? "fig-right" : "fig-center";
}

async function copyAssetForWebGAL(asset, gameDir, subdir, copied) {
  if (!asset || !asset.path || !fssync.existsSync(asset.path)) return null;
  const key = `${subdir}:${asset.path}`;
  if (copied.has(key)) return copied.get(key);
  const safeName = safeFileName(asset.fileName || path.basename(asset.path));
  const target = path.join(gameDir, subdir, safeName);
  await fs.copyFile(asset.path, target);
  copied.set(key, safeName);
  return safeName;
}

function isCharaLive2DAsset(asset) {
  return asset?.kind === "live2d" && (asset.pack === "chara" || isCharaPackModel(asset.path || ""));
}

async function copyLive2DForWebGAL(asset, gameDir, copied) {
  if (!asset || !asset.path || !fssync.existsSync(asset.path)) return null;
  if (isCharaLive2DAsset(asset)) return copyCharaLive2DForWebGAL(asset, gameDir, copied);
  const modelRoot = asset.modelRoot || path.dirname(asset.path);
  const key = `live2d:${modelRoot}:${asset.path}`;
  if (copied.has(key)) return copied.get(key);

  const live2dDir = path.join(gameDir, "figure", "live2d");
  await ensureDir(live2dDir);
  const targetDirName = live2DTargetDirName(asset);
  const targetDir = path.join(live2dDir, targetDirName);
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyDir(modelRoot, targetDir);

  // Copy shared _mtn_exp to where ../../../ references from the model.json
  // will actually resolve in the target layout.
  const mtnExpInGame = path.resolve(targetDir, "..", "..", "..", "_mtn_exp");
  if (!fssync.existsSync(mtnExpInGame)) {
    // Walk up from the source model path to find _mtn_exp.
    const modelSrcDir = path.dirname(asset.path);
    for (let ups = 1; ups <= 5; ups += 1) {
      const candidate = path.resolve(modelSrcDir, ...Array(ups).fill(".."), "_mtn_exp");
      if (fssync.existsSync(candidate)) {
        await copyDir(candidate, mtnExpInGame);
        break;
      }
    }
  }

  const modelRelativePath = path.relative(modelRoot, asset.path).split(path.sep).join("/");
  const webgalPath = await writeLive2DEntryPoint(asset, targetDir, targetDirName, modelRelativePath);
  copied.set(key, webgalPath);
  copied.set(`live2d-meta:${asset.id}`, {
    id: asset.id,
    name: asset.name,
    version: asset.live2dVersion,
    model: webgalPath,
    motions: asset.motions || [],
    expressions: asset.expressions || [],
    defaultMotion: asset.defaultMotion || "",
    defaultExpression: asset.defaultExpression || ""
  });
  await writeLive2DManifest(gameDir, copied);
  return webgalPath;
}

// chara 包(figure/chara/,Cubism 3/4)不走上面的 hashed-dir 方案:
// 按原结构复制 figure/chara/<角色>/<服装>/ → game/figure/chara/<角色>/<服装>/,
// 模型内注册的 ../../共享表情动作/… 相对路径因此保持不变。
// changeFigure 的名字形如 chara/<角色>/<服装>/<file>.model3.json。
async function copyCharaLive2DForWebGAL(asset, gameDir, copied) {
  const info = charaPackInfo(asset.path);
  if (!info || !info.characterDir || !info.costumeDir) return null;
  const key = `live2d:chara:${asset.path}`;
  if (copied.has(key)) return copied.get(key);

  const modelRoot = asset.modelRoot || path.dirname(asset.path);
  const relToCharaRoot = path.relative(info.charaRoot, modelRoot).split(path.sep).join("/");
  const targetDir = path.join(gameDir, "figure", "chara", ...relToCharaRoot.split("/"));
  if (!copied.has(`live2d:chara-dir:${targetDir}`)) {
    await fs.rm(targetDir, { recursive: true, force: true });
    await copyDir(modelRoot, targetDir);
    copied.set(`live2d:chara-dir:${targetDir}`, true);
  }

  await copyCharaSharedLibrary(info.charaRoot, gameDir, copied);

  const modelRelativePath = path.relative(modelRoot, asset.path).split(path.sep).join("/");
  const webgalPath = `chara/${relToCharaRoot}/${modelRelativePath}`;
  copied.set(key, webgalPath);
  copied.set(`live2d-meta:${asset.id}`, {
    id: asset.id,
    name: asset.name,
    version: asset.live2dVersion,
    pack: "chara",
    model: webgalPath,
    motions: asset.motions || [],
    expressions: asset.expressions || [],
    defaultMotion: asset.defaultMotion || "",
    defaultExpression: asset.defaultExpression || ""
  });
  await writeLive2DManifest(gameDir, copied);
  return webgalPath;
}

// 跨角色共享库(figure/chara/共享表情动作/,约 74MB)每个工程复制一次;
// 已存在带标记文件的副本时跳过。
async function copyCharaSharedLibrary(charaRoot, gameDir, copied) {
  if (copied.has("live2d:chara-shared")) return;
  copied.set("live2d:chara-shared", true);
  const sharedSource = path.join(charaRoot, CHARA_SHARED_DIR);
  if (!fssync.existsSync(sharedSource)) return;
  const sharedTarget = path.join(gameDir, "figure", "chara", CHARA_SHARED_DIR);
  const marker = path.join(sharedTarget, ".galcode-shared-lib.json");
  if (fssync.existsSync(marker)) return;
  await copyDir(sharedSource, sharedTarget);
  await writeJson(marker, {
    source: sharedSource,
    copiedAt: new Date().toISOString()
  });
}

async function writeLive2DEntryPoint(asset, targetDir, targetDirName, modelRelativePath) {
  if (!asset.paramImport) return `live2d/${targetDirName}/${modelRelativePath}`;
  const jsonlName = "galcode-model.jsonl";
  const lines = [
    JSON.stringify({
      path: `./${modelRelativePath}`,
      x: 0,
      y: 0,
      xscale: 1,
      yscale: 1
    }),
    JSON.stringify({
      import: asset.paramImport,
      motions: asset.motions || [],
      expressions: asset.expressions || []
    })
  ];
  await fs.writeFile(path.join(targetDir, jsonlName), `${lines.join("\n")}\n`, "utf8");
  return `live2d/${targetDirName}/${jsonlName}`;
}

function live2DTargetDirName(asset) {
  const rel = (asset.relativePath || asset.id || "").split(path.sep).join("/");
  const tail = rel.split("/").filter(Boolean).slice(-4).join("-");
  const readable = slug(tail || asset.name || "live2d");
  return safeFileName(`${readable}-${shortHash(asset.id || rel)}`);
}

async function writeLive2DManifest(gameDir, copied) {
  const models = [];
  for (const [key, value] of copied.entries()) {
    if (key.startsWith("live2d-meta:")) models.push(value);
  }
  await writeJson(path.join(gameDir, "figure", "live2d", "live2d-manifest.json"), {
    generatedAt: new Date().toISOString(),
    models
  });
}

async function writePreviewHtml(outDir, story) {
  const lines = [];
  for (const scene of story.scenes) {
    for (const action of scene.actions || []) {
      if (action.type === "line" || action.type === "narration") {
        lines.push({
          speaker: action.type === "line" ? action.speaker : "",
          text: action.text,
          durationSec: Number(action.durationSec || 3)
        });
      }
    }
  }
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(story.title)}</title>
  <style>
    :root {
      --pink: #ff7eb6;
      --cyan: #54c7f2;
      --gold: #ffd46a;
      --ink: #3c4050;
      --soft: #fff7fb;
    }
    body {
      margin: 0;
      background: #eef5ff;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans SC", "PingFang SC", sans-serif;
      letter-spacing: 0;
    }
    main {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,.08)),
        radial-gradient(circle at 20% 18%, rgba(255,126,182,.35), transparent 24%),
        radial-gradient(circle at 82% 24%, rgba(84,199,242,.35), transparent 22%),
        linear-gradient(135deg, #dcecff 0%, #f8ecff 46%, #fff2df 100%);
    }
    .stage-grid {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,.32) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.32) 1px, transparent 1px);
      background-size: 64px 64px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.35), transparent 70%);
    }
    .phone-safe {
      position: absolute;
      inset: 24px 32px;
      border: 2px solid rgba(255,255,255,.45);
      border-radius: 6px;
      pointer-events: none;
    }
    .title {
      position: fixed;
      left: 34px;
      top: 26px;
      padding: 8px 18px;
      background: rgba(255,255,255,.82);
      border: 2px solid rgba(255,126,182,.48);
      border-radius: 999px;
      color: #526071;
      font-size: 18px;
      font-weight: 700;
      box-shadow: 0 8px 24px rgba(55,78,120,.12);
    }
    .character {
      position: absolute;
      bottom: 176px;
      width: 280px;
      height: 520px;
      border-radius: 48% 48% 12px 12px;
      background:
        linear-gradient(180deg, rgba(255,255,255,.85), rgba(255,255,255,.2)),
        linear-gradient(135deg, rgba(255,126,182,.78), rgba(84,199,242,.74));
      filter: drop-shadow(0 24px 30px rgba(51,62,92,.2));
      opacity: .86;
    }
    .character.left { left: 170px; transform: rotate(-2deg); }
    .character.right { right: 170px; transform: rotate(2deg) scaleX(-1); }
    .character::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 42px;
      width: 140px;
      height: 140px;
      transform: translateX(-50%);
      border-radius: 50%;
      background: rgba(255,255,255,.72);
    }
    .dialogue-wrap {
      position: absolute;
      left: 50%;
      bottom: 42px;
      width: min(1180px, calc(100vw - 72px));
      transform: translateX(-50%);
    }
    .speaker {
      position: relative;
      z-index: 2;
      display: inline-grid;
      min-width: 188px;
      min-height: 48px;
      place-items: center;
      padding: 0 28px;
      margin-left: 38px;
      margin-bottom: -8px;
      color: white;
      font-size: 24px;
      font-weight: 800;
      text-shadow: 0 2px 0 rgba(0,0,0,.12);
      background: linear-gradient(135deg, var(--pink), #ff9bcb);
      border: 3px solid white;
      border-radius: 999px;
      box-shadow: 0 8px 18px rgba(255,126,182,.35);
    }
    .box {
      position: relative;
      min-height: 136px;
      padding: 32px 44px 34px;
      background: rgba(255,255,255,.92);
      border: 4px solid white;
      border-radius: 24px;
      box-shadow:
        0 16px 36px rgba(62,83,128,.18),
        inset 0 0 0 2px rgba(84,199,242,.24);
    }
    .box::before {
      content: "";
      position: absolute;
      inset: 10px;
      border: 2px dashed rgba(255,126,182,.28);
      border-radius: 18px;
      pointer-events: none;
    }
    .text {
      position: relative;
      z-index: 1;
      min-height: 76px;
      font-size: 34px;
      line-height: 1.55;
      font-weight: 650;
    }
    .next {
      position: absolute;
      right: 34px;
      bottom: 18px;
      width: 0;
      height: 0;
      border-left: 13px solid transparent;
      border-right: 13px solid transparent;
      border-top: 18px solid var(--gold);
      filter: drop-shadow(0 2px 0 rgba(0,0,0,.12));
      animation: bounce 1.1s infinite ease-in-out;
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(6px); }
    }
  </style>
</head>
<body>
  <main>
    <div class="stage-grid"></div>
    <div class="phone-safe"></div>
    <div class="title">${htmlEscape(story.title)}</div>
    <div class="character left"></div>
    <div class="character right"></div>
    <section class="dialogue-wrap">
      <div class="speaker" id="speaker"></div>
      <div class="box">
        <div class="text" id="text"></div>
        <div class="next"></div>
      </div>
    </section>
  </main>
  <script>
    const lines = ${JSON.stringify(lines)};
    let i = 0;
    const speaker = document.getElementById("speaker");
    const text = document.getElementById("text");
    function show() {
      const line = lines[i] || { speaker: "", text: "END", durationSec: 999 };
      speaker.textContent = line.speaker || "";
      text.textContent = line.text || "";
      i += 1;
      if (i <= lines.length) setTimeout(show, Math.max(1200, line.durationSec * 1000));
    }
    show();
  </script>
</body>
</html>`;
  await fs.writeFile(path.join(outDir, "preview.html"), html, "utf8");
}

async function writeProjectReadme(outDir, story) {
  const readme = `# ${story.title}

Generated by Galcode.

- WebGAL script: \`game/scene/start.txt\`
- Story JSON: \`story.json\`
- Fallback preview: \`preview.html\`
- Suggested title: \`title.txt\`
- Suggested description: \`description.txt\`

To preview this project in the WebGAL engine:

\`\`\`bash
galcode preview ${outDir}
\`\`\`
`;
  await fs.writeFile(path.join(outDir, "README.md"), readme, "utf8");
}

async function previewCommand(flags, positionals) {
  const projectDir = path.resolve(positionals[0] || flags.project || ".");
  if (!fssync.existsSync(path.join(projectDir, "game", "scene", "start.txt"))) {
    throw new Error(`Not a compiled Galcode project: ${projectDir} (missing game/scene/start.txt — run \`galcode compile\` or \`galcode yolo\` first)`);
  }
  const { child, url } = await startWebGALPreview(projectDir, flags);
  console.log("");
  console.log(`Preview URL: ${url}`);
  console.log("在浏览器中打开以上地址预览作品。按 Ctrl+C 停止预览服务器。");
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      killChildTree(child);
      resolve();
    };
    const onSignal = () => finish();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    child.on("exit", () => finish());
  });
  console.log("WebGAL 预览服务器已停止。");
}

async function startWebGALPreview(projectDir, flags) {
  const webgalDir = path.resolve(flags.webgalDir || "vendor/webgal-mygo/packages/webgal");
  const webgalWorkspaceRoot = path.resolve(webgalDir, "..", "..");
  const publicGameDir = path.join(webgalDir, "public", "game");
  const sourceGameDir = path.join(projectDir, "game");
  const baseGameDir = await ensureWebGALBaseGame(flags);
  if (!fssync.existsSync(path.join(webgalDir, "package.json"))) {
    throw new Error(`WebGAL package not found: ${webgalDir}`);
  }
  if (!fssync.existsSync(sourceGameDir)) {
    throw new Error(`Generated game directory not found: ${sourceGameDir}`);
  }

  const hasPackageDeps = fssync.existsSync(path.join(webgalDir, "node_modules"));
  const hasWorkspaceDeps = fssync.existsSync(path.join(webgalWorkspaceRoot, "node_modules"));
  if (!hasPackageDeps && !hasWorkspaceDeps) {
    if (flags.installWebgalDeps) {
      await run("npm", ["install", "--legacy-peer-deps", "--include=dev"], { cwd: webgalWorkspaceRoot });
    } else {
      throw new Error("WebGAL dependencies are not installed. Run `install.bat` on Windows, `./install.sh` on Unix, or run `galcode preview ... --install-webgal-deps` once.");
    }
  }

  const parserDir = path.join(webgalWorkspaceRoot, "packages", "parser");
  const parserBuild = path.join(parserDir, "build", "es", "index.js");
  if (!fssync.existsSync(parserBuild) || flags.rebuildWebgalParser) {
    await run("npm", ["run", "build"], { cwd: parserDir });
  }

  await fs.rm(publicGameDir, { recursive: true, force: true });
  if (baseGameDir && fssync.existsSync(baseGameDir)) await copyDir(baseGameDir, publicGameDir);
  else await ensureDir(publicGameDir);
  await ensureWebGALRuntimeFiles(sourceGameDir);
  await copyDir(sourceGameDir, publicGameDir);
  await ensureLive2DRuntime(webgalDir, sourceGameDir, flags);
  const host = String(flags.host || "127.0.0.1");
  const port = Number(flags.port || await findOpenPort(3000));
  const npm = npmInvocation();
  // --strictPort: never let vite silently move to another port; otherwise
  // waitForUrl could bind to a stale server from a previous run.
  const npmDev = normalizeSpawnCommand(npm.command, [...npm.args, "run", "dev", "--", "--host", host, "--port", String(port), "--strictPort"]);
  const child = spawn(npmDev.command, npmDev.args, {
    cwd: webgalDir,
    stdio: flags.webgalLogs ? "inherit" : "ignore",
    env: { ...process.env, BROWSER: "none" },
    // POSIX: lead a process group so killChildTree can reach vite
    detached: !isWindows
  });
  child.on("error", () => {});
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${port}`;
  try {
    await waitForUrl(url, Number(flags.webgalTimeout || 60000));
  } catch (error) {
    killChildTree(child);
    throw error;
  }
  return { child, url };
}

async function ensureWebGALRuntimeFiles(gameDir) {
  await ensureDir(gameDir);
  await ensureDir(path.join(gameDir, "animation"));

  const configFile = path.join(gameDir, "config.txt");
  if (!fssync.existsSync(configFile)) {
    await fs.writeFile(configFile, "Game_key:galcode-demo;\n", "utf8");
  }

  const animationTable = path.join(gameDir, "animation", "animationTable.json");
  if (!fssync.existsSync(animationTable)) {
    await fs.writeFile(animationTable, "[]\n", "utf8");
  }

  const userStyleSheet = path.join(gameDir, "userStyleSheet.css");
  if (!fssync.existsSync(userStyleSheet)) {
    await fs.writeFile(userStyleSheet, "", "utf8");
  }
}

async function ensureLive2DRuntime(webgalDir, gameDir, flags = {}) {
  if (flags.live2dRuntimeDir) {
    await copyLive2DRuntime(path.resolve(flags.live2dRuntimeDir), webgalDir);
  }

  const missing = await getMissingLive2DRuntimeFiles(webgalDir);
  if (missing.length === 0) return;
  if (!await gameUsesLive2D(gameDir)) return;

  const libDir = path.join(webgalDir, "public", "lib");
  const message = [
    `Live2D runtime is missing: ${missing.join(", ")}`,
    "These files are not bundled because the Live2D SDK/runtime is copyrighted.",
    `Put ${LIVE2D_RUNTIME_FILES.join(" and ")} into ${libDir},`,
    "or run `galcode install-live2d-runtime --from <dir>` after obtaining the Live2D runtime files.",
    "Without these files WebGAL disables Live2D and the preview will not show models."
  ].join(" ");

  console.warn(message);
  return;
}

async function copyLive2DRuntime(source, webgalDir) {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new Error(`Live2D runtime source not found: ${source}`);
  const root = stat.isFile() ? path.dirname(source) : source;
  const targetDir = path.join(webgalDir, "public", "lib");
  await ensureDir(targetDir);

  const copied = [];
  for (const fileName of LIVE2D_RUNTIME_FILES) {
    const sourceFile = await findFileByName(root, fileName);
    if (!sourceFile) throw new Error(`Could not find ${fileName} under ${root}`);
    const targetFile = path.join(targetDir, fileName);
    await fs.copyFile(sourceFile, targetFile);
    copied.push(targetFile);
  }
  return copied;
}

async function getMissingLive2DRuntimeFiles(webgalDir) {
  const libDir = path.join(webgalDir, "public", "lib");
  const missing = [];
  for (const fileName of LIVE2D_RUNTIME_FILES) {
    if (!fssync.existsSync(path.join(libDir, fileName))) missing.push(fileName);
  }
  return missing;
}

async function gameUsesLive2D(gameDir) {
  if (fssync.existsSync(path.join(gameDir, "figure", "live2d"))) return true;
  const sceneDir = path.join(gameDir, "scene");
  const files = await listFiles(sceneDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(".txt")) continue;
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (/changeFigure:.*(?:live2d\/|\.jsonl|\.model3?\.json)|-(?:motion|expression)=/i.test(text)) return true;
  }
  return false;
}

async function findFileByName(root, fileName) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const current = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return current;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findFileByName(path.join(root, entry.name), fileName);
    if (found) return found;
  }
  return "";
}

async function ensureWebGALBaseGame(flags = {}) {
  const explicit = flags.webgalBaseGame ? path.resolve(flags.webgalBaseGame) : "";
  if (explicit) return explicit;
  const cached = path.resolve(".galcode/webgal-base/webgal-mygo-main/packages/webgal/public/game");
  if (fssync.existsSync(cached)) return cached;
  const zip = path.resolve("tools/downloads/webgal-mygo-main.zip");
  if (fssync.existsSync(zip)) {
    await ensureDir(path.dirname(cached));
    await extractZip(zip, path.resolve(".galcode/webgal-base"));
    if (fssync.existsSync(cached)) return cached;
  }
  return "";
}

function findOpenPort(start) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      if (port >= 65535) throw new Error(`No open port found starting at ${start}. Pass --port <port> to choose one explicitly.`);
      const server = net.createServer();
      server.unref();
      server.on("error", () => tryPort(port + 1));
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => resolve(address.port));
      });
    };
    tryPort(start);
  });
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${command} ${args.join(" ")}`);
    const commandSpec = normalizeSpawnCommand(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function npmInvocation() {
  const npmCli = findNpmCli();
  if (npmCli) return { command: process.execPath, args: [npmCli] };
  return { command: isWindows ? "npm.cmd" : "npm", args: [] };
}

function findNpmCli() {
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    process.env.GALCODE_NPM_CLI || "",
    path.join(exeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(exeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(exeDir, "..", "libexec", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(process.cwd(), "node_modules", "npm", "bin", "npm-cli.js")
  ];
  return candidates.find((candidate) => candidate && fssync.existsSync(candidate)) || "";
}

function normalizeSpawnCommand(command, args = []) {
  if (!isWindows) return { command, args };
  const base = path.basename(command).toLowerCase();
  const usesCmd = base === "npm" ||
    base === "npm.cmd" ||
    base === "npx" ||
    base === "npx.cmd" ||
    base.endsWith(".cmd") ||
    base.endsWith(".bat");
  if (!usesCmd) return { command, args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")]
  };
}

function quoteWindowsArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function collectOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceDirectorySafely(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rm(target, { recursive: true, force: true });
  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    if (!isMoveFallbackError(error)) throw error;
    console.warn(`Directory rename failed (${error.code}); copying files instead.`);
  }

  await sleep(500);
  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    if (!isMoveFallbackError(error)) throw error;
    console.warn(`Directory rename retry failed (${error.code}); using recursive copy.`);
  }

  await fs.rm(target, { recursive: true, force: true }).catch(() => {});
  await fs.cp(source, target, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true }).catch(() => {});
}

function isMoveFallbackError(error) {
  return ["EXDEV", "EPERM", "EACCES", "EBUSY"].includes(error?.code);
}

async function preserveLive2DRuntimeFiles(webgalRoot) {
  const sourceDir = path.join(webgalRoot, "packages", "webgal", "public", "lib");
  const preserveDir = path.join(os.tmpdir(), `galcode-live2d-runtime-${Date.now()}`);
  let copied = 0;
  for (const file of [...LIVE2D_RUNTIME_FILES, "LIVE2D_RUNTIME_SOURCES.md"]) {
    const source = path.join(sourceDir, file);
    if (!fssync.existsSync(source)) continue;
    await fs.mkdir(preserveDir, { recursive: true });
    await fs.copyFile(source, path.join(preserveDir, file));
    copied += 1;
  }
  if (copied > 0) {
    console.log(`Preserved Live2D runtime files: ${copied}`);
    return preserveDir;
  }
  return "";
}

async function restoreLive2DRuntimeFiles(preserveDir, webgalRoot) {
  if (!preserveDir) return;
  const targetDir = path.join(webgalRoot, "packages", "webgal", "public", "lib");
  await fs.mkdir(targetDir, { recursive: true });
  for (const file of [...LIVE2D_RUNTIME_FILES, "LIVE2D_RUNTIME_SOURCES.md"]) {
    const source = path.join(preserveDir, file);
    if (!fssync.existsSync(source)) continue;
    await fs.copyFile(source, path.join(targetDir, file));
  }
  console.log(`Restored Live2D runtime into ${targetDir}`);
  await fs.rm(preserveDir, { recursive: true, force: true }).catch(() => {});
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(source, target) {
  await ensureDir(target);
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".galcode-extracted.json") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

async function listFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const current = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(current));
    else files.push(current);
  }
  return files;
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function cleanText(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/;/g, "；").trim();
}

function escapeCommandValue(value) {
  return String(value).replace(/;/g, "；").trim();
}

function safeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .toLowerCase() || "asset";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortHash(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function timestampSlug(mode) {
  return `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
