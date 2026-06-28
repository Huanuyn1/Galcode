import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GALCODE_BIN = path.join(ROOT_DIR, "bin", "galcode.js");
const MCP_DIR = path.join(ROOT_DIR, ".galcode", "mcp");
const JOB_DIR = path.join(MCP_DIR, "jobs");
const STORY_DIR = path.join(MCP_DIR, "stories");
const DEFAULT_MANIFEST = path.join(MCP_DIR, "asset-manifest.json");
const SERVER_NAME = "galcode-mcp";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";

const CHARACTER_CATALOG = [
  {
    key: "tomori",
    displayName: "高松灯",
    aliases: ["高松灯", "灯", "Tomori"],
    writingNotes: "Soft-spoken, intensely sincere, drawn to words and small emotional signals. Best used for quiet pressure, fragile courage, and confessions that arrive slowly."
  },
  {
    key: "anon",
    displayName: "千早爱音",
    aliases: ["千早爱音", "爱音", "Anon"],
    writingNotes: "Social, restless, prideful but not shallow. Useful for scenes where a bright tone hides insecurity, apology, or the need to keep moving."
  },
  {
    key: "soyo",
    displayName: "长崎爽世",
    aliases: ["长崎爽世", "爽世", "Soyo"],
    writingNotes: "Polite and composed on the surface, careful with distance and control. Works well for subtext, elegant avoidance, and conversations with a sting."
  },
  {
    key: "taki",
    displayName: "椎名立希",
    aliases: ["椎名立希", "立希", "Taki"],
    writingNotes: "Blunt, disciplined, protective, easily irritated when things drift. Strong for rhythm, confrontation, and practical emotional care."
  },
  {
    key: "rana",
    displayName: "要乐奈",
    aliases: ["要乐奈", "乐奈", "Rana"],
    writingNotes: "Instinctive, concise, independent. Best used as a strange clear note in a scene, changing the emotional weather with one simple line."
  },
  {
    key: "sakiko",
    displayName: "丰川祥子",
    aliases: ["丰川祥子", "祥子", "Sakiko"],
    writingNotes: "Formal, theatrical, burdened by pride and obligation. Useful for high-tension restraint, grandeur, and carefully chosen cracks."
  },
  {
    key: "mutsumi",
    displayName: "若叶睦",
    aliases: ["若叶睦", "睦", "Mutsumi"],
    writingNotes: "Quiet, literal, difficult to read, often emotionally decisive in understated ways. Good for pauses, simple truths, and uneasy loyalty."
  },
  {
    key: "uika",
    displayName: "三角初华",
    aliases: ["三角初华", "初华", "Uika"],
    writingNotes: "Gentle, public-facing, skilled at smoothing the room while carrying private tension. Fits mediator roles and warm but conflicted scenes."
  },
  {
    key: "umiri",
    displayName: "八幡海铃",
    aliases: ["八幡海铃", "海铃", "Umiri"],
    writingNotes: "Cool, observant, professional, often direct without being loud. Useful for grounding a dramatic scene with sharp clarity."
  },
  {
    key: "nyamu",
    displayName: "祐天寺若麦",
    aliases: ["祐天寺若麦", "若麦", "喵梦", "Nyamu"],
    writingNotes: "Playful, performative, internet-aware, but not only comic relief. Good for breaking tension or making hidden motives visible."
  }
];

const STORY_SCHEMA = {
  title: "string",
  description: "string",
  durationSec: "number",
  characters: ["string"],
  scenes: [
    {
      id: "string",
      title: "string",
      backgroundAssetId: "asset id from galcode://assets, optional",
      bgmAssetId: "asset id from galcode://assets, optional",
      actions: [
        {
          type: "figure",
          character: "string, or 'none' to clear a position",
          assetId: "asset id from manifest, required unless character is none",
          position: "left|center|right",
          motion: "Live2D motion name, required for Live2D assets",
          expression: "Live2D expression name, required for Live2D assets"
        },
        { type: "line", speaker: "string", text: "string", durationSec: "number" },
        { type: "narration", text: "string", durationSec: "number" },
        { type: "wait", durationSec: "number" }
      ]
    }
  ],
  bgm: [
    { assetName: "file name from bgm assets", startSec: 0, endSec: 60, volume: 0.25, fadeIn: 2, fadeOut: 3 }
  ],
  video: {
    title: "string",
    description: "string",
    tags: ["string"]
  }
};

