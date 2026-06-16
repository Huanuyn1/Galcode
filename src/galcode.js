import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";

// Cross-platform helpers.  Code is shared across macOS / Linux / Windows;
// only the launcher scripts (galcode / galcode.bat) and README differ.
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

async function extractZip(zipPath, destDir) {
  if (isWindows) {
    await run("powershell", ["-NoProfile", "-Command",
      `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`]);
  } else {
    await run("ditto", ["-x", "-k", zipPath, destDir]);
  }
}

async function safeRmDir(target) {
  try { await fs.rm(target, { recursive: true, force: true }); } catch {
    await run(isWindows ? "cmd" : "rm", isWindows ? ["/c","rd","/s","/q",target] : ["-rf",target]);
  }
}

async function findElectronBinary() {
  if (process.env.ELECTRON && fssync.existsSync(process.env.ELECTRON)) return process.env.ELECTRON;
  const candidates = isWindows
    ? ["node_modules/electron/dist/electron.exe"]
    : isMac
    ? ["node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"]
    : ["node_modules/electron/dist/electron"];
  for (const c of candidates) { if (fssync.existsSync(path.resolve(c))) return path.resolve(c); }
  const shim = path.resolve(isWindows ? "node_modules/.bin/electron.cmd" : "node_modules/.bin/electron");
  if (fssync.existsSync(shim)) return shim;
  return await commandExists("electron") ? "electron" : "";
}

function resolveToolsBin() {
  return (isMac && fssync.existsSync(path.resolve("tools/bin"))) ? path.resolve("tools/bin") : "";
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
  { key: "umiri", displayName: "八幡海铃", aliases: ["八幡海铃", "八幡海鈴", "海铃", "海鈴", "Umiri", "Yahata Umiri"] },
  { key: "nyamu", displayName: "祐天寺若麦", aliases: ["祐天寺若麦", "祐天寺若麥", "若麦", "若麥", "喵梦", "喵夢", "Nyamu", "Yutenji Nyamu"] }
];

const GALCODE_WRITER_SYSTEM_PROMPT = [
  "You are Galcode Agent, an AI writer/director that creates non-commercial WebGAL fan works.",
  "Your job is to produce a complete visual-novel plan as strict JSON that Galcode can compile into WebGAL script.",
  "The compiler compiles these actions in order: changeBg, bgm, changeFigure, dialogue (type:line), narration, wait, end.",
  "Do not invent unsupported WebGAL commands. Do not output raw WebGAL script unless explicitly asked.",
  "",
  "=== HOW FIGURES WORK ===",
  "There are three fixed screen positions: left, center, right. ONE character per position.",
  "Each character stays at ONE position for the ENTIRE scene. Never move a character to a different position mid-scene.",
  "",
  "To INTRODUCE a character (first time they appear in a scene):",
  "  { type:figure, character:'高松灯', assetId:'<tomori model id>', position:'center', motion:'idle01', expression:'default' }",
  "",
  "To CHANGE a character's emotion (same scene, same position):",
  "  { type:figure, character:'高松灯', assetId:'<SAME tomori model id>', position:'center', motion:'cry01', expression:'cry01' }",
  "  ← SAME assetId, SAME position; ONLY motion/expression differ.",
  "",
  "KEY RULE: When a character's feeling shifts, output a figure action with the SAME assetId and position ",
  "as their introduction, but with the new motion+expression. This is how WebGAL updates expressions.",
  "DO NOT change a character's position mid-scene. DO NOT use a different assetId for the same character.",
  "DO NOT output multiple figures at the same position simultaneously.",
  "",
  "=== MOTIONS & EXPRESSIONS ===",
  "Every figure MUST have a motion AND expression. Pick ONLY from the characterAssetGuide provided in the prompt.",
  "Common patterns (emotion → motion= / expression=):",
  "  neutral: idle01 / default     happy: smile01 / smile01     tense: serious01 / serious01",
  "  upset:  angry01 / angry01     sad: cry01 / cry01           surprised: idle01 / surprised",
  "  farewell: bye01 / default     thoughtful: nf01 / default",
  "Match motion+expression to the emotion in the CURRENT line of dialogue.",
  "Example arc for Tomori: introduce (idle01/default) → conflict (serious01/serious01) → breakdown (cry01/cry01) → reconcile (smile01/smile01)",
  "",
  "=== SCENE STRUCTURE ===",
  "Each scene MUST: 1) Set bg (backgroundAssetId) 2) Set bgm (bgmAssetId) 3) Introduce characters 4) Dialogue.",
  "Introduce all characters for a scene BEFORE their first line of dialogue in that scene.",
  "Use different backgrounds across scenes. Never repeat the same bg in consecutive scenes.",
  "Scenes: 3-5. Each scene: 4-8 lines of dialogue/narration. Use wait for dramatic pauses.",
  "",
  "=== Content Rules ===",
  "BGM and backgrounds come from the asset manifest. Read names carefully (they're in Chinese).",
  "Characters MUST use Live2D models from characterAssetGuide with matching characterKey.",
  "Do not include copyrighted lyrics, sexual content, hateful content, graphic violence.",
  "",
  "=== BGM / MUSIC ===",
  "You may optionally include a 'bgm' array in the story root to add background music to the final video.",
  "Each BGM entry: { assetName:'filename.mp3', startSec:0, endSec:180, volume:0.25, fadeIn:2, fadeOut:3 }",
  "- assetName: filename from the bgm list in the manifest summary",
  "- startSec/endSec: when this track plays (seconds from story start). Use action durationSec to estimate.",
  "- volume: 0.0-1.0 (0.25 is a good default for background music under dialogue)",
  "- fadeIn/fadeOut: crossfade duration in seconds",
  "Multiple bgm entries can overlap — they will be mixed together.",
  "Example: [{ assetName:'s_Title.mp3', startSec:0, endSec:60, volume:0.25, fadeIn:2, fadeOut:3 }, ...]",
  "If no bgm array is provided, no music will be added.",
  "",
  "Return JSON only, matching the provided schema."
].join("\n");

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
  if (command === "init") return initConfig(flags);
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
  if (command === "record") return recordCommand(flags, positionals);

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

