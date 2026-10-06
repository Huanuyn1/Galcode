import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// chara 新版 Live2D 包(figure/chara/,Cubism 3/4)的索引与编译测试。
// Hermetic:在临时目录里造一个迷你的 chara 包结构(含 共享表情动作 相对引用)
// 和一个旧 mygo Cubism 2 模型,不依赖真实的 2.9GB 资产包、不用网络/LLM/引擎。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "galcode.js");
const TMP = path.join(os.tmpdir(), `galcode-chara-${process.pid}`);
const FIGURE = path.join(TMP, "figure");
const MANIFEST_PATH = path.join(TMP, "asset-manifest.json");
const STORY_PATH = path.join(TMP, "story.json");
const OUT_DIR = path.join(TMP, "out");

const ANON_MODEL_FILE = "adv_live2d_anon_002_school_winter_hs_1st.model3.json";
const ANON_MODEL_REL = `chara/爱音/school_winter_hs_1st/${ANON_MODEL_FILE}`;

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function buildFixtures() {
  const costumeDir = path.join(FIGURE, "chara", "爱音", "school_winter_hs_1st");
  write(path.join(costumeDir, ANON_MODEL_FILE), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: "adv_live2d_anon_002_school_winter_hs_1st.moc3",
      Textures: ["textures/texture_00.png"],
      Physics: "adv_live2d_anon_002_school_winter_hs_1st.physics3.json",
      Motions: {
        // 原生(裸名,文件在模型目录内)
        mtn_idle01_C: [{ File: "motions/mtn_idle01_C.motion3.json" }],
        mtn_smile01_C: [{ File: "motions/mtn_smile01_C.motion3.json" }],
        // 自己的 00_ 别名
        "00_爱音/mtn_smile01_C": [{ File: "motions/mtn_smile01_C.motion3.json" }],
        // 跨角色(带前缀,文件经 ../../ 指向共享库)
        "A03_乐奈/mtn_check01_L": [{ File: "../../共享表情动作/乐奈/motions/mtn_check01_L.motion3.json" }]
      },
      Expressions: [
        { Name: "exp_smile01", File: "expressions/exp_smile01.exp3.json" },
        { Name: "exp_idle01", File: "expressions/exp_idle01.exp3.json" },
        { Name: "00_爱音/exp_smile01", File: "expressions/exp_smile01.exp3.json" },
        { Name: "A05_素世/exp_smile01", File: "../../共享表情动作/素世/expressions/exp_smile01.exp3.json" }
      ]
    }
  }, null, 2));
  write(path.join(costumeDir, "adv_live2d_anon_002_school_winter_hs_1st.moc3"), "moc3");
  write(path.join(costumeDir, "adv_live2d_anon_002_school_winter_hs_1st.physics3.json"), "{}");
  write(path.join(costumeDir, "textures", "texture_00.png"), "png");
  write(path.join(costumeDir, "motions", "mtn_idle01_C.motion3.json"), "{}");
  write(path.join(costumeDir, "motions", "mtn_smile01_C.motion3.json"), "{}");
  write(path.join(costumeDir, "expressions", "exp_smile01.exp3.json"), "{}");
  write(path.join(costumeDir, "expressions", "exp_idle01.exp3.json"), "{}");
  // 共享库
  write(path.join(FIGURE, "chara", "共享表情动作", "素世", "expressions", "exp_smile01.exp3.json"), "{}");
  write(path.join(FIGURE, "chara", "共享表情动作", "乐奈", "motions", "mtn_check01_L.motion3.json"), "{}");

  // 旧 mygo Cubism 2 模型(回归用),含一个指向 _mtn_exp 共享库的条目
  const mygoDir = path.join(FIGURE, "mygo", "tomori", "live_default");
  write(path.join(mygoDir, "model.json"), JSON.stringify({
    model: "tomori.moc",
    textures: ["texture_00.png"],
    motions: {
      tomori_idle01: [{ file: "motions/tomori_idle01.mtn" }],
      tomori_cry01: [{ file: "motions/tomori_cry01.mtn" }],
      tomori_shared01: [{ file: "../../../_mtn_exp/test_shared.mtn" }]
    },
    expressions: [{ name: "default", file: "expressions/default.exp.json" }]
  }, null, 2));
  write(path.join(mygoDir, "tomori.moc"), "moc");
  write(path.join(mygoDir, "texture_00.png"), "png");
  write(path.join(mygoDir, "motions", "tomori_idle01.mtn"), "mtn");
  write(path.join(mygoDir, "motions", "tomori_cry01.mtn"), "mtn");
  write(path.join(mygoDir, "expressions", "default.exp.json"), "{}");
  write(path.join(FIGURE, "_mtn_exp", "test_shared.mtn"), "mtn");
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, OPENAI_API_KEY: "", GALCODE_ROOT: ROOT },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`cli exited ${code}: ${stderr}\n${stdout}`));
    });
  });
}