const WEBGAL_RULES = [
  "Galcode compiles structured story JSON into WebGAL scripts.",
  "A scene should set backgroundAssetId and optional bgmAssetId before dialogue starts.",
  "There are three figure positions: left, center, right. One position can hold only one character.",
  "To replace a character in a position, first send a figure action with character='none' for that position.",
  "For Live2D figure actions, use an assetId from galcode://assets and choose motion/expression from that asset.",
  "Do not use the same character in multiple positions at the same time.",
  "Use motion changes every few lines. A whole scene using only idle01 will look like a slide deck.",
  "Use line actions for spoken dialogue, narration actions for narration, and wait actions for dramatic pauses.",
  "Avoid copyrighted lyrics and keep generated content suitable for non-commercial fan experimentation."
].join("\n");

const STYLE_GUIDE = [
  "Galcode is best used as a rendering toolchain, not as the story agent.",
  "Let the host AI discuss ideas with the user, then write a complete story JSON.",
  "Prefer compact scenes with clear emotional turns: setup, pressure, reveal, aftertaste.",
  "MyGO-like stories often benefit from awkward honesty, rain-after-sun relief, and unresolved but forward-moving endings.",
  "Ave Mujica-like stories can lean theatrical, restrained, and sharp, but avoid flattening characters into one-note drama.",
  "The public repository does not bundle official Live2D SDK/runtime or official model assets. If assets are missing, write stories that can still compile, then tell the user which files must be supplied for full Live2D output."
].join("\n");

const EXAMPLE_STORY = {
  title: "雨后还要继续",
  description: "A short non-commercial fan scene about saying one true thing after avoiding many.",
  durationSec: 60,
  characters: ["高松灯", "千早爱音"],
  scenes: [
    {
      id: "rain-after",
      title: "雨后的屋顶",
      backgroundAssetId: "",
      bgmAssetId: "",
      actions: [
        { type: "narration", text: "雨停以后，地面把天空还给了她们。", durationSec: 4 },
        { type: "line", speaker: "千早爱音", text: "我刚刚说得太轻松了。", durationSec: 5 },
        { type: "line", speaker: "高松灯", text: "可是你没有走掉。", durationSec: 5 },
        { type: "wait", durationSec: 2 },
        { type: "line", speaker: "千早爱音", text: "那就再迷路一次吧。这次我会问路。", durationSec: 6 }
      ]
    }
  ],
  video: {
    title: "雨后还要继续",
    description: "Generated with Galcode.",
    tags: ["Galcode", "WebGAL"]
  }
};

const RESOURCE_DEFS = [
  { uri: "galcode://characters", name: "Galcode characters", mimeType: "application/json", description: "Character keys, aliases, and lightweight writing notes." },
  { uri: "galcode://assets", name: "Galcode asset summary", mimeType: "application/json", description: "Available asset ids and metadata; does not include copyrighted file contents." },
  { uri: "galcode://story-schema", name: "Galcode story schema", mimeType: "application/json", description: "Structured story JSON shape expected by galcode_compile_story." },
  { uri: "galcode://webgal-rules", name: "Galcode WebGAL rules", mimeType: "text/plain", description: "Rules for positions, figure actions, dialogue, and recording-friendly scripts." },
  { uri: "galcode://style-guide", name: "Galcode style guide", mimeType: "text/plain", description: "Creative guidance for the host AI while iterating a story with the user." },
  { uri: "galcode://examples", name: "Galcode examples", mimeType: "application/json", description: "Small story JSON examples for the host model." },
  { uri: "galcode://runtime-status", name: "Galcode runtime status", mimeType: "application/json", description: "Local dependency and runtime availability summary." }
];

const PROMPT_DEFS = [
  {
    name: "galcode_write_story_json",
    description: "Guide the host model to write a Galcode story JSON from a user's fan-work idea.",
    arguments: [
      { name: "idea", description: "The user's story idea or theme.", required: true },
      { name: "durationSec", description: "Target video duration in seconds.", required: false }
    ]
  },
  {
    name: "galcode_revision_pass",
    description: "Revise an existing story JSON according to user feedback while preserving renderability.",
    arguments: [
      { name: "feedback", description: "User revision request.", required: true }
    ]
  },
  {
    name: "galcode_fix_validation_errors",
    description: "Fix story JSON after galcode_validate_story reports asset or structure problems.",
    arguments: [
      { name: "errors", description: "Validation errors returned by Galcode.", required: true }
    ]
  },
  {
    name: "galcode_render_debug",
    description: "Help diagnose a failed compile or render job using Galcode logs.",
    arguments: [
      { name: "log", description: "Job or recorder log excerpt.", required: true }
    ]
  }
];

const runningJobs = new Map();

export async function startMcpServer() {
  await ensureDir(MCP_DIR);
  const transport = new StdioJsonRpcTransport(handleRequest);
  transport.start();
}