function printHelp() {
  console.log(`Galcode 0.1

Usage:
  galcode
  galcode agent
  galcode init
  galcode configure
  galcode setup --root vendor
  galcode download-assets --target mygoxmujica
  galcode install-live2d-runtime --from /path/to/live2d-sdk-lib
  galcode prepare-live2d --limit 4
  galcode index --out work/asset-manifest.json
  galcode discuss --record
  galcode yolo --record
  galcode make --mode yolo --theme "灯和爱音雨夜和解" --duration 180
  galcode compile story.json --assets work/asset-manifest.json --out outputs/story
  galcode record outputs/story --url http://localhost:3000

Modes:
  agent     Interactive AI director. Chat, brainstorm, generate, compile, record.
  discuss   Ask you a few creative-direction questions, then AI writes the work.
  yolo      No questions. AI chooses direction and writes the work.

AI environment:
  OPENAI_API_KEY       Required for real AI generation, or run galcode configure.
  OPENAI_MODEL         Defaults to gpt-4.1-mini.
  OPENAI_BASE_URL      Defaults to https://api.openai.com/v1.

Recording:
  Requires optional Playwright and ffmpeg. If no --url is provided, Galcode records
  the generated fallback preview. If --url is provided, it records your WebGAL page.
  Default recording FPS is 60. Use --fps <n> to override.
  Recommended capture backend is --capture electron: cross-platform background
  Chromium offscreen rendering. --capture avfoundation is macOS-only visible
  screen capture; --capture screenshot is a deterministic fallback.

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
  live2d.min.js and live2dcubismcore.min.js. Use install-live2d-runtime --from <dir>,
  or pass --live2d-runtime-dir <dir> while recording.

Unstable network:
  Use download-assets instead of git clone. It downloads GitHub zip files with
  curl -C - so rerunning the command resumes partial downloads.
`);
}