let manifest;
let charaAsset;
let mygoAsset;

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  buildFixtures();
  await runCli(["cli", "index", "--assets", FIGURE, "--out", MANIFEST_PATH]);
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  charaAsset = manifest.assets.find((asset) => asset.kind === "live2d" && asset.relativePath === ANON_MODEL_REL.split("/").join(path.sep));
  mygoAsset = manifest.assets.find((asset) => asset.kind === "live2d" && asset.relativePath.includes("mygo"));
}, 120000);

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("chara pack indexing", () => {
  it("splits native motions/expressions from the shared library registrations", () => {
    expect(charaAsset).toBeTruthy();
    expect(charaAsset.pack).toBe("chara");
    expect(charaAsset.characterKey).toBe("anon");
    expect(charaAsset.live2dVersion).toBe("cubism3+");
    expect([...charaAsset.motions].sort()).toEqual(["mtn_idle01_C", "mtn_smile01_C"]);
    expect([...charaAsset.expressions].sort()).toEqual(["exp_idle01", "exp_smile01"]);
    expect(charaAsset.motions.some((name) => name.includes("/"))).toBe(false);
    expect(charaAsset.expressions.some((name) => name.includes("/"))).toBe(false);
    expect(charaAsset.sharedMotions).toBe(2);
    expect(charaAsset.sharedExpressions).toBe(2);
    expect(charaAsset.sharedPrefixBase).toBe(true);
    expect(charaAsset.defaultMotion).toBe("mtn_idle01_C");
    expect(charaAsset.defaultExpression).toBe("exp_idle01");
  });

  it("scopes the model root to the costume directory (not the whole chara pack)", () => {
    expect(charaAsset.modelRoot).toBe(path.join(FIGURE, "chara", "爱音", "school_winter_hs_1st"));
  });

  it("does not index chara support files (motions, textures, moc3, shared library) as assets", () => {
    const charaJunk = manifest.assets.filter((asset) =>
      asset.relativePath.split(path.sep).join("/").startsWith("chara/") && asset.kind !== "live2d");
    expect(charaJunk).toEqual([]);
  });

  it("keeps old mygo Cubism 2 indexing unchanged (flat motion list, shared refs included)", () => {
    expect(mygoAsset).toBeTruthy();
    expect(mygoAsset.live2dVersion).toBe("cubism2");
    expect(mygoAsset.pack).toBeUndefined();
    expect(mygoAsset.characterKey).toBe("tomori");
    expect(mygoAsset.motions).toContain("tomori_idle01");
    expect(mygoAsset.motions).toContain("tomori_shared01");
    expect(mygoAsset.motions).toContain("test_shared");
    expect(mygoAsset.sharedMotions).toBeUndefined();
  });
});

