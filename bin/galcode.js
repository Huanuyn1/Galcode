#!/usr/bin/env node
import { launchDsh, setupDshProfile, doctorDsh, readGalcodeVersion, DSH_TUI_PACKAGE } from "../src/dsh-profile.mjs";

// Galcode entry dispatch.
//   galcode                 → the dsh-based Galcode studio (TUI)
//   galcode setup|doctor    → dsh profile setup / environment checks
//   galcode cli <sub> ...   → the legacy CLI in src/galcode.js
//   galcode <legacy-sub>    → one-line migration hint, then runs `cli <sub>`
const LEGACY_COMMANDS = new Set([
  "agent", "chat", "interactive", "configure", "download-assets",
  "install-live2d-runtime", "prepare-live2d", "index", "discuss",
  "yolo", "make", "compile", "preview"
]);

const argv = process.argv.slice(2);
const first = argv[0];

// The legacy CLI owns process lifetime itself (the agent REPL stays alive on
// its readline loop and exits when it ends), so it must NOT be awaited as a
// top-level await — same contract the old bin relied on.
function runLegacy(args) {
  import("../src/galcode.js")
    .then(({ main }) => main(args))
    .catch(reportError);
}

function reportError(error) {
  console.error(`Galcode failed: ${error.message}`);
  if (process.env.GALCODE_DEBUG === "1") {
    console.error(error.stack);
  }
  process.exitCode = 1;
}

function hasLegacySetupFlags(args) {
  // The legacy `setup` cloned the vendor repos (`galcode setup --root vendor`);
  // top-level `setup` now means dsh profile init. Flags like --root/--force
  // belong to the legacy meaning.
  return args.some((arg) => arg === "--root" || arg === "--force" || arg.startsWith("--root="));
}

function printHelp() {
  console.log(`Galcode ${readGalcodeVersion()} — MyGO/Ave Mujica WebGAL 二创流水线

Usage:
  galcode                       启动 Galcode 创作台(dsh TUI,首次运行自动初始化)
  galcode setup                 初始化/修复 dsh profile(幂等,可重复运行)
  galcode doctor                检查运行环境(Node、dsh、profile、WebGAL、Live2D、ffmpeg)
  galcode cli <子命令>           旧版 CLI:agent / discuss / yolo / make / compile / preview /
                                configure / index / download-assets / install-live2d-runtime /
                                prepare-live2d / setup(克隆 vendor 仓库)

迁移说明:
  裸 galcode 现在打开 dsh 创作台;旧的交互 REPL 在 galcode cli agent。
  旧的 galcode <子命令> 仍可直接使用(会打印一行迁移提示)。

Environment:
  DSH_HOME              dsh 数据目录(默认 ~/.dsh)
  DEEPSEEK_API_KEY      创作台默认模型的 API key(在 TUI 内 /login 或 /settings 配置亦可)
  GALCODE_MCP_SERVER    galcode-mcp 入口绝对路径(启动器自动设置,一般无需手动配置)
  OPENAI_*              仅供 galcode cli 旧版模式使用,与 dsh 创作台互不影响

dsh profile 组合: dsh-base + ${DSH_TUI_PACKAGE}(社区 TUI)+ dsh-galcode(本仓库 packages/dsh-galcode)
`);
}

if (first === "cli") {
  runLegacy(argv.slice(1));
} else if (first === "setup" && !hasLegacySetupFlags(argv.slice(1))) {
  await setupDshProfile().catch(reportError);
} else if (first === "doctor") {
  await doctorDsh({ advisory: argv.slice(1).includes("--advisory") }).catch(reportError);
} else if (first === "--version" || first === "-V" || first === "version") {
  console.log(readGalcodeVersion());
} else if (first === "--help" || first === "-h" || first === "help") {
  printHelp();
} else if (LEGACY_COMMANDS.has(first) || (first === "setup" && hasLegacySetupFlags(argv.slice(1)))) {
  console.error(`提示:\`galcode ${first}\` 已迁移为 \`galcode cli ${first}\`(裸 galcode 现在启动 dsh 创作台)。正在按旧命令执行……`);
  runLegacy(argv);
} else if (first) {
  console.error(`Unknown command: ${first}`);
  console.error("运行 `galcode --help` 查看用法;旧版子命令请加 cli 前缀,例如 `galcode cli yolo`。");
  process.exitCode = 1;
} else {
  // Bare `galcode`: the dsh studio. Auto-setup runs on first use.
  process.exitCode = await launchDsh().catch((error) => {
    reportError(error);
    return 1;
  });
}