async function initConfig(flags) {
  const target = path.resolve(flags.out || "galcode.config.json");
  await ensureDir(path.dirname(target));
  const config = {
    name: "Galcode",
    engineRepo: DEFAULT_ENGINE_REPO,
    assetArchiveRepo: DEFAULT_ARCHIVE_REPO,
    staticArchiveRepo: DEFAULT_STATIC_ARCHIVE_REPO,
    engineDir: "vendor/WebGAL",
    assetArchiveDir: "figure",
    staticArchiveDir: "vendor/mygo-mujica-archive",
    manifest: "work/asset-manifest.json",
    outputsDir: "outputs",
    ai: {
      model: "${OPENAI_MODEL:-gpt-4.1-mini}",
      baseUrl: "${OPENAI_BASE_URL:-https://api.openai.com/v1}"
    }
  };
  await writeJson(target, config);
  console.log(`Wrote ${target}`);
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
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Galcode Agent");
    console.log("交互式 WebGAL 二创工作台。输入一句想法即可生成；输入 /help 查看命令。");
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
      console.log("已切换到离线 demo 模式。");
    }

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
      if (line === "/yolo") {
        await runAgentCreation(rl, flags, yoloBrief(flags), "yolo");
        continue;
      }
      if (line.startsWith("/brainstorm")) {
        const topic = line.replace(/^\/brainstorm\s*/i, "").trim() || await rl.question("想围绕什么主题发散？ ");
        await printBrainstormIdeas(topic, flags);
        continue;
      }
      if (line.startsWith("/make")) {
        const topic = line.replace(/^\/make\s*/i, "").trim() || await rl.question("想写什么主题？ ");
        await runAgentCreation(rl, flags, await briefFromTopic(rl, flags, topic), "discuss");
        continue;
      }

      await runAgentCreation(rl, flags, await briefFromTopic(rl, flags, line), "discuss");
    }
  } finally {
    rl.close();
  }
}