class StdioJsonRpcTransport {
  constructor(handler) {
    this.handler = handler;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    process.stdin.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    process.stdin.on("error", () => {});
  }

  drain() {
    while (this.buffer.length > 0) {
      const framed = this.tryReadFramed();
      if (framed) {
        void this.dispatch(framed);
        continue;
      }
      const newline = this.tryReadLine();
      if (newline) {
        void this.dispatch(newline);
        continue;
      }
      return;
    }
  }

  tryReadFramed() {
    const sep = this.buffer.indexOf(Buffer.from("\r\n\r\n"));
    if (sep === -1) return null;
    const header = this.buffer.slice(0, sep).toString("ascii");
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) return null;
    const length = Number(match[1]);
    const start = sep + 4;
    const end = start + length;
    if (this.buffer.length < end) return null;
    const payload = this.buffer.slice(start, end).toString("utf8");
    this.buffer = this.buffer.slice(end);
    return payload;
  }

  tryReadLine() {
    if (this.buffer.includes(Buffer.from("\r\n\r\n"))) return null;
    const nl = this.buffer.indexOf(0x0a);
    if (nl === -1) return null;
    const line = this.buffer.slice(0, nl).toString("utf8").trim();
    this.buffer = this.buffer.slice(nl + 1);
    return line || null;
  }

  async dispatch(payload) {
    let message;
    try {
      message = JSON.parse(payload);
    } catch (error) {
      this.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } });
      return;
    }
    if (!Object.hasOwn(message, "id")) {
      await this.handler(message).catch(() => null);
      return;
    }
    try {
      const result = await this.handler(message);
      this.send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: error.code || -32000,
          message: error.message || String(error)
        }
      });
    }
  }

  send(message) {
    const json = JSON.stringify(message);
    const bytes = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${json}`);
  }
}

async function handleRequest(message) {
  const method = message.method;
  const params = message.params || {};
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION
      }
    };
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return null;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: toolDefinitions() };
  if (method === "tools/call") return callTool(params.name, params.arguments || {});
  if (method === "resources/list") return { resources: RESOURCE_DEFS };
  if (method === "resources/read") return readResource(params.uri);
  if (method === "prompts/list") return { prompts: PROMPT_DEFS };
  if (method === "prompts/get") return getPrompt(params.name, params.arguments || {});
  const error = new Error(`Unsupported MCP method: ${method}`);
  error.code = -32601;
  throw error;
}

function toolDefinitions() {
  return [
    {
      name: "galcode_validate_story",
      description: "Validate a Galcode story JSON against known assets, character hints, and renderability rules.",
      inputSchema: {
        type: "object",
        properties: {
          story: { type: "object", description: "Story JSON object. Use this or storyPath." },
          storyPath: { type: "string", description: "Path to story.json under the project root." },
          manifestPath: { type: "string", description: "Optional asset manifest path under the project root." },
          assetsDir: { type: "string", description: "Optional asset directory to index when no manifest exists. Defaults to figure." }
        }
      }
    },
    {
      name: "galcode_compile_story",
      description: "Compile a validated story JSON into a WebGAL project directory. This does not record video.",
      inputSchema: {
        type: "object",
        properties: {
          story: { type: "object", description: "Story JSON object. Use this or storyPath." },
          storyPath: { type: "string", description: "Path to story.json under the project root." },
          outDir: { type: "string", description: "Output directory under the project root. Defaults to outputs/mcp-<timestamp>." },
          manifestPath: { type: "string", description: "Optional asset manifest path." },
          assetsDir: { type: "string", description: "Optional asset directory to index. Defaults to figure." },
          noLive2d: { type: "boolean", description: "Skip archive-based Live2D preparation. Existing manifest Live2D entries remain usable." }
        }
      }
    },
    {
      name: "galcode_render_video",
      description: "Render/record an existing Galcode project to final.mp4 as a background job.",
      inputSchema: {
        type: "object",
        required: ["projectDir"],
        properties: {
          projectDir: { type: "string", description: "Compiled project directory under the project root." },
          videoOut: { type: "string", description: "Output mp4 path. Defaults to <projectDir>/final.mp4." },
          duration: { type: "number", description: "Target seconds." },
          fps: { type: "number", description: "Output fps. Defaults to 60." },
          width: { type: "number", description: "Video width. Defaults to 1280." },
          height: { type: "number", description: "Video height. Defaults to 720." },
          capture: { type: "string", enum: ["electron", "screenshot", "frames", "playwright-video", "video", "avfoundation"], description: "Capture backend. Defaults to electron." },
          electronGpu: { type: "string", enum: ["auto", "hardware", "software", "swiftshader"], description: "Electron GPU mode." },
          noBgm: { type: "boolean", description: "Disable BGM post-mix." }
        }
      }
    },
    {
      name: "galcode_job_status",
      description: "Read status and tail logs for a background render job.",
      inputSchema: {
        type: "object",
        required: ["jobId"],
        properties: {
          jobId: { type: "string" },
          tailBytes: { type: "number", description: "Log tail size. Defaults to 8000 bytes." }
        }
      }
    },
    {
      name: "galcode_cancel_job",
      description: "Cancel a currently running background render job.",
      inputSchema: {
        type: "object",
        required: ["jobId"],
        properties: {
          jobId: { type: "string" }
        }
      }
    },
    {
      name: "galcode_list_outputs",
      description: "List generated Galcode output directories and important files.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max output directories. Defaults to 20." }
        }
      }
    },
    {
      name: "galcode_read_output",
      description: "Read story.json, WebGAL start.txt, README, or a small log from an output directory.",
      inputSchema: {
        type: "object",
        required: ["outputDir", "file"],
        properties: {
          outputDir: { type: "string", description: "Output directory under project root." },
          file: { type: "string", enum: ["story", "script", "readme", "log"], description: "Which generated text to read." },
          maxBytes: { type: "number", description: "Maximum bytes to read. Defaults to 12000." }
        }
      }
    },
    {
      name: "galcode_read_log",
      description: "Read a Galcode MCP job log, or another log file under the project root.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "MCP job id returned by galcode_render_video." },
          logPath: { type: "string", description: "Log path under the Galcode project root." },
          tailBytes: { type: "number", description: "Bytes to read from the end of the log. Defaults to 12000." }
        }
      }
    }
  ];
}

async function callTool(name, args) {
  if (name === "galcode_validate_story") return asText(await validateStoryTool(args));
  if (name === "galcode_compile_story") return asText(await compileStoryTool(args));
  if (name === "galcode_render_video") return asText(await renderVideoTool(args));
  if (name === "galcode_job_status") return asText(await jobStatusTool(args));
  if (name === "galcode_cancel_job") return asText(await cancelJobTool(args));
  if (name === "galcode_list_outputs") return asText(await listOutputsTool(args));
  if (name === "galcode_read_output") return asText(await readOutputTool(args));
  if (name === "galcode_read_log") return asText(await readLogTool(args));
  throw new Error(`Unknown tool: ${name}`);
}

async function readResource(uri) {
  let text;
  let mimeType = "text/plain";
  if (uri === "galcode://characters") {
    mimeType = "application/json";
    text = jsonString({ characters: CHARACTER_CATALOG });
  } else if (uri === "galcode://assets") {
    mimeType = "application/json";
    text = jsonString(await assetSummary());
  } else if (uri === "galcode://story-schema") {
    mimeType = "application/json";
    text = jsonString(STORY_SCHEMA);
  } else if (uri === "galcode://webgal-rules") {
    text = WEBGAL_RULES;
  } else if (uri === "galcode://style-guide") {
    text = STYLE_GUIDE;
  } else if (uri === "galcode://examples") {
    mimeType = "application/json";
    text = jsonString({ examples: [EXAMPLE_STORY] });
  } else if (uri === "galcode://runtime-status") {
    mimeType = "application/json";
    text = jsonString(await runtimeStatus());
  } else {
    throw new Error(`Unknown resource: ${uri}`);
  }
  return { contents: [{ uri, mimeType, text }] };
}

function getPrompt(name, args) {
  if (name === "galcode_write_story_json") {
    return {
      description: "Write a Galcode renderable story JSON.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "You are writing a Galcode story JSON for a non-commercial fan work.",
              "First read galcode://characters, galcode://assets, galcode://story-schema, and galcode://webgal-rules.",
              `User idea: ${args.idea || ""}`,
              `Target duration: ${args.durationSec || 60} seconds.`,
              "Use only asset ids that exist in galcode://assets. Return only valid JSON matching galcode://story-schema."
            ].join("\n")
          }
        }
      ]
    };
  }
  if (name === "galcode_revision_pass") {
    return promptText("Revise the current Galcode story JSON using the feedback below. Preserve valid asset ids unless a replacement is necessary. Return only the updated JSON.", args.feedback || "");
  }
  if (name === "galcode_fix_validation_errors") {
    return promptText("Fix the Galcode story JSON according to these validation errors. Prefer changing invalid asset ids/actions over changing the user's story intent. Return only JSON.", args.errors || "");
  }
  if (name === "galcode_render_debug") {
    return promptText("Diagnose this Galcode render or compile log. Explain the likely cause and the next concrete command/tool call to try.", args.log || "");
  }
  throw new Error(`Unknown prompt: ${name}`);
}

function promptText(prefix, body) {
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: `${prefix}\n\n${body}` }
      }
    ]
  };
}

async function validateStoryTool(args) {
  const { story, storyPath } = await readStoryInput(args);
  const manifest = await ensureManifest(args);
  const result = validateStory(story, manifest);
  return {
    ok: result.errors.length === 0,
    storyPath,
    errors: result.errors,
    warnings: result.warnings,
    counts: {
      scenes: Array.isArray(story.scenes) ? story.scenes.length : 0,
      actions: Array.isArray(story.scenes) ? story.scenes.reduce((sum, scene) => sum + (Array.isArray(scene.actions) ? scene.actions.length : 0), 0) : 0
    }
  };
}

async function compileStoryTool(args) {
  const { storyPath, created } = await readStoryInput(args, { writeIfObject: true });
  const manifestPath = await ensureManifestPath(args);
  const outDir = args.outDir
    ? resolveInsideRoot(args.outDir)
    : path.join(ROOT_DIR, "outputs", `mcp-${timestampSlug()}`);
  await ensureDir(outDir);
  const commandArgs = ["compile", storyPath, "--manifest", manifestPath, "--out", outDir];
  if (args.noLive2d) commandArgs.push("--no-live2d");
  const result = await runGalcode(commandArgs, { timeoutMs: 10 * 60 * 1000 });
  return {
    ok: result.code === 0,
    storyPath,
    wroteStoryFile: created,
    manifestPath,
    outDir,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function renderVideoTool(args) {
  const projectDir = resolveInsideRoot(requiredString(args.projectDir, "projectDir"));
  if (!fssync.existsSync(path.join(projectDir, "story.json"))) {
    throw new Error(`Not a Galcode project directory: ${projectDir}`);
  }
  const videoOut = args.videoOut
    ? resolveInsideRoot(args.videoOut)
    : path.join(projectDir, "final.mp4");
  await ensureDir(path.dirname(videoOut));
  const jobId = `render-${timestampSlug()}-${randomUUID().slice(0, 8)}`;
  const logPath = path.join(JOB_DIR, `${jobId}.log`);
  const jobPath = path.join(JOB_DIR, `${jobId}.json`);
  await ensureDir(JOB_DIR);
  const commandArgs = [
    "record",
    projectDir,
    "--capture",
    String(args.capture || "electron"),
    "--video-out",
    videoOut
  ];
  if (args.duration) commandArgs.push("--duration", String(args.duration));
  if (args.fps) commandArgs.push("--fps", String(args.fps));
  if (args.width) commandArgs.push("--width", String(args.width));
  if (args.height) commandArgs.push("--height", String(args.height));
  if (args.electronGpu) commandArgs.push("--electron-gpu", String(args.electronGpu));
  if (args.noBgm) commandArgs.push("--no-bgm");

  const job = {
    id: jobId,
    type: "render",
    status: "running",
    projectDir,
    videoOut,
    logPath,
    command: ["node", GALCODE_BIN, ...commandArgs],
    startedAt: new Date().toISOString()
  };
  await writeJson(jobPath, job);
  const child = spawn(process.execPath, [GALCODE_BIN, ...commandArgs], {
    cwd: ROOT_DIR,
    env: { ...process.env, GALCODE_ROOT: ROOT_DIR },
    stdio: ["ignore", "pipe", "pipe"]
  });
  runningJobs.set(jobId, child);
  const log = await fs.open(logPath, "a");
  const writeLog = async (chunk) => {
    await log.appendFile(chunk).catch(() => {});
  };
  child.stdout.on("data", (chunk) => void writeLog(chunk));
  child.stderr.on("data", (chunk) => void writeLog(chunk));
  child.on("error", async (error) => {
    await writeLog(Buffer.from(`\n[process error] ${error.message}\n`));
  });
  child.on("exit", async (code, signal) => {
    runningJobs.delete(jobId);
    await log.close().catch(() => {});
    const finished = {
      ...job,
      status: code === 0 ? "completed" : "failed",
      exitCode: code,
      signal,
      finishedAt: new Date().toISOString()
    };
    await writeJson(jobPath, finished).catch(() => {});
  });
  return {
    ok: true,
    jobId,
    status: "running",
    projectDir,
    videoOut,
    logPath,
    message: "Render job started. Use galcode_job_status to follow progress."
  };
}

async function jobStatusTool(args) {
  const jobId = requiredString(args.jobId, "jobId");
  const tailBytes = boundedBytes(args.tailBytes, 8000);
  const jobPath = path.join(JOB_DIR, `${safeName(jobId)}.json`);
  if (!isInside(JOB_DIR, jobPath) || !fssync.existsSync(jobPath)) throw new Error(`Unknown job: ${jobId}`);
  const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
  const active = runningJobs.has(jobId);
  return {
    ...job,
    active,
    logTail: await readTail(job.logPath, tailBytes)
  };
}

async function cancelJobTool(args) {
  const jobId = requiredString(args.jobId, "jobId");
  const child = runningJobs.get(jobId);
  const jobPath = path.join(JOB_DIR, `${safeName(jobId)}.json`);
  if (!child) {
    return {
      ok: false,
      jobId,
      message: "Job is not active in this MCP server process. It may have finished or the server was restarted."
    };
  }
  child.kill("SIGTERM");
  runningJobs.delete(jobId);
  if (fssync.existsSync(jobPath)) {
    const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
    await writeJson(jobPath, { ...job, status: "cancelled", finishedAt: new Date().toISOString() });
  }
  return { ok: true, jobId, status: "cancelled" };
}

async function listOutputsTool(args) {
  const outputsDir = path.join(ROOT_DIR, "outputs");
  const limit = Math.max(1, Math.min(200, Number(args.limit || 20)));
  if (!fssync.existsSync(outputsDir)) return { outputs: [] };
  const entries = await fs.readdir(outputsDir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(outputsDir, entry.name);
    const stat = await fs.stat(dir).catch(() => null);
    dirs.push({
      name: entry.name,
      dir,
      updatedAt: stat?.mtime?.toISOString?.() || "",
      story: fssync.existsSync(path.join(dir, "story.json")),
      script: fssync.existsSync(path.join(dir, "game", "scene", "start.txt")),
      video: fssync.existsSync(path.join(dir, "final.mp4")) ? path.join(dir, "final.mp4") : ""
    });
  }
  dirs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { outputs: dirs.slice(0, limit) };
}

async function readOutputTool(args) {
  const outputDir = resolveInsideRoot(requiredString(args.outputDir, "outputDir"));
  const file = requiredString(args.file, "file");
  const maxBytes = boundedBytes(args.maxBytes, 12000, 1000, 100000);
  const candidates = {
    story: path.join(outputDir, "story.json"),
    script: path.join(outputDir, "game", "scene", "start.txt"),
    readme: path.join(outputDir, "README.md"),
    log: path.join(outputDir, "record.log")
  };
  const target = candidates[file];
  if (!target) throw new Error(`Unsupported output file selector: ${file}`);
  if (!isInside(outputDir, target) || !fssync.existsSync(target)) throw new Error(`Output file not found: ${target}`);
  return {
    outputDir,
    file,
    path: target,
    text: await readHead(target, maxBytes)
  };
}

async function readLogTool(args) {
  const tailBytes = boundedBytes(args.tailBytes, 12000);
  let logPath = "";
  if (args.jobId) {
    const jobPath = path.join(JOB_DIR, `${safeName(args.jobId)}.json`);
    if (!isInside(JOB_DIR, jobPath) || !fssync.existsSync(jobPath)) throw new Error(`Unknown job: ${args.jobId}`);
    const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
    logPath = job.logPath;
  } else if (args.logPath) {
    logPath = resolveInsideRoot(args.logPath);
  } else {
    throw new Error("Pass jobId or logPath.");
  }
  if (!isInside(ROOT_DIR, logPath) || !fssync.existsSync(logPath)) throw new Error(`Log not found: ${logPath}`);
  return {
    logPath,
    text: await readTail(logPath, tailBytes)
  };
}

function validateStory(story, manifest) {
  const errors = [];
  const warnings = [];
  const assets = new Map((manifest.assets || []).map((asset) => [asset.id, asset]));
  if (!story || typeof story !== "object") {
    errors.push("Story must be an object.");
    return { errors, warnings };
  }
  if (!story.title) warnings.push("Story title is missing.");
  if (!Array.isArray(story.scenes) || story.scenes.length === 0) {
    errors.push("Story must contain at least one scene.");
    return { errors, warnings };
  }
  const positions = new Set(["left", "center", "right"]);
  story.scenes.forEach((scene, sceneIndex) => {
    const sceneLabel = `scene[${sceneIndex}]`;
    if (!Array.isArray(scene.actions)) {
      errors.push(`${sceneLabel}.actions must be an array.`);
      return;
    }
    if (scene.backgroundAssetId) {
      const asset = assets.get(scene.backgroundAssetId);
      if (!asset) errors.push(`${sceneLabel}.backgroundAssetId does not exist: ${scene.backgroundAssetId}`);
      else if (asset.kind !== "background") warnings.push(`${sceneLabel}.backgroundAssetId points to ${asset.kind}, expected background.`);
    }
    if (scene.bgmAssetId) {
      const asset = assets.get(scene.bgmAssetId);
      if (!asset) errors.push(`${sceneLabel}.bgmAssetId does not exist: ${scene.bgmAssetId}`);
      else if (asset.kind !== "bgm") warnings.push(`${sceneLabel}.bgmAssetId points to ${asset.kind}, expected bgm.`);
    }
    const occupied = new Map();
    for (const [actionIndex, action] of scene.actions.entries()) {
      const label = `${sceneLabel}.actions[${actionIndex}]`;
      if (!action || typeof action !== "object") {
        errors.push(`${label} must be an object.`);
        continue;
      }
      if (action.type === "figure") {
        if (!positions.has(action.position)) errors.push(`${label}.position must be left, center, or right.`);
        if (String(action.character || "").toLowerCase() === "none") {
          occupied.delete(action.position);
          continue;
        }
        if (!action.assetId) {
          errors.push(`${label}.assetId is required for figure actions.`);
          continue;
        }
        const asset = assets.get(action.assetId);
        if (!asset) {
          errors.push(`${label}.assetId does not exist: ${action.assetId}`);
          continue;
        }
        const previous = occupied.get(action.position);
        if (previous && previous !== action.character) {
          warnings.push(`${label} replaces ${previous} at ${action.position}; insert a character='none' figure action first for cleaner WebGAL output.`);
        }
        occupied.set(action.position, action.character);
        if (asset.kind === "live2d") {
          if (!action.motion) errors.push(`${label}.motion is required for Live2D asset ${asset.id}.`);
          if (!action.expression) errors.push(`${label}.expression is required for Live2D asset ${asset.id}.`);
          if (action.motion && Array.isArray(asset.motions) && asset.motions.length && !asset.motions.includes(action.motion)) {
            warnings.push(`${label}.motion '${action.motion}' is not listed on asset ${asset.id}.`);
          }
          if (action.expression && Array.isArray(asset.expressions) && asset.expressions.length && !asset.expressions.includes(action.expression)) {
            warnings.push(`${label}.expression '${action.expression}' is not listed on asset ${asset.id}.`);
          }
        }
      } else if (action.type === "line") {
        if (!action.speaker) warnings.push(`${label}.speaker is missing.`);
        if (!action.text) errors.push(`${label}.text is required.`);
      } else if (action.type === "narration") {
        if (!action.text) errors.push(`${label}.text is required.`);
      } else if (action.type === "wait") {
        if (!(Number(action.durationSec) > 0)) warnings.push(`${label}.durationSec should be greater than 0.`);
      } else {
        errors.push(`${label}.type is unsupported: ${action.type}`);
      }
    }
  });
  return { errors, warnings };
}

async function readStoryInput(args, options = {}) {
  if (args.story && typeof args.story === "object") {
    if (!options.writeIfObject) return { story: args.story, storyPath: "" };
    await ensureDir(STORY_DIR);
    const storyPath = path.join(STORY_DIR, `story-${timestampSlug()}-${randomUUID().slice(0, 8)}.json`);
    await writeJson(storyPath, args.story);
    return { story: args.story, storyPath, created: true };
  }
  if (!args.storyPath) throw new Error("Pass story or storyPath.");
  const storyPath = resolveInsideRoot(args.storyPath);
  const story = JSON.parse(await fs.readFile(storyPath, "utf8"));
  return { story, storyPath, created: false };
}

async function ensureManifest(args = {}) {
  const manifestPath = await ensureManifestPath(args);
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

async function ensureManifestPath(args = {}) {
  if (args.manifestPath) {
    const manifestPath = resolveInsideRoot(args.manifestPath);
    if (!fssync.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
    return manifestPath;
  }
  if (fssync.existsSync(DEFAULT_MANIFEST)) return DEFAULT_MANIFEST;
  const assetsDir = args.assetsDir ? resolveInsideRoot(args.assetsDir) : path.join(ROOT_DIR, "figure");
  if (!fssync.existsSync(assetsDir)) {
    await writeJson(DEFAULT_MANIFEST, emptyManifest());
    return DEFAULT_MANIFEST;
  }
  await ensureDir(path.dirname(DEFAULT_MANIFEST));
  const result = await runGalcode(["index", "--assets", assetsDir, "--out", DEFAULT_MANIFEST], { timeoutMs: 5 * 60 * 1000 });
  if (result.code !== 0) {
    throw new Error(`Failed to index assets: ${result.stderr || result.stdout}`);
  }
  return DEFAULT_MANIFEST;
}

async function assetSummary() {
  const manifest = await ensureManifest({});
  const assets = manifest.assets || [];
  const pick = (kind, limit = 200) => assets
    .filter((asset) => asset.kind === kind)
    .slice(0, limit)
    .map(publicAsset);
  return {
    generatedAt: manifest.generatedAt,
    counts: manifest.counts || {},
    backgrounds: pick("background", 500),
    bgm: pick("bgm", 500),
    figures: pick("figure", 300),
    live2d: assets.filter((asset) => asset.kind === "live2d").map((asset) => ({
      ...publicAsset(asset),
      characterKey: asset.characterKey,
      motions: (asset.motions || []).slice(0, 32),
      expressions: (asset.expressions || []).slice(0, 32),
      live2dVersion: asset.live2dVersion
    })),
    characterGuide: buildCharacterGuide(assets)
  };
}

function publicAsset(asset) {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    fileName: asset.fileName,
    relativePath: asset.relativePath,
    characterHint: asset.characterHint,
    tags: asset.tags || []
  };
}

function buildCharacterGuide(assets) {
  return CHARACTER_CATALOG.map((character) => {
    const live2d = assets
      .filter((asset) => asset.kind === "live2d" && [asset.characterHint, asset.relativePath, asset.name].some((value) => matchesCharacter(value, character)))
      .slice(0, 20)
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        motions: (asset.motions || []).slice(0, 12),
        expressions: (asset.expressions || []).slice(0, 12),
        relativePath: asset.relativePath
      }));
    return { key: character.key, displayName: character.displayName, aliases: character.aliases, writingNotes: character.writingNotes, live2d };
  });
}

function matchesCharacter(value, character) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  if (text.includes(character.key)) return true;
  return character.aliases.some((alias) => text.includes(String(alias).toLowerCase()));
}

async function runtimeStatus() {
  const webgalDir = path.join(ROOT_DIR, "vendor", "webgal-mygo", "packages", "webgal");
  const live2dLib = path.join(webgalDir, "public", "lib");
  return {
    rootDir: ROOT_DIR,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ffmpeg: await commandVersion("ffmpeg", ["-version"]),
    electronInstalled: fssync.existsSync(path.join(ROOT_DIR, "node_modules", "electron")),
    webgalPackage: fssync.existsSync(path.join(webgalDir, "package.json")),
    webgalNodeModules: fssync.existsSync(path.join(webgalDir, "node_modules")),
    live2dRuntime: {
      bundled: false,
      reason: "Live2D SDK/runtime is copyrighted and is not redistributed by the public repository.",
      libDir: live2dLib,
      files: {
        "live2d.min.js": fssync.existsSync(path.join(live2dLib, "live2d.min.js")),
        "live2dcubismcore.min.js": fssync.existsSync(path.join(live2dLib, "live2dcubismcore.min.js"))
      }
    }
  };
}

async function commandVersion(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk.toString(); });
    child.stderr.on("data", (chunk) => { text += chunk.toString(); });
    child.on("error", () => resolve({ found: false, text: "" }));
    child.on("exit", (code) => resolve({ found: code === 0, text: text.split(/\r?\n/)[0] || "" }));
  });
}

function runGalcode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GALCODE_BIN, ...args], {
      cwd: ROOT_DIR,
      env: { ...process.env, GALCODE_ROOT: ROOT_DIR },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Galcode command timed out: ${args.join(" ")}`));
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function asText(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : jsonString(value)
      }
    ]
  };
}

function jsonString(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function emptyManifest() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    roots: [],
    counts: {},
    assets: []
  };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, jsonString(data), "utf8");
}

async function readHead(file, maxBytes) {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.slice(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readTail(file, maxBytes) {
  if (!file || !fssync.existsSync(file)) return "";
  const stat = await fs.stat(file);
  const start = Math.max(0, stat.size - maxBytes);
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.slice(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function resolveInsideRoot(inputPath) {
  const resolved = path.resolve(ROOT_DIR, String(inputPath));
  if (!isInside(ROOT_DIR, resolved)) {
    throw new Error(`Path must stay inside Galcode project root: ${inputPath}`);
  }
  return resolved;
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function requiredString(value, name) {
  if (!value || typeof value !== "string") throw new Error(`Missing required string argument: ${name}`);
  return value;
}

function boundedBytes(value, fallback, min = 1000, max = 200000) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