describe("chara pack compile", () => {
  it("emits chara/... model path with verbatim motion/expression names", async () => {
    const story = {
      title: "chara 测试",
      durationSec: 20,
      characters: ["爱音", "高松灯"],
      scenes: [
        {
          id: "s1",
          title: "chara 场景",
          actions: [
            { type: "figure", character: "爱音", assetId: charaAsset.id, position: "center", motion: "mtn_idle01_C", expression: "A05_素世/exp_smile01" },
            { type: "line", speaker: "爱音", text: "借一下素世的表情。", durationSec: 3 },
            { type: "figure", character: "爱音", assetId: charaAsset.id, position: "center", motion: "A03_乐奈/mtn_check01_L", expression: "exp_smile01" },
            { type: "line", speaker: "爱音", text: "再借一下乐奈的动作。", durationSec: 3 }
          ]
        },
        {
          id: "s2",
          title: "旧包回归场景",
          actions: [
            { type: "figure", character: "高松灯", assetId: mygoAsset.id, position: "left", motion: "idle01", expression: "default" },
            { type: "line", speaker: "高松灯", text: "旧包的路径与前缀不变。", durationSec: 3 }
          ]
        }
      ]
    };
    write(STORY_PATH, JSON.stringify(story, null, 2));
    await runCli(["cli", "compile", STORY_PATH, "--manifest", MANIFEST_PATH, "--out", OUT_DIR, "--no-theme"]);

    const script = readFileSync(path.join(OUT_DIR, "game", "scene", "start.txt"), "utf8");
    expect(script).toContain(
      `changeFigure:${ANON_MODEL_REL} -id=fig-center -motion=mtn_idle01_C -expression=A05_素世/exp_smile01 -next;`);
    expect(script).toContain(
      `changeFigure:${ANON_MODEL_REL} -id=fig-center -motion=A03_乐奈/mtn_check01_L -expression=exp_smile01 -next;`);
    // chara 名字不做旧包的 anon_ 式前缀转换
    expect(script).not.toContain("anon_mtn_");
    expect(script).not.toContain("anon_exp_");

    // 旧 mygo 包回归:hashed live2d/ 路径 + 角色前缀转换保持不变
    expect(script).toMatch(/changeFigure:live2d\/\S*model\.json -left -id=fig-left -motion=tomori_idle01 -expression=tomori_default -next;/);

    // 编译产物的目录结构:原样保留 chara/<角色>/<服装>/,并复制共享库
    const gameFigure = path.join(OUT_DIR, "game", "figure");
    expect(existsSync(path.join(gameFigure, "chara", "爱音", "school_winter_hs_1st", ANON_MODEL_FILE))).toBe(true);
    expect(existsSync(path.join(gameFigure, "chara", "爱音", "school_winter_hs_1st", "textures", "texture_00.png"))).toBe(true);
    expect(existsSync(path.join(gameFigure, "chara", "爱音", "school_winter_hs_1st", "motions", "mtn_idle01_C.motion3.json"))).toBe(true);
    expect(existsSync(path.join(gameFigure, "chara", "共享表情动作", "素世", "expressions", "exp_smile01.exp3.json"))).toBe(true);
    expect(existsSync(path.join(gameFigure, "chara", "共享表情动作", ".galcode-shared-lib.json"))).toBe(true);
    // 旧包:_mtn_exp 共享动作照旧复制(模型里 ../../../_mtn_exp 相对引用 → game/_mtn_exp)
    expect(existsSync(path.join(OUT_DIR, "game", "_mtn_exp", "test_shared.mtn"))).toBe(true);

    // 重跑编译:共享库已带标记文件,跳过复制也不报错
    await runCli(["cli", "compile", STORY_PATH, "--manifest", MANIFEST_PATH, "--out", OUT_DIR, "--no-theme"]);
    expect(existsSync(path.join(gameFigure, "chara", "共享表情动作", "素世", "expressions", "exp_smile01.exp3.json"))).toBe(true);
  }, 120000);
});