function printAgentHelp() {
  console.log([
    "命令：",
    "  直接输入想法        例：灯和爱音雨夜排练前和解",
    "  /brainstorm 主题    先让 AI 给 3 个二创方向",
    "  /make 主题          按指定主题生成 WebGAL 工程",
    "  /yolo               不讨论，直接生成",
    "  /config             重新配置 API key / 模型 / Base URL",
    "  /quit               退出",
    "",
    "默认会生成 WebGAL 脚本；生成前会问是否录制 mp4。"
  ].join("\n"));
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
  const shouldRecord = await rl.question("生成后录制 mp4 吗？[Y/n] ");
  const outName = await rl.question("输出目录名？直接回车自动命名： ");
  const outDir = path.resolve(outName.trim() || path.join("outputs", timestampSlug("agent")));
  const flags = {
    ...baseFlags,
    mode,
    record: !/^n/i.test(shouldRecord.trim()),
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
      content: [
        "You are Galcode Agent. Brainstorm non-commercial MyGO/Ave Mujica WebGAL fan-work concepts.",
        "Return JSON only: {\"ideas\":[{\"title\":\"...\",\"pitch\":\"...\",\"characters\":\"...\",\"tone\":\"...\"}]}",
        "Do not include copyrighted lyrics, adult content, hateful content, or graphic violence."
      ].join("\n")
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
  if (fssync.existsSync(config.extractedDir)) {
    await fs.rm(config.extractedDir, { recursive: true, force: true });
  }
  if (fssync.existsSync(config.finalDir)) {
    await fs.rm(config.finalDir, { recursive: true, force: true });
  }
  await extractZip(config.zip, root);
  await fs.rename(config.extractedDir, config.finalDir);
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

  const outDir = path.resolve(flags.out || path.join("outputs", timestampSlug(mode)));
  const brief = mode === "discuss" ? await askCreativeBrief(flags) : yoloBrief(flags);
  await createProjectFromBrief({ brief, mode, flags, outDir });
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

  if (flags.record) {
    await recordProject(outDir, flags);
  }

  console.log(`Galcode project ready: ${outDir}`);
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

async function recordCommand(flags, positionals) {
  const projectDir = path.resolve(positionals[0] || flags.project || ".");
  await recordProject(projectDir, flags);
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
    const duration = await rl.question("视频目标时长秒数？默认 180： ");
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
      content: GALCODE_WRITER_SYSTEM_PROMPT
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

async function callOpenAI(messages, flags) {
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = flags.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.9,
      response_format: { type: "json_object" }
    })
  });

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
          { type: "figure", character: "string", assetId: "asset id from manifest, may be figure or live2d", position: "left|center|right", motion: "Live2D motion name (REQUIRED)", expression: "Live2D expression name (REQUIRED)" },
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
          defaultMotion: asset.defaultMotion,
          defaultExpression: asset.defaultExpression,
          motions: filterShortNames(asset.motions || [], character.key).slice(0, 8),
          expressions: filterShortNames(asset.expressions || [], character.key).slice(0, 8)
        }));
      return {
        characterKey: character.key,
        displayName: character.displayName,
        aliases: character.aliases,
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
      action.motion = prefixMotionName(action.motion || replacement.defaultMotion || "", characterKey);
      action.expression = prefixMotionName(action.expression || replacement.defaultExpression || "", characterKey);
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
  const characterKey = inferLive2DCharacterKey(asset.relativePath);
  return {
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
}

async function inspectLive2DModel(modelPath, modelDir) {
  const motions = new Set();
  const expressions = new Set();
  let modelRoot = modelDir;
  let paramImport = null;
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
        if (motion?.name) motions.add(String(motion.name));
        if (motion?.file) motions.add(motionNameFromFile(motion.file));
      }
    } else {
      for (const [group, entries] of Object.entries(motionConfig)) {
        motions.add(String(group));
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry?.File) motions.add(motionNameFromFile(entry.File));
          if (entry?.file) motions.add(motionNameFromFile(entry.file));
        }
      }
    }
    const expressionConfig = fileReferences.Expressions || json.expressions || [];
    for (const expression of Array.isArray(expressionConfig) ? expressionConfig : []) {
      if (expression?.Name) expressions.add(String(expression.Name));
      if (expression?.name) expressions.add(String(expression.name));
      if (expression?.File) expressions.add(motionNameFromFile(expression.File));
      if (expression?.file) expressions.add(motionNameFromFile(expression.file));
    }
  } catch {
    // Some community model json files are encoded oddly; fall back to sibling scan.
  }

  await walk(modelDir, async (file) => {
    const lower = file.toLowerCase();
    if (LIVE2D_MOTION_EXTS.some((ext) => lower.endsWith(ext))) motions.add(motionNameFromFile(file));
    if (lower.endsWith(".exp.json")) expressions.add(motionNameFromFile(file));
  });
  return {
    modelRoot,
    paramImport,
    motions: [...motions].filter(Boolean),
    expressions: [...expressions].filter(Boolean)
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

  // Don't let shared _mtn_exp references pull modelRoot above the model's own
  // directory. The _mtn_exp directory is handled separately in copyLive2DForWebGAL.
  // Keep modelRoot scoped to the costume directory (e.g. figure/mygo/tomori/live_default).
  const rootParts = root.split(path.sep);
  const figIdx = rootParts.indexOf("figure");
  if (figIdx >= 0) {
    const figBase = rootParts.slice(0, figIdx + 1).join(path.sep);
    const relToFig = path.relative(figBase, modelDir);
    const parts = relToFig.split(path.sep).filter(Boolean);
    if (parts[0] === "mygo" && parts.length >= 2) {
      // parts[1] is <character>, parts[2] is <costume> (if present)
      // Scope to costume level when possible, otherwise character level.
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
    .replace(/\.exp\.json$/i, "")
    .replace(/\.mtn$/i, "");
}

function chooseMotion(motions = [], characterKey = "") {
  const preferred = ["idle", "idle01", "nf01", "smile01", "serious01", "normal", "default"];
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
  const preferred = ["default", "idle01", "smile01", "serious01", "normal"];
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
      characterHint: asset.characterHint,
      tags: asset.tags
    }));

  return {
    counts: manifest.counts,
    backgrounds: byKind("background", 40),
    figures: byKind("figure", 60),
    live2d: manifest.assets
      .filter((asset) => asset.kind === "live2d")
      .slice(0, 40)
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        fileName: asset.fileName,
        characterHint: asset.characterHint,
        characterKey: inferAssetCharacterKey(asset),
        relativePath: asset.relativePath,
        version: asset.live2dVersion,
        isCompositePart: Boolean(asset.isCompositePart),
        motions: (asset.motions || []).slice(0, 12),
        expressions: (asset.expressions || []).slice(0, 12),
        tags: asset.tags
      })),
    characterGuide: buildCharacterAssetGuide(manifest),
    bgm: byKind("bgm", 30),
    video: byKind("video", 20)
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
  const dirs = ["scene", "background", "figure", "bgm", "voice", "video"];
  for (const dir of dirs) await ensureDir(path.join(gameDir, dir));

  // Write minimal config.txt so WebGAL can initialize its renderer.
  // Without this file, infoFetcher 404s and PixiJS canvas is never created.
  await fs.writeFile(path.join(gameDir, "config.txt"), "Game_key:galcode-demo;\n", "utf8");

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
  sceneText.push("end;");

  await fs.writeFile(path.join(gameDir, "scene", "start.txt"), `${sceneText.join("\n")}\n`, "utf8");

  // Calculate timeline: cumulative seconds for each action
  let clock = 0;
  const timeline = [];
  for (const scene of story.scenes || []) {
    for (const action of scene.actions || []) {
      const dur = Number(action.durationSec || 0);
      timeline.push({ ...action, startSec: clock, endSec: clock + Math.max(0, dur) });
      clock += Math.max(0, dur);
    }
  }
  if (story.bgm && story.bgm.length > 0) {
    story._timeline = timeline;
    story._totalDurationSec = clock;
  }

  // Resolve and copy BGM assets so they're available for post-processing
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
    const asset = assetMap.get(action.assetId);
    const name = asset?.kind === "live2d"
      ? await copyLive2DForWebGAL(asset, gameDir, copied)
      : await copyAssetForWebGAL(asset, gameDir, "figure", copied);
    if (!name) return null;
    const pos = positionFlag(action.position);
    const characterKey = canonicalCharacterKey(action.character || "");
    const motion = prefixMotionName(action.motion || "", characterKey);
    const expression = prefixMotionName(action.expression || "", characterKey);
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

function live2DTransform(position) {
  return { xScale: 1, yScale: 1, xOffset: 0, yOffset: 0 };
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

async function copyLive2DForWebGAL(asset, gameDir, copied) {
  if (!asset || !asset.path || !fssync.existsSync(asset.path)) return null;
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

To record an already running WebGAL page:

\`\`\`bash
galcode record ${outDir} --url http://localhost:3000 --duration ${story.durationSec || 180}
\`\`\`
`;
  await fs.writeFile(path.join(outDir, "README.md"), readme, "utf8");
}

async function mixBGM(projectDir, videoOut, flags = {}) {
  if (flags.noBgm) return;
  const storyPath = path.join(projectDir, "story.json");
  if (!fssync.existsSync(storyPath)) return;
  let story;
  try { story = JSON.parse(await fs.readFile(storyPath, "utf8")); } catch { return; }
  if (!story.bgm || !story.bgm.length) return;

  // Find BGM files — prefer paths copied during compile, fall back to assetPath
  const bgmEntries = story.bgm.filter((b) => {
    const p = b._copiedPath || b.assetPath;
    return p && fssync.existsSync(p);
  });
  if (!bgmEntries.length) return;

  // Use total duration from timeline, or fall back to story.durationSec
  const totalSec = story._totalDurationSec || story.durationSec || 60;

  // Build ffmpeg filter chain per BGM segment
  const bgmLabels = [];
  const filterParts = [];
  const inputFiles = [];

  for (let i = 0; i < bgmEntries.length; i++) {
    const bgm = bgmEntries[i];
    const src = bgm._copiedPath || bgm.assetPath;
    const start = Number(bgm.startSec || 0);
    const end = Math.min(Number(bgm.endSec || totalSec), totalSec);
    const dur = end - start;
    if (dur <= 0) continue;
    const vol = Number(bgm.volume ?? 0.3);
    const fadeIn = Number(bgm.fadeIn || 1);
    const fadeOut = Number(bgm.fadeOut || 2);
    const fadeOutStart = Math.max(0, dur - fadeOut);

    inputFiles.push(src);
    const inIdx = inputFiles.length; // 1-based for ffmpeg -i counting (0 is video)
    const label = `bgm${i}`;
    bgmLabels.push(label);

    // atrim → afade in → afade out → volume → label
    filterParts.push(
      `[${inIdx}:a]atrim=${start}:${end},asetpts=PTS-STARTPTS,afade=t=in:d=${fadeIn},afade=t=out:st=${fadeOutStart.toFixed(1)}:d=${fadeOut},volume=${vol}[${label}]`
    );
  }

  if (!filterParts.length) return;

  const mixInputs = bgmLabels.map((l) => `[${l}]`).join("");
  filterParts.push(`${mixInputs}amix=inputs=${bgmLabels.length}:duration=longest:normalize=0[aout]`);

  const filterComplex = filterParts.join(";");

  // Build ffmpeg command
  const tmpOut = videoOut.replace(/\.mp4$/, ".tmp.mp4");
  const ffmpegArgs = [
    "-y",
    "-i", videoOut,
    ...inputFiles.flatMap((f) => ["-i", f]),
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-shortest",
    tmpOut
  ];

  console.log(`Mixing BGM: ${bgmEntries.length} track(s)`);
  try {
    await run("ffmpeg", ffmpegArgs);
    await fs.rename(tmpOut, videoOut);
    console.log("BGM mix complete");
  } catch (err) {
    console.warn(`BGM mix failed (video kept without audio): ${err.message}`);
  }
}

async function recordProject(projectDir, flags) {
  const duration = Number(flags.duration || flags.durationSec || await readStoryDuration(projectDir) || 180);
  const out = path.resolve(flags.videoOut || path.join(projectDir, "final.mp4"));
  let autoServer = null;
  let url = flags.url || "";
  if (!url && !flags.previewOnly) {
    autoServer = await startWebGALPreview(projectDir, flags).catch((error) => {
      if (error.galcodeFatal) throw error;
      console.warn(`Could not auto-start WebGAL preview: ${error.message}`);
      return null;
    });
    if (autoServer) url = autoServer.url;
  }
  if (!url) url = pathToFileUrl(path.join(projectDir, "preview.html"));
  const size = flags.size || "1280x720";

  const hasFfmpeg = await commandExists("ffmpeg");
  if (!hasFfmpeg) {
    console.warn("ffmpeg was not found. Skipping video recording.");
    console.warn(`Preview URL: ${url}`);
    if (autoServer?.child) autoServer.child.kill("SIGTERM");
    return;
  }

  const [width, height] = size.split("x").map(Number);
  const fps = Number(flags.fps || 60);
  await ensureDir(path.dirname(out));
  await fs.rm(out, { force: true });
  const captureMode = String(flags.capture || flags.captureMode || (flags.screenshot ? "screenshot" : "electron")).toLowerCase();

  if (captureMode === "electron" || captureMode === "offscreen" || captureMode === "electron-offscreen") {
    try {
      await recordWithElectronOffscreen(url, { width, height, duration, fps, out, flags });
    } finally {
      if (autoServer?.child) autoServer.child.kill("SIGTERM");
    }
    await mixBGM(projectDir, out, flags);
    console.log(`Recorded ${out}`);
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.warn("Playwright is not installed. Run `npm install` before recording.");
    console.warn(`Preview URL: ${url}`);
    if (autoServer?.child) autoServer.child.kill("SIGTERM");
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `galcode-${captureMode.replace(/[^a-z0-9]+/g, "-")}-`));
  const browser = await chromium.launch({
    headless: captureMode === "avfoundation" ? false : true,
    args: captureMode === "avfoundation" ? [`--window-size=${width},${height}`, "--window-position=0,0"] : []
  });
  try {
    if (captureMode === "playwright-video" || captureMode === "video") {
      await recordWithPlaywrightVideo(browser, url, { width, height, duration, out, tempDir, flags });
    } else if (captureMode === "avfoundation") {
      await recordWithAVFoundation(browser, url, { width, height, duration, fps, out, flags });
    } else if (captureMode === "screenshot" || captureMode === "frames") {
      await recordWithScreenshots(browser, url, { width, height, duration, fps, out, tempDir, flags });
    } else {
      throw new Error(`Unknown capture mode: ${captureMode}`);
    }
  } finally {
    await browser.close().catch(() => {});
    if (autoServer?.child) autoServer.child.kill("SIGTERM");
  }
  await mixBGM(projectDir, out, flags);
  console.log(`Recorded ${out}`);
}

async function prepareRecordPage(page, url, { width, height, flags }) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  if (flags.noAutoplay) return;
  const bodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  if (bodyText.includes("LANGUAGE SELECT")) {
    const clickedLanguage = await clickFirstVisibleText(page, ["简体", "简体中文", "中文"]);
    if (!clickedLanguage) await page.mouse.click(Math.floor(width * 0.085), Math.floor(height * 0.55)).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await page.mouse.click(Math.floor(width / 2), Math.floor(height / 2)).catch(() => {});
  await page.keyboard.press("Space").catch(() => {});
  await page.waitForTimeout(1000);
  const clickedMenu = await clickFirstVisibleText(page, ["开始游戏", "继续游戏", "COMMENCER", "CONTINUER", "开始", "继续", "START", "CONTINUE"]);
  if (!clickedMenu) await page.mouse.click(Math.floor(width * 0.14), Math.floor(height * 0.265)).catch(() => {});
  await page.waitForTimeout(600);
  const stillOnTitle = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  if (/开始游戏|COMMENCER|START/.test(stillOnTitle)) {
    await page.mouse.click(Math.floor(width * 0.14), Math.floor(height * 0.265)).catch(() => {});
  }
  await page.waitForTimeout(Number(flags.startDelay || 1500));
}

async function recordWithPlaywrightVideo(browser, url, { width, height, duration, out, tempDir, flags }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: tempDir,
      size: { width, height }
    }
  });
  let videoFile = "";
  try {
    const page = await context.newPage();
    await prepareRecordPage(page, url, { width, height, flags });
    await page.waitForTimeout(Math.max(0, duration * 1000));
    const video = page.video();
    await page.close();
    videoFile = await video.path();
  } finally {
    await context.close().catch(() => {});
  }
  if (!videoFile) throw new Error("Playwright did not produce a video file.");
  await run("ffmpeg", [
    "-y",
    "-i", videoFile,
    "-r", String(Number(flags.fps || 60)),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    out
  ]);
}

async function recordWithElectronOffscreen(url, { width, height, duration, fps, out, flags }) {
  const electron = await findElectronBinary();
  if (!electron) {
    throw new Error("Electron is not installed. Run `npm install electron --save-optional`, then retry with `galcode record ... --capture electron`.");
  }
  const script = path.resolve("src/electron-recorder.cjs");
  if (!fssync.existsSync(script)) throw new Error(`Electron recorder script not found: ${script}`);
  await runRecorderProcess(electron, [
    script,
    "--url", url,
    "--out", out,
    "--duration", String(duration),
    "--fps", String(fps),
    "--width", String(width),
    "--height", String(height),
    "--ffmpeg", flags.ffmpeg || "ffmpeg",
    "--start-delay", String(flags.startDelay || 1500),
    "--scene-delay", String(flags.sceneDelay || 8000),
    "--click-interval", String(flags.clickInterval || 3000),
    ...(flags.noAutoplay ? ["--no-autoplay"] : [])
  ], {
    quietWithOutput: !flags.electronLogs,
    timeoutMs: Number(flags.recordTimeout || Math.max(180000, duration * 2000 + 180000)),
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: flags.electronLogs ? "1" : process.env.ELECTRON_ENABLE_LOGGING || "",
      PATH: `${path.resolve("tools/bin")}${path.delimiter}${process.env.PATH || ""}`
    }
  });
}

function runRecorderProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${command} ${args.join(" ")}`);
    const outIndex = args.indexOf("--out");
    const outFile = outIndex >= 0 ? args[outIndex + 1] : "";
    const quietWithOutput = Boolean(options.quietWithOutput);
    const timeoutMs = Number(options.timeoutMs || 0);
    const { quietWithOutput: _quietWithOutput, timeoutMs: _timeoutMs, ...spawnOptions } = options;
    const child = spawn(command, args, {
      stdio: quietWithOutput ? ["ignore", "ignore", "pipe"] : "inherit",
      ...spawnOptions
    });
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs) : null;
    let stderr = "";
    if (quietWithOutput && child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.length > 120000) stderr = stderr.slice(-120000);
      });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      const stat = outFile ? fssync.statSync(outFile, { throwIfNoEntry: false }) : null;
      // Check for partial success regardless of exit code
      if (stat?.size > 0) {
        if (code !== 0 && !quietWithOutput) {
          console.warn(`Recorder exited with ${code ?? signal}, but output video was written: ${outFile}`);
        }
        return resolve();
      }
      if (timedOut) {
        if (stderr) console.error(stderr.trim());
        return reject(new Error(`${command} timed out after ${timeoutMs} ms`));
      }
      if (code === 0) {
        if (stderr) console.error(stderr.trim());
        return reject(new Error(`Recorder exited successfully but did not write output: ${outFile}`));
      }
      if (stderr) console.error(stderr.trim());
      reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function recordWithAVFoundation(browser, url, { width, height, duration, fps, out, flags }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await prepareRecordPage(page, url, { width, height, flags });
  const device = String(flags.avfoundationDevice || flags.captureDevice || "1:none");
  const args = [
    "-y",
    "-f", "avfoundation",
    "-framerate", String(fps),
    "-capture_cursor", "0",
    "-capture_mouse_clicks", "0",
    "-i", device,
    "-t", String(duration),
    "-r", String(fps),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    out
  ];
  console.log(`AVFoundation capture device: ${device}`);
  await run("ffmpeg", args);
}

async function recordWithScreenshots(browser, url, { width, height, duration, fps, out, tempDir, flags }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await prepareRecordPage(page, url, { width, height, flags });
  const frameClock = await createFrameClock(page, flags, fps);
  console.log(`Capture clock: ${frameClock.mode}`);
  const frameCount = Math.ceil(duration * fps);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const file = path.join(tempDir, `frame-${String(frame).padStart(6, "0")}.png`);
    await frameClock.step();
    await screenshotWithRetry(page, file);
  }
  await frameClock.close();
  await run("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", path.join(tempDir, "frame-%06d.png"),
    "-r", String(fps),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    out
  ]);
}

async function createFrameClock(page, flags, fps) {
  const frameMs = 1000 / fps;
  if (flags.realtimeCapture) {
    return {
      mode: `realtime ${fps}fps`,
      step: () => page.waitForTimeout(frameMs),
      close: async () => {}
    };
  }

  try {
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
    return {
      mode: `virtual-time ${fps}fps`,
      step: async () => {
        await client.send("Emulation.setVirtualTimePolicy", {
          policy: "advance",
          budget: frameMs,
          maxVirtualTimeTaskStarvationCount: 100
        });
      },
      close: async () => {
        await client.send("Emulation.setVirtualTimePolicy", { policy: "pause" }).catch(() => {});
        await client.detach().catch(() => {});
      }
    };
  } catch (error) {
    console.warn(`Chromium virtual time is unavailable; falling back to realtime capture: ${error.message}`);
    return {
      mode: `realtime ${fps}fps fallback`,
      step: () => page.waitForTimeout(frameMs),
      close: async () => {}
    };
  }
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
      throw new Error("WebGAL dependencies are not installed. Run `galcode record ... --install-webgal-deps` once, or use --preview-only.");
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
  await copyDir(sourceGameDir, publicGameDir);
  await ensureLive2DRuntime(webgalDir, sourceGameDir, flags);
  const port = Number(flags.port || await findOpenPort(3000));
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: webgalDir,
    stdio: flags.webgalLogs ? "inherit" : "ignore",
    env: { ...process.env, BROWSER: "none" }
  });
  child.on("error", () => {});
  const url = `http://127.0.0.1:${port}`;
  await waitForUrl(url, Number(flags.webgalTimeout || 60000));
  console.log(`Auto-started WebGAL preview: ${url}`);
  return { child, url };
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
    `Put ${LIVE2D_RUNTIME_FILES.join(" and ")} into ${libDir},`,
    "or run `galcode install-live2d-runtime --from <dir>` after obtaining the Live2D runtime files.",
    "Without these files WebGAL disables Live2D and the recorded video will not show models."
  ].join(" ");

  if (flags.allowMissingLive2dRuntime || flags.noLive2dRuntimeCheck) {
    console.warn(message);
    return;
  }

  const error = new Error(message);
  error.galcodeFatal = true;
  throw error;
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

async function screenshotWithRetry(page, file) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot({ path: file, timeout: 10000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(300);
    }
  }
  throw lastError;
}

async function clickFirstVisibleText(page, texts) {
  for (const text of texts) {
    try {
      const locator = page.getByText(text, { exact: false }).first();
      await locator.click({ timeout: 1500 });
      return true;
    } catch {
      // Try the next label.
    }
  }
  return false;
}

async function readStoryDuration(projectDir) {
  const storyPath = path.join(projectDir, "story.json");
  if (!fssync.existsSync(storyPath)) return 0;
  const story = JSON.parse(await fs.readFile(storyPath, "utf8"));
  return Number(story.durationSec || 0);
}

async function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
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

function pathToFileUrl(file) {
  return `file://${path.resolve(file).split(path.sep).map(encodeURIComponent).join("/")}`;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
